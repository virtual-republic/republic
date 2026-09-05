#!/usr/bin/env node
// Places an order on the exchange.
//
//   art-09/§52/¶2  the exchange clears by periodic auction at a uniform price,
//                  and gives no priority to the order of arrival within a period
//   art-09/§52/¶3  every order, every clearing, and every price is published
//
//   node tools/order.js --side buy --instrument e-0001:ordinary --quantity 10 --price 25 --by c-0006

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonical } from './lib/events.js';
import { sign } from './lib/sshsig.js';
import { accounts, mayActFor, ledgerState } from './lib/value.js';

const ROOT = process.cwd();
const a = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };

const side = a('side'), instrument = a('instrument');
const quantity = Number(a('quantity')), price = Number(a('price'));
const by = a('by'), account = a('account', by);

if (!['buy', 'sell'].includes(side) || !instrument || !quantity || !price || !by) {
  console.error('usage: node tools/order.js --side buy|sell --instrument <entity>:<class> --quantity N --price N --by <citizen> [--account <account>]');
  process.exit(2);
}
if (!accounts(ROOT).has(account)) { console.error(`"${account}" is not an account.`); process.exit(1); }
if (!mayActFor(ROOT, by, account)) { console.error(`${by} may not act for ${account}.`); process.exit(1); }

const state = ledgerState(ROOT);
if (side === 'sell') {
  const held = (state.holdings.get(account) || new Map()).get(instrument) || 0;
  if (held < quantity) { console.error(`${account} holds ${held} of ${instrument}, not ${quantity}.`); process.exit(1); }
} else {
  const bal = state.balances.get(account) || 0;
  if (bal < quantity * price) { console.error(`${account} holds ${bal}; the order needs ${quantity * price}.`); process.exit(1); }
}

const body = { kind: 'order', side, instrument, quantity, price, account, by,
  at: new Date().toISOString(), salt: crypto.randomBytes(8).toString('hex') };
body.signature = sign(canonical(body), fs.readFileSync(`private/${by}.pem`, 'utf8'), { namespace: 'republic' });

fs.mkdirSync(path.join(ROOT, 'orders'), { recursive: true });
const id = `${body.at.replace(/[:.]/g, '-')}-${account}-${side}`;
fs.writeFileSync(path.join(ROOT, `orders/${id}.json`), JSON.stringify(body, null, 2) + '\n');
console.log(`${side} ${quantity} × ${instrument} at ${price} — orders/${id}.json`);
console.log('Clears at the next auction: node tools/settle.js');
