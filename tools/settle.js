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
import { offices } from './lib/registers.js';
import { accounts, mayActFor, ledgerState, loadPending, checkSignature, contracts, contractComplete } from './lib/value.js';
import { sha256 } from './lib/events.js';
import yaml from 'js-yaml';

const ROOT = process.cwd();
const dry = process.argv.includes('--dry-run');
const P = params(ROOT);

let applied = 0, refused = 0;
const refusals = [];

// A refusal is a normal outcome — a signature that does not verify, a balance
// that will not cover it. It is not a broken build. The instrument is set aside
// with the reason beside it, so it is not retried forever and the citizen can
// see why.
const say = (ok, what, why, file) => {
  console.log(`  ${ok ? '\u2713' : '\u2717'} ${what}${why ? ' \u2014 ' + why : ''}`);
  if (ok) { applied++; return; }
  refused++;
  refusals.push({ what, why });
  if (file && !dry) {
    const dir = path.join(ROOT, 'refused');
    fs.mkdirSync(dir, { recursive: true });
    const name = path.basename(file);
    try {
      const body = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.writeFileSync(path.join(dir, name), JSON.stringify({ ...body, _refused: { why, at: new Date().toISOString() } }, null, 2));
      fs.rmSync(file);
    } catch { /* leave it where it is if it cannot be read */ }
  }
};
const done = (file) => { if (!dry) { fs.mkdirSync(path.join(ROOT, 'settled'), { recursive: true }); fs.renameSync(file, path.join(ROOT, 'settled', path.basename(file))); } };

// ---- transfers ---------------------------------------------------------------

const transfers = loadPending(ROOT, 'transfers');
if (transfers.length) console.log(`\nTransfers (${transfers.length})`);

for (const t of transfers) {
  const acct = accounts(ROOT);
  const state = ledgerState(ROOT);

  // art-09/§49/¶1 — the unit is issued only by the Treasurer, only under a
  // resolution of the Assembly, and only in the amount that resolution states.
  if (t.kind === 'value-issue') {
    const treasurer = offices(ROOT).find((o) => (o.permissions || []).includes('value.issue'));
    if (!treasurer || treasurer.holder !== t.by) {
      say(false, t.file, `only the holder of value.issue may issue the unit (art-09/§49/¶1) — that is ${treasurer ? treasurer.holder : 'nobody'}`, t.path);
      continue;
    }
    if (!t.resolution) { say(false, t.file, 'an issue must cite the resolution that authorises it (art-09/§49/¶1)', t.path); continue; }
    const rf = path.join(ROOT, 'ballots', t.resolution, '_result.json');
    if (!fs.existsSync(rf)) { say(false, t.file, `${t.resolution} has not been counted`, t.path); continue; }
    const r = JSON.parse(fs.readFileSync(rf, 'utf8'));
    if (!r.outcome?.carried) { say(false, t.file, `${t.resolution} did not carry, so it authorises nothing (art-08/§45/¶1)`, t.path); continue; }
    const cap = P.value.issue_cap_per_resolution;
    if (t.amount > cap) { say(false, t.file, `${t.amount} exceeds the cap of ${cap} per resolution`, t.path); continue; }
    if (!dry) append(ROOT, { at: t.at, author: t.by, kind: 'value.issued', provision: 'art-09/§49/¶1',
      payload: { amount: t.amount, unit: P.value.unit, to: t.to || 'treasury', resolution: t.resolution } });
    say(true, `issued ${t.amount} ${P.value.unit} to ${t.to || 'treasury'} under ${t.resolution}`);
    done(t.path);
    continue;
  }

  // art-09/§51/¶1 — an entity issues a share in itself, through an organ.
  if (t.kind === 'instrument-issue') {
    const types = P.entities.types;
    const ent = acct.get(t.issuer);
    if (!ent || ent.kind !== 'entity') { say(false, t.file, `${t.issuer} is not an entity`, t.path); continue; }
    if (!types[ent.type]?.may_issue_instruments) { say(false, t.file, `a ${ent.type} may not issue instruments (art-04/§20/¶3)`, t.path); continue; }
    if (!mayActFor(ROOT, t.by, t.issuer)) { say(false, t.file, `${t.by} is not an organ of ${t.issuer}`, t.path); continue; }
    if (!dry) append(ROOT, { at: t.at, author: t.by, entity: t.issuer, kind: 'instrument.issued', provision: 'art-09/§51/¶1',
      payload: { instrument: t.instrument, issuer: t.issuer, class: t.class, quantity: t.quantity, to: t.to } });
    say(true, `${t.issuer} issued ${t.quantity} × ${t.instrument} to ${t.to}`);
    done(t.path);
    continue;
  }

  if (!acct.has(t.from) || !acct.has(t.to)) { say(false, t.file, 'unknown account', t.path); continue; }
  if (!mayActFor(ROOT, t.by, t.from)) { say(false, t.file, `${t.by} may not act for ${t.from} (art-02/§12/¶3)`, t.path); continue; }

  const sig = checkSignature(ROOT, t, t.by);
  if (!sig.ok) { say(false, t.file, sig.error, t.path); continue; }

  if (t.kind === 'transfer') {
    const bal = state.balances.get(t.from) || 0;
    if (!P.value.transfer.allow_negative && bal < t.amount) { say(false, t.file, `${t.from} holds ${bal}, needs ${t.amount}`, t.path); continue; }
    if (!dry) append(ROOT, { at: t.at, author: t.by, kind: 'value.transferred', provision: 'art-09/§50/¶2',
      payload: { from: t.from, to: t.to, amount: t.amount, unit: P.value.unit, ...(t.note ? { note: t.note } : {}) } });
    say(true, `${t.from} → ${t.to}  ${t.amount} ${P.value.unit}`);
  } else {
    const held = (state.holdings.get(t.from) || new Map()).get(t.instrument) || 0;
    if (held < t.quantity) { say(false, t.file, `${t.from} holds ${held} of ${t.instrument}`, t.path); continue; }
    if (!dry) append(ROOT, { at: t.at, author: t.by, kind: 'instrument.transferred', provision: 'art-09/§51/¶2',
      payload: { from: t.from, to: t.to, instrument: t.instrument, quantity: t.quantity } });
    say(true, `${t.from} → ${t.to}  ${t.quantity} × ${t.instrument}`);
  }
  done(t.path);
}

