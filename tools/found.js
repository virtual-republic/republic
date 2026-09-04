#!/usr/bin/env node
// Founds the Republic for real, with a real person and a real key.
//
// `npm run seed` created five placeholder founders so the machinery could be
// tested. This replaces them. It clears the seeded register, ledger, and
// Journal and writes a genuine founding under art-11/§64.
//
// This is the ONE moment at which clearing the register is legitimate: the
// Constitution takes effect on publication in the first issue of the Journal
// (art-11/§64/¶1), and until that issue exists there is nothing yet to alter.
// After it exists, art-02/§9 applies and this tool must never be run again.
// It refuses to run if any citizen other than the seeded placeholders exists.
//
// Usage:
//   node tools/found.js --id c-0001 --key ~/.ssh/id_ed25519.pub --name "Your Name"
//   node tools/found.js --id c-0001 --generate --name "Your Name"

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parsePublicKey, generateKeyPair } from './lib/sshsig.js';
import { append } from './lib/events.js';
import { citizens } from './lib/registers.js';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const id = arg('id', 'c-0001');
const name = arg('name', null);
const keyArg = arg('key', null);

if (!/^c-\d{4}$/.test(id)) {
  console.error('--id must look like c-0001');
  process.exit(2);
}

// --- refuse if the Republic has really begun -------------------------------

const SEEDED = new Set(['c-0001', 'c-0002', 'c-0003', 'c-0004', 'c-0005']);
const existing = citizens(ROOT);
const real = existing.filter((c) => !SEEDED.has(c.id));
if (real.length) {
  console.error('Refusing: this Republic has citizens beyond the seeded placeholders.');
  console.error(`Found: ${real.map((c) => c.id).join(', ')}`);
  console.error('art-02/§9 — a record, once committed, must not be altered.');
  process.exit(1);
}

// --- the key ---------------------------------------------------------------

let publicKeyLine;
if (flag('generate')) {
  const kp = generateKeyPair(id);
  fs.mkdirSync(path.join(ROOT, 'private'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, `private/${id}.pem`), kp.privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(path.join(ROOT, 'private/keeper.pem'), kp.privateKeyPem, { mode: 0o600 });
  publicKeyLine = kp.publicKeyLine;
  console.log(`Generated a key. Private key: private/${id}.pem — never commit it.\n`);
} else {
  const candidates = keyArg
    ? [keyArg.replace(/^~/, os.homedir())]
    : [path.join(os.homedir(), '.ssh/id_ed25519.pub')];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) {
    console.error('No public key found. Pass --key <path>, or --generate to make one.');
    console.error('If you have none: ssh-keygen -t ed25519 -C "' + id + '"');
    process.exit(2);
  }
  publicKeyLine = fs.readFileSync(file, 'utf8').trim();
  console.log(`Using ${file}\n`);
}

try {
  parsePublicKey(publicKeyLine);
} catch (e) {
  console.error(`That key is not usable: ${e.message}`);
  console.error('Only ssh-ed25519 keys are accepted. Make one with:');
  console.error('  ssh-keygen -t ed25519 -C "' + id + '"');
  process.exit(2);
}

// Normalise the comment to the citizen id, so the register never carries a
// name or an email address that ssh-keygen put there (art-07/§37/¶2).
const parts = publicKeyLine.trim().split(/\s+/);
publicKeyLine = `${parts[0]} ${parts[1]} ${id}`;

// --- clear the rehearsal ---------------------------------------------------

const citizensDir = path.join(ROOT, 'register/citizens');
for (const f of fs.readdirSync(citizensDir).filter((f) => f.endsWith('.yml'))) {
  fs.unlinkSync(path.join(citizensDir, f));
}
for (const f of fs.existsSync(path.join(ROOT, 'private')) ? fs.readdirSync(path.join(ROOT, 'private')) : []) {
  if (/^c-\d{4}\.pem$/.test(f) && f !== `${id}.pem`) fs.unlinkSync(path.join(ROOT, 'private', f));
}
const entitiesDir = path.join(ROOT, 'register/entities');
for (const f of fs.readdirSync(entitiesDir).filter((f) => f.endsWith('.yml'))) {
  fs.unlinkSync(path.join(entitiesDir, f));
}
fs.rmSync(path.join(ROOT, 'ledger/events.jsonl'), { force: true });
fs.rmSync(path.join(ROOT, 'checkpoints'), { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, 'checkpoints'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'journal/2026'))) {
  fs.unlinkSync(path.join(ROOT, 'journal/2026', f));
}
fs.rmSync(path.join(ROOT, 'ballots'), { recursive: true, force: true });

