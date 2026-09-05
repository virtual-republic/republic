#!/usr/bin/env node
// What the ledger says anyone holds, and why a transfer would fail.
//
//   node tools/value.js              everything
//   node tools/value.js c-0006       one account
//   node tools/value.js --accounts   who may hold value at all

import { ledgerState, accounts, TREASURY } from './lib/value.js';
import { params } from './lib/params.js';
import { read } from './lib/events.js';

const ROOT = process.cwd();
const who = process.argv[2];
const s = ledgerState(ROOT);
const acct = accounts(ROOT);
const UNIT = params(ROOT).value.unit;

if (process.argv.includes('--accounts')) {
  console.log('Accounts (art-09/§50/¶1 — a citizen or an entity whose type may hold one):\n');
  for (const [id, m] of acct) console.log(`  ${id.padEnd(12)} ${m.kind}${m.organs?.length ? '  organs: ' + m.organs.map((o) => o.name + '=' + (o.held_by || []).join('/')).join(', ') : ''}`);
  process.exit(0);
}

const show = (id) => {
  const bal = s.balances.get(id) || 0;
  const held = [...(s.holdings.get(id) || new Map())].filter(([, q]) => q > 0);
  console.log(`  ${id.padEnd(12)} ${String(bal).padStart(8)} ${UNIT}${held.length ? '   ' + held.map(([i, q]) => `${q} × ${i}`).join(', ') : ''}`);
};

if (who && who !== '--accounts') {
  if (!acct.has(who)) {
    console.error(`"${who}" is not an account.`);
    console.error(`Accounts are: ${[...acct.keys()].join(', ')}`);
    console.error(`A citizenship must be active, and an entity must be of a type that may hold one.`);
    process.exit(1);
  }
  show(who);
  console.log('');
  for (const e of read(ROOT)) {
    const p = e.payload || {};
    if ([p.to, p.from, p.buyer, p.seller].includes(who))
      console.log(`  ${e.at.slice(0, 16).replace('T', ' ')}  ${e.kind.padEnd(22)} ${JSON.stringify(p)}`);
  }
  process.exit(0);
}

console.log(`Issued in total: ${s.issued} ${UNIT}\n`);
for (const id of acct.keys()) show(id);
if (s.instruments.size) {
  console.log('\nInstruments:');
  for (const [i, m] of s.instruments) console.log(`  ${i.padEnd(24)} issued ${m.issued} by ${m.issuer}`);
}