// ---- entity acts -------------------------------------------------------------
//
//   art-04/§21/¶2  an organ holds only the authority the charter confers
//   art-04/§21/¶3  a charter must not be inconsistent with this Constitution
//   art-04/§23/¶1  an entity is dissolved by its charter's procedure, by
//                  resolution of its members, or by judgment of the Court
//
// The register cannot be edited through a prefilled link, so an act on an entity
// is signed like anything else and applied here.

const acts = loadPending(ROOT, 'entity-acts');
if (acts.length) console.log(`\nEntity acts (${acts.length})`);

for (const act of acts) {
  const file = path.join(ROOT, `register/entities/${act.entity}.yml`);
  if (!fs.existsSync(file)) { say(false, act.file, `no entity ${act.entity}`, act.path); continue; }

  const sig = checkSignature(ROOT, act, act.by);
  if (!sig.ok) { say(false, act.file, sig.error, act.path); continue; }
  if (!mayActFor(ROOT, act.by, act.entity)) { say(false, act.file, `${act.by} is not an organ of ${act.entity} (art-04/§21/¶2)`, act.path); continue; }

  const doc = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  let what = '';

  switch (act.kind) {
    case 'charter.amend': {
      const charter = doc.charter || `charters/${act.entity}.md`;
      if (!dry) {
        fs.mkdirSync(path.join(ROOT, path.dirname(charter)), { recursive: true });
        fs.writeFileSync(path.join(ROOT, charter), act.text);
      }
      what = `charter of ${act.entity} amended`;
      break;
    }
    case 'organ.set': {
      doc.organs = act.organs;
      what = `organs of ${act.entity} set to ${act.organs.map((o) => o.name).join(', ')}`;
      break;
    }
    case 'member.admit': {
      doc.members = [...new Set([...(doc.members || []), ...[].concat(act.members)])];
      what = `${[].concat(act.members).join(', ')} admitted to ${act.entity}`;
      break;
    }
    case 'member.remove': {
      const out = new Set([].concat(act.members));
      doc.members = (doc.members || []).filter((m) => !out.has(m));
      what = `${[...out].join(', ')} removed from ${act.entity}`;
      break;
    }
    case 'entity.dissolve': {
      doc.status = 'dissolved';
      doc.dissolved = act.at.slice(0, 10);
      what = `${act.entity} dissolved`;
      break;
    }
    default:
      say(false, act.file, `unknown act "${act.kind}"`, act.path);
      continue;
  }

  if (!dry && act.kind !== 'charter.amend') fs.writeFileSync(file, yaml.dump(doc));
  if (!dry) append(ROOT, { at: act.at, author: act.by, entity: act.entity, kind: act.kind,
    provision: act.kind === 'entity.dissolve' ? 'art-04/§23/¶1' : 'art-04/§21/¶2',
    payload: { entity: act.entity, ...(act.members ? { members: act.members } : {}), ...(act.organs ? { organs: act.organs } : {}) } });
  say(true, what);
  done(act.path);
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
  if (!sig.ok) { say(false, o.file, sig.error, o.path); continue; }
  if (!mayActFor(ROOT, o.by, o.account)) { say(false, o.file, `${o.by} may not act for ${o.account}`, o.path); continue; }
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
// Exit 0 whatever was refused. The workflow fails only when the register does.
if (refusals.length) {
  console.log('\nRefused, and set aside in refused/ with the reason:');
  for (const r of refusals) console.log(`  ${r.what}${r.why ? ' — ' + r.why : ''}`);
}
process.exit(0);
