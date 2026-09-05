#!/usr/bin/env node
// Signs a transfer. Nothing is settled here — the instrument is a file, and
// tools/settle.js verifies and records it.
//
//   art-02/§12/¶3  no account may be debited except by its holder
//   art-09/§50/¶2  a transfer is a record and takes effect when recorded
//
//   node tools/pay.js --from c-0006 --to e-0001 --amount 250 --by c-0006
//   node tools/pay.js --from c-0006 --to c-0007 --instrument e-0001:ordinary --quantity 10 --by c-0006

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonical } from './lib/events.js';
import { sign } from './lib/sshsig.js';
import { accounts, mayActFor, ledgerState, TREASURY } from './lib/value.js';
import { params } from './lib/params.js';

const ROOT = process.cwd();
const a = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };

const from = a('from'), to = a('to'), by = a('by', from);
const amount = a('amount') ? Number(a('amount')) : null;
const instrument = a('instrument');
const quantity = a('quantity') ? Number(a('quantity')) : null;
const note = a('note', '');

if (!from || !to || (!amount && !quantity)) {
  console.error('usage: node tools/pay.js --from <account> --to <account> (--amount N | --instrument X --quantity N) [--by <citizen>]');
  process.exit(2);
}

const acct = accounts(ROOT);
for (const x of [from, to]) if (!acct.has(x)) { console.error(`"${x}" is not an account. Accounts: ${[...acct.keys()].join(', ')}`); process.exit(1); }
if (!mayActFor(ROOT, by, from)) { console.error(`${by} may not act for ${from} (art-02/§12/¶3, art-04/§21/¶2).`); process.exit(1); }

const state = ledgerState(ROOT);
if (amount != null) {
  const bal = state.balances.get(from) || 0;
  if (!params(ROOT).value.transfer.allow_negative && bal < amount) {
    console.error(`${from} holds ${bal} — not enough for ${amount} (art-02/§12/¶2).`);
    process.exit(1);
  }
} else {
  const held = (state.holdings.get(from) || new Map()).get(instrument) || 0;
  if (held < quantity) { console.error(`${from} holds ${held} of ${instrument}, not ${quantity}.`); process.exit(1); }
}

const key = `private/${by}.pem`;
if (!fs.existsSync(key)) { console.error(`no key at ${key}`); process.exit(2); }

const body = {
  kind: amount != null ? 'transfer' : 'instrument-transfer',
  from, to, by,
  ...(amount != null ? { amount } : { instrument, quantity }),
  ...(note ? { note } : {}),
  at: new Date().toISOString(),
  salt: crypto.randomBytes(12).toString('hex'),
};
body.signature = sign(canonical(body), fs.readFileSync(key, 'utf8'), { namespace: 'republic' });

fs.mkdirSync(path.join(ROOT, 'transfers'), { recursive: true });
const id = `${body.at.replace(/[:.]/g, '-')}-${from}-${to}`;
fs.writeFileSync(path.join(ROOT, `transfers/${id}.json`), JSON.stringify(body, null, 2) + '\n');

console.log(`Signed: ${from} → ${to} ${amount != null ? amount + ' ' + params(ROOT).value.unit : quantity + ' × ' + instrument}`);
console.log(`  transfers/${id}.json`);
console.log(`  settle with: node tools/settle.js   (or the settle workflow)`);
