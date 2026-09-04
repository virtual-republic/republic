#!/usr/bin/env node
// Records a departure (art-03/§18/¶1) — a citizen may depart at any time by a
// signed record, and may return by the procedure for admission.
//
// The citizenship is marked departed, not deleted. art-02/§9 forbids altering
// records, and the admission record stays in the register; what changes is the
// present roll. A departed citizenship counts toward no quorum and casts no
// ballot, because tools/lib/registers.js counts only active ones.
//
// Usage:
//   node tools/depart.js c-0002
//   node tools/depart.js --all-except c-0001

import fs from 'node:fs';
import path from 'node:path';
import { append } from './lib/events.js';
import { citizens, offices } from './lib/registers.js';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const keepIdx = args.indexOf('--all-except');
const keep = keepIdx !== -1 ? args[keepIdx + 1] : null;
const one = args.find((a) => /^c-\d{4}$/.test(a) && a !== keep);

const roll = citizens(ROOT);
const targets = keep
  ? roll.filter((c) => c.id !== keep && c.status === 'active').map((c) => c.id)
  : one ? [one] : [];

if (!targets.length) {
  console.error('usage: node tools/depart.js <c-0002> | --all-except <c-0001>');
  console.error('\non the register:');
  for (const c of roll) console.error(`  ${c.id}  ${c.status}`);
  process.exit(2);
}

const active = roll.filter((c) => c.status === 'active');
if (targets.length >= active.length) {
  console.error('That would leave no citizen. art-11/§65/¶3 — a Republic of one citizen is a Republic, but not of none.');
  process.exit(1);
}

for (const id of targets) {
  const c = roll.find((x) => x.id === id);
  if (!c) { console.error(`${id} is not on the register`); continue; }
  if (c.status !== 'active') { console.log(`${id} is already ${c.status}`); continue; }

  const held = offices(ROOT).filter((o) => o.holder === id);
  if (held.length) {
    console.log(`  note: ${id} held ${held.map((o) => o.id).join(', ')} — those offices are now vacant (art-06/§29/¶4)`);
  }

  const file = path.join(ROOT, `register/citizens/${c.file}`);
  const src = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, src.replace(/^status:\s*active\s*$/m,
    `status: departed\ndeparted: ${new Date().toISOString().slice(0, 10)}\ndeparted_under: art-03/§18/¶1`));

  append(ROOT, {
    at: new Date().toISOString(),
    author: id,
    kind: 'citizen.departed',
    provision: 'art-03/§18/¶1',
    payload: { citizen: id },
  });

  console.log(`${id} departed.`);
}

const remaining = citizens(ROOT).filter((c) => c.status === 'active');
console.log(`\n${remaining.length} active citizenship(s): ${remaining.map((c) => c.id).join(', ')}`);
console.log('Quorums are reckoned against that number — art-08/§44/¶2.');