// --- the register ----------------------------------------------------------

const today = new Date().toISOString().slice(0, 10);

fs.writeFileSync(
  path.join(citizensDir, `${id}.yml`),
  [
    `id: ${id}`,
    `status: active`,
    `admitted: ${today}`,
    `admitted_under: art-11/§64/¶2`,
    `keys:`,
    `  - ${publicKeyLine}`,
    '',
  ].join('\n')
);

const OFFICES = [
  ['registrar', 'Registrar', ['register.admit', 'register.object', 'entity.register']],
  ['keeper', 'Keeper of the Journal', ['journal.publish', 'checkpoint.sign']],
  ['treasurer', 'Treasurer', ['value.issue', 'treasury.disburse']],
  ['auditor', 'Auditor', ['audit.report']],
];

fs.writeFileSync(
  path.join(ROOT, 'register/offices.yml'),
  '# Held in plurality under art-11/§65/¶1 until the Republic has five citizens.\noffices:\n' +
    OFFICES.map(([oid, title, perms]) =>
      [
        `  - id: ${oid}`,
        `    title: ${title}`,
        `    holder: ${id}`,
        `    since: ${today}`,
        `    term_ends: ${Number(today.slice(0, 4)) + 1}${today.slice(4)}`,
        `    established_under: art-06/§28/¶1`,
        `    held_under: art-11/§65/¶1`,
        `    permissions: [${perms.join(', ')}]`,
      ].join('\n')
    ).join('\n') +
    '\n'
);

fs.writeFileSync(path.join(ROOT, 'register/keepers.txt'), publicKeyLine + '\n');

// Personal data lives apart and is not committed (art-07/§37/¶2).
fs.mkdirSync(path.join(ROOT, 'private'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'private/persons.json'),
  JSON.stringify({ [id]: { display: name || id, joined: today } }, null, 2)
);

// --- the founding records --------------------------------------------------

let n = 0;
const at = () => new Date(Date.now() + n++ * 1000).toISOString();
const record = (kind, provision, payload) => append(ROOT, { at: at(), author: id, kind, provision, payload });

record('constitution.enacted', 'art-11/§64/¶1', { version: '1.0.0', languages: ['en', 'fr'] });
record('citizen.admitted', 'art-11/§64/¶2', { citizen: id });
for (const [oid] of OFFICES) {
  record('office.taken', 'art-11/§65/¶1', { office: oid, holder: id });
}

// --- the first issue of the Journal ----------------------------------------

fs.writeFileSync(
  path.join(ROOT, 'journal/2026/0001-founding.md'),
  `---
number: 1
date: ${today}
title_en: Founding of the Republic
title_fr: Fondation de la République
cites: art-11/§64
---

The Constitution takes effect this day, on its publication in this issue, under
Article 11 § 64 ¹.

The founding citizen is ${id}, named in the first record of the register, under
Article 11 § 64 ².

The offices of Article 6 § 28 are held in plurality under Article 11 § 65 ¹,
which ceases to have effect when the Republic has five citizens.
`
);

console.log(`Founded.`);
console.log(`  citizen   ${id}${name ? ` (${name}, in private/persons.json only)` : ''}`);
console.log(`  offices   ${OFFICES.map(([o]) => o).join(', ')} — art-11/§65/¶1`);
console.log(`  records   ${n + 1}`);
console.log(`\nNext:`);
console.log(`  npm run test && npm run verify`);
console.log(`  npm run checkpoint`);
console.log(`  git add -A && git commit -m "Founding (art-11/§64)" && git push`);
