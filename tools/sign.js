#!/usr/bin/env node
// Signs a ballot (art-08/§43/¶2).
// usage: node tools/sign.js <proposal-id> <choice> <citizen-id> [keyfile]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonical } from './lib/events.js';
import { sign } from './lib/sshsig.js';
import { readKey } from './lib/key.js';

const [, , proposal, rawChoice, citizen, keyfile] = process.argv;
if (!proposal || !rawChoice || !citizen) {
  console.error('usage: node tools/sign.js <proposal-id> <choice|a,b,c> <citizen-id> [keyfile]');
  process.exit(2);
}
let material;
try { material = keyfile ? fs.readFileSync(keyfile, 'utf8') : readKey(process.cwd(), citizen); }
catch (e) { console.error(e.message); process.exit(2); }

const choice = rawChoice.includes(',') ? rawChoice.split(',').map((s) => s.trim()) : rawChoice;
const salt = crypto.randomBytes(16).toString('hex');
const at = new Date().toISOString();
// The timestamp is inside the signed payload: a later ballot provably replaces
// an earlier one, and an old ballot cannot be replayed to undo a change of mind.
const message = canonical({ proposal, choice, at, salt });
const ballot = { proposal, choice, at, salt, signature: sign(message, material, { namespace: 'republic' }) };

const dir = path.join('ballots', proposal);
fs.mkdirSync(dir, { recursive: true });
const existedBefore = fs.existsSync(path.join(dir, `${citizen}.json`));
fs.writeFileSync(path.join(dir, `${citizen}.json`), JSON.stringify(ballot, null, 2) + '\n');
const existed = existedBefore;
console.log(`Ballot written to ${dir}/${citizen}.json${existed ? ' (replacing your earlier ballot)' : ''}`);
console.log(`Your receipt: ${crypto.createHash('sha256').update(message).digest('hex').slice(0, 16)}`);
