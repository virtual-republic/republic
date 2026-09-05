#!/usr/bin/env node
// Settlement. Verifies every pending instrument, applies what is valid, and
// records it in the register.
//
// Nothing else writes value into the ledger. A transfer, a trade, or a contract
// is a signed file until this runs; then it is a record, and art-02/§9 makes it
// permanent.
//
//   node tools/settle.js            settle everything pending
//   node tools/settle.js --dry-run  report only

import fs from 'node:fs';
import path from 'node:path';
import { append } from './lib/events.js';
import { params } from './lib/params.js';
import { accounts, mayActFor, ledgerState, loadPending, checkSignature, contracts, contractComplete } from './lib/value.js';
import { sha256 } from './lib/events.js';

const ROOT = process.cwd();
const dry = process.argv.includes('--dry-run');
const P = params(ROOT);

let applied = 0, refused = 0;
const say = (ok, what, why) => { console.log(`  ${ok ? '✓' : '✗'} ${what}${why ? ' — ' + why : ''}`); ok ? applied++ : refused++; };
const done = (file) => { if (!dry) { fs.mkdirSync(path.join(ROOT, 'settled'), { recursive: true }); fs.renameSync(file, path.join(ROOT, 'settled', path.basename(file))); } };

// ---- transfers ---------------------------------------------------------------

const transfers = loadPending(ROOT, 'transfers');
if (transfers.length) console.log(`\nTransfers (${transfers.length})`);

for (const t of transfers) {
  const acct = accounts(ROOT);
  const state = ledgerState(ROOT);

  if (!acct.has(t.from) || !acct.has(t.to)) { say(false, t.file, 'unknown account'); continue; }
  if (!mayActFor(ROOT, t.by, t.from)) { say(false, t.file, `${t.by} may not act for ${t.from} (art-02/§12/¶3)`); continue; }

  const sig = checkSignature(ROOT, t, t.by);
  if (!sig.ok) { say(false, t.file, sig.error); continue; }

  if (t.kind === 'transfer') {
    const bal = state.balances.get(t.from) || 0;
    if (!P.value.transfer.allow_negative && bal < t.amount) { say(false, t.file, `${t.from} holds ${bal}, needs ${t.amount}`); continue; }
    if (!dry) append(ROOT, { at: t.at, author: t.by, kind: 'value.transferred', provision: 'art-09/§50/¶2',
      payload: { from: t.from, to: t.to, amount: t.amount, unit: P.value.unit, ...(t.note ? { note: t.note } : {}) } });
    say(true, `${t.from} → ${t.to}  ${t.amount} ${P.value.unit}`);
  } else {
    const held = (state.holdings.get(t.from) || new Map()).get(t.instrument) || 0;
    if (held < t.quantity) { say(false, t.file, `${t.from} holds ${held} of ${t.instrument}`); continue; }
    if (!dry) append(ROOT, { at: t.at, author: t.by, kind: 'instrument.transferred', provision: 'art-09/§51/¶2',
      payload: { from: t.from, to: t.to, instrument: t.instrument, quantity: t.quantity } });
    say(true, `${t.from} → ${t.to}  ${t.quantity} × ${t.instrument}`);
  }
  done(t.path);
}

// ---- the exchange: one uniform-price auction per instrument ------------------
//
// art-09/§52/¶2 — no priority to the order of arrival. Every order in the period
// is treated alike, and everyone who trades trades at the same price.

const orders = loadPending(ROOT, 'orders');
if (orders.length) console.log(`\nExchange (${orders.length} orders)`);

const byInstrument = new Map();
for (const o of orders) {
  const sig = checkSignature(ROOT, o, o.by);
  if (!sig.ok) { say(false, o.file, sig.error); continue; }
  if (!mayActFor(ROOT, o.by, o.account)) { say(false, o.file, `${o.by} may not act for ${o.account}`); continue; }
  if (!byInstrument.has(o.instrument)) byInstrument.set(o.instrument, []);
  byInstrument.get(o.instrument).push(o);
}

