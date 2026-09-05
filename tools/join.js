#!/usr/bin/env node
// Adds a citizenship to the register from a private key file.
//
//   node tools/join.js ~/Downloads/citizenship-key.pem
//   node tools/join.js ~/Downloads/citizenship-key.pem c-0002
//
// Works out the next free identifier if you don't give one. Reads the public
// half out of the private key, so there is nothing to copy or paste.
//
// art-03/§16/¶3 — admission takes effect on the recording of the application.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { publicKeyLine } from './lib/sshsig.js';
import { append } from './lib/events.js';
import { citizens } from './lib/registers.js';

const ROOT = process.cwd();
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const keyArg = process.argv[2];
let id = process.argv[3];

if (!keyArg) {
  console.error('usage: node tools/join.js <path-to-private-key.pem> [c-0002]');
  console.error('\nThe private key is the file that begins "-----BEGIN PRIVATE KEY-----".');
  process.exit(2);
}

const keyPath = keyArg.replace(/^~/, os.homedir());
if (!fs.existsSync(keyPath)) {
  console.error(`No file at ${keyPath}`);
  process.exit(2);
}

// --- read the public half out of the private key ---------------------------

const material = fs.readFileSync(keyPath, 'utf8');

if (material.includes('BEGIN OPENSSH PRIVATE KEY')) {
  console.error('That is an OpenSSH key, not the one this makes.');
  console.error('Use the .pem the website downloaded, or run: node tools/keygen.js c-0002');
  process.exit(2);
}
if (!material.includes('BEGIN PRIVATE KEY')) {
  console.error('That file is not a private key. It should begin "-----BEGIN PRIVATE KEY-----".');
  console.error('If it begins "ssh-ed25519" it is the public key — you need the other one.');
  process.exit(2);
}

// Normalise: strip blank lines and re-wrap, so a PEM saved by any tool works.
const normalised = (() => {
  const body = material.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  return `-----BEGIN PRIVATE KEY-----\n${body.replace(/(.{64})/g, '$1\n').trim()}\n-----END PRIVATE KEY-----\n`;
})();

let raw;
try {
  const priv = crypto.createPrivateKey(normalised);
  const spki = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' });
  raw = spki.subarray(SPKI_PREFIX.length);
} catch (e) {
  console.error(`Could not read that key: ${e.message}`);
  process.exit(2);
}

// --- pick an identifier ----------------------------------------------------

fs.mkdirSync(path.join(ROOT, 'register/citizens'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'ledger'), { recursive: true });
const roll = citizens(ROOT);

if (!id) {
  const nums = roll.map((c) => Number(String(c.id).replace('c-', ''))).filter(Number.isFinite);
  id = 'c-' + String(Math.max(0, ...nums) + 1).padStart(4, '0');
}

if (roll.some((c) => c.id === id)) {
  console.error(`${id} is already on the register.`);
  process.exit(1);
}

const line = publicKeyLine(raw, id);

// art-02/§13/¶3 — each citizenship must have a key no other holds.
for (const c of roll) {
  for (const k of c.keys || []) {
    if (k.split(/\s+/)[1] === line.split(/\s+/)[1]) {
      console.error(`That key already belongs to ${c.id} (art-02/§13/¶3).`);
      console.error('Make a fresh key for a second citizenship: node tools/keygen.js ' + id);
      process.exit(1);
    }
  }
}

// --- record it -------------------------------------------------------------

const today = new Date().toISOString().slice(0, 10);

fs.writeFileSync(
  path.join(ROOT, `register/citizens/${id}.yml`),
  [`id: ${id}`, `status: active`, `admitted: ${today}`, `admitted_under: art-03/§16/¶3`, `keys:`, `  - ${line}`, ''].join('\n')
);

append(ROOT, {
  at: new Date().toISOString(),
  author: id,
  kind: 'citizen.admitted',
  provision: 'art-03/§16/¶3',
  payload: { citizen: id },
});

// Keep the key where the other tools look for it.
const dest = path.join(ROOT, `private/${id}.pem`);
fs.mkdirSync(path.join(ROOT, 'private'), { recursive: true });
if (path.resolve(keyPath) !== path.resolve(dest)) {
  fs.copyFileSync(keyPath, dest);
  fs.chmodSync(dest, 0o600);
}

console.log(`Admitted ${id}.`);
console.log(`  register/citizens/${id}.yml written`);
console.log(`  private key copied to private/${id}.pem (gitignored)`);
console.log(`  record appended to the ledger`);
console.log(`\nNow: npm test && npm run verify && git add -A && git commit -m "admit ${id}" && git push`);
