#!/usr/bin/env node
// Signs a ballot (art-08/§43/¶2).
// usage: node tools/sign.js <proposal-id> <choice> <citizen-id> [keyfile]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonical } from './lib/events.js';
import { sign } from './lib/sshsig.js';

const [, , proposal, rawChoice, citizen, keyfile] = process.argv;
if (!proposal || !rawChoice || !citizen) {
  console.error('usage: node tools/sign.js <proposal-id> <choice|a,b,c> <citizen-id> [keyfile]');
  process.exit(2);
}
const key = keyfile || `private/${citizen}.pem`;
if (!fs.existsSync(key)) { console.error(`no key at ${key} — run: node tools/keygen.js ${citizen}`); process.exit(2); }

const choice = rawChoice.includes(',') ? rawChoice.split(',').map((s) => s.trim()) : rawChoice;
const salt = crypto.randomBytes(16).toString('hex');
const message = canonical({ proposal, choice, salt });
const ballot = { proposal, choice, salt, signature: sign(message, fs.readFileSync(key, 'utf8'), { namespace: 'republic' }) };

const dir = path.join('ballots', proposal);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${citizen}.json`), JSON.stringify(ballot, null, 2) + '\n');
console.log(`Ballot written to ${dir}/${citizen}.json`);
console.log(`Your receipt: ${crypto.createHash('sha256').update(message).digest('hex').slice(0, 16)}`);
