#!/usr/bin/env node
// Installs a key so the tools can find it, and says who it belongs to.
//
//   node tools/key.js find                     look for keys and say whose they are
//   node tools/key.js import                    import the one it finds
//   node tools/key.js import <file> [citizen]   import a particular one
//   node tools/key.js list                      what is already installed

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

// Keys arrive with whatever name the browser gave them, and that name has
// changed. Look rather than guess.
function candidates() {
  const home = os.homedir();
  const dirs = [path.join(home, 'Downloads'), path.join(home, 'Desktop'), home, ROOT];
  const seen = new Set(), out = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const f of names) {
      if (!/\.(pem|txt|key)$/i.test(f)) continue;
      const full = path.join(d, f);
      if (seen.has(full)) continue;
      seen.add(full);
      let body = '';
      try { body = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (!body.includes('BEGIN PRIVATE KEY')) continue;
      let who = null;
      try { who = identify(ROOT, body); } catch {}
      out.push({ path: full, citizen: who?.citizen ?? null, publicKeyLine: who?.publicKeyLine ?? null,
                 when: (() => { try { return fs.statSync(full).mtime; } catch { return new Date(0); } })() });
    }
  }
  return out.sort((a, b) => b.when - a.when);
}

if (cmd === 'find') {
  const found = candidates();
  if (!found.length) {
    console.log('No private keys found in Downloads, Desktop, your home directory, or here.');
    console.log('The website downloads yours when you create a citizenship — check where your browser puts files.');
    console.log('If you have none:  node tools/keygen.js c-0006');
    process.exit(0);
  }
  console.log(`Found ${found.length} key${found.length === 1 ? '' : 's'}:\n`);
  for (const f of found) {
    console.log(`  ${f.path}`);
    console.log(`      ${f.citizen ? f.citizen + ' — on the register' : 'not on the register'}`);
  }
  console.log(`\nImport one:  node tools/key.js import "${found[0].path}"`);
  process.exit(0);
}

if (cmd !== 'import') {
  console.error('usage:\n  node tools/key.js find\n  node tools/key.js import [file.pem] [citizen]\n  node tools/key.js list');
  process.exit(2);
}

let src = (process.argv[3] || '').replace(/^~/, os.homedir());

// No path given, or the path is wrong: find it.
if (!src || !fs.existsSync(src)) {
  const found = candidates();
  const known = found.filter((f) => f.citizen);
  const pick = known[0] || found[0];
  if (!pick) {
    console.error(src ? `No file at ${src}, and no key found elsewhere.` : 'No key given, and none found.');
    console.error('Looked in Downloads, Desktop, your home directory, and here.');
    console.error('Run  node tools/key.js find  to see what is about, or  node tools/keygen.js c-0006  to make one.');
    process.exit(2);
  }
  if (src) console.error(`No file at ${src}.`);
  console.log(`Using ${pick.path}${pick.citizen ? ` — it belongs to ${pick.citizen}` : ''}`);
  if (found.length > 1) console.log(`(${found.length - 1} other key${found.length === 2 ? '' : 's'} found; run "node tools/key.js find" to see them.)\n`);
  src = pick.path;
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