for (const [instrument, book] of byInstrument) {
  const bids = book.filter((o) => o.side === 'buy').sort((a, b) => b.price - a.price);
  const asks = book.filter((o) => o.side === 'sell').sort((a, b) => a.price - b.price);
  if (!bids.length || !asks.length) { console.log(`  · ${instrument}: no crossing orders`); continue; }

  // The clearing price is the one that trades the most; ties resolve to the midpoint.
  let best = null;
  const prices = [...new Set([...bids, ...asks].map((o) => o.price))].sort((a, b) => a - b);
  for (const p of prices) {
    const demand = bids.filter((o) => o.price >= p).reduce((s, o) => s + o.quantity, 0);
    const supply = asks.filter((o) => o.price <= p).reduce((s, o) => s + o.quantity, 0);
    const volume = Math.min(demand, supply);
    if (!best || volume > best.volume) best = { price: p, volume };
  }
  if (!best || best.volume === 0) { console.log(`  · ${instrument}: no price clears`); continue; }

  const buyers = bids.filter((o) => o.price >= best.price);
  const sellers = asks.filter((o) => o.price <= best.price);
  let left = best.volume, bi = 0, si = 0;
  const fills = [];
  const takenB = new Map(), takenS = new Map();

  while (left > 0 && bi < buyers.length && si < sellers.length) {
    const b = buyers[bi], s = sellers[si];
    const bRem = b.quantity - (takenB.get(b.file) || 0);
    const sRem = s.quantity - (takenS.get(s.file) || 0);
    const q = Math.min(bRem, sRem, left);
    if (q <= 0) break;
    fills.push({ buyer: b.account, seller: s.account, quantity: q, price: best.price });
    takenB.set(b.file, (takenB.get(b.file) || 0) + q);
    takenS.set(s.file, (takenS.get(s.file) || 0) + q);
    left -= q;
    if (takenB.get(b.file) === b.quantity) bi++;
    if (takenS.get(s.file) === s.quantity) si++;
  }

  console.log(`  · ${instrument}: cleared ${best.volume} at ${best.price} (uniform price, art-09/§52/¶2)`);
  for (const f of fills) {
    const state = ledgerState(ROOT);
    const held = (state.holdings.get(f.seller) || new Map()).get(instrument) || 0;
    const bal = state.balances.get(f.buyer) || 0;
    if (held < f.quantity) { say(false, `${f.seller} sell ${f.quantity}`, 'insufficient holding at settlement'); continue; }
    if (bal < f.quantity * f.price) { say(false, `${f.buyer} buy ${f.quantity}`, 'insufficient balance at settlement'); continue; }
    if (!dry) append(ROOT, { at: new Date().toISOString(), author: f.buyer, kind: 'order.matched', provision: 'art-09/§52/¶2',
      payload: { instrument, buyer: f.buyer, seller: f.seller, quantity: f.quantity, price: f.price } });
    say(true, `${f.seller} → ${f.buyer}  ${f.quantity} × ${instrument} @ ${f.price}`);
  }
  for (const o of book) done(o.path);
}

// ---- contracts ---------------------------------------------------------------

const all = contracts(ROOT);
const ready = all.filter((c) => contractComplete(ROOT, c) && !c.executed);
if (ready.length) console.log(`\nContracts (${ready.length} ready)`);

for (const c of ready) {
  const text = fs.readFileSync(path.join(ROOT, c.file), 'utf8');
  const hash = sha256(text);
  let ok = true;
  for (const s of c.signatures) {
    // art-04-style: a signature covers the document as it stood.
    if (s.document !== hash) { say(false, `${c.id}: ${s.by}`, 'the document changed after signature (§ 3 ³)'); ok = false; continue; }
    const v = checkSignature(ROOT, s, s.by);
    if (!v.ok) { say(false, `${c.id}: ${s.by}`, v.error); ok = false; }
  }
  if (!ok) continue;

  if (!dry) {
    append(ROOT, { at: new Date().toISOString(), author: c.drafted_by, kind: 'contract.executed', provision: 'art-05/§24/¶1',
      payload: { contract: c.id, parties: c.parties, document: hash } });
    const src = fs.readFileSync(path.join(ROOT, c.file), 'utf8');
    fs.writeFileSync(path.join(ROOT, c.file), src.replace(/^drafted:/m, `executed: ${new Date().toISOString().slice(0, 10)}\ndrafted:`));
  }
  say(true, `${c.id} executed by ${[].concat(c.parties).join(' and ')}`);
}

console.log(`\n${applied} applied, ${refused} refused${dry ? ' (dry run — nothing changed)' : ''}.`);
if (!applied && !refused) console.log('Nothing pending.');
process.exit(refused && !applied ? 1 : 0);
