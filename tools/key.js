#!/usr/bin/env node
// Installs a key so the tools can find it, and says who it belongs to.
//
//   node tools/key.js import ~/Downloads/citizenship.pem
//   node tools/key.js import ~/Downloads/citizenship.pem c-0006
//   node tools/key.js list

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { identify, normalise } from './lib/key.js';
import { citizens } from './lib/registers.js';

const ROOT = process.cwd();
const cmd = process.argv[2];

if (cmd === 'list') {
  const dir = path.join(ROOT, 'private');
  const have = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.pem')) : [];
  if (!have.length) { console.log('private/ holds no keys.'); process.exit(0); }
  for (const f of have) {
    try {
      const who = identify(ROOT, fs.readFileSync(path.join(dir, f), 'utf8'));
      console.log(`  ${f.padEnd(20)} ${who.citizen ? who.citizen + ' — on the register' : 'not on the register'}`);
    } catch { console.log(`  ${f.padEnd(20)} unreadable`); }
  }
  process.exit(0);
}

if (cmd !== 'import') {
  console.error('usage:\n  node tools/key.js import <file.pem> [citizen]\n  node tools/key.js list');
  process.exit(2);
}

const src = (process.argv[3] || '').replace(/^~/, os.homedir());
if (!src || !fs.existsSync(src)) {
  console.error(`No file at ${src || '(nothing given)'}`);
  console.error('The website downloads your key as citizenship.pem, usually to ~/Downloads.');
  process.exit(2);
}

const pem = fs.readFileSync(src, 'utf8');
if (pem.includes('BEGIN OPENSSH PRIVATE KEY')) {
  console.error('That is an OpenSSH key, which the browser tools cannot read.');
  console.error('Use the .pem the website downloaded, or run: node tools/keygen.js <citizen>');
  process.exit(2);
}
if (!pem.includes('PRIVATE KEY')) {
  console.error('That file is not a private key. It should begin "-----BEGIN PRIVATE KEY-----".');
  console.error('If it begins "ssh-ed25519" it is the public half — you need the other one.');
  process.exit(2);
}

let who;
try { who = identify(ROOT, pem); }
catch (e) { console.error(`Could not read that key: ${e.message}`); process.exit(2); }

const id = process.argv[4] || who.citizen;
if (!id) {
  console.error('That key is not on the register, so I cannot tell whose it is.');
  console.error('Give the citizenship explicitly:  node tools/key.js import <file> c-0006');
  console.error(`\nIts public half is:\n  ${who.publicKeyLine}`);
  process.exit(1);
}
if (who.citizen && who.citizen !== id) {
  console.error(`That key belongs to ${who.citizen}, not ${id}.`);
  process.exit(1);
}

fs.mkdirSync(path.join(ROOT, 'private'), { recursive: true });
fs.writeFileSync(path.join(ROOT, `private/${id}.pem`), normalise(pem), { mode: 0o600 });
console.log(`Installed as private/${id}.pem${who.citizen ? ' — matches the register' : ' — not yet on the register'}`);
console.log('private/ is gitignored; the key never leaves this machine.');
