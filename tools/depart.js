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
import yaml from 'js-yaml';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const keepIdx = args.indexOf('--all-except');
const keep = keepIdx !== -1 ? args[keepIdx + 1] : null;
const one = args.find((a) => /^c-\d{4}$/.test(a) && a !== keep);
const officesTo = (() => { const i = args.indexOf('--offices-to'); return i === -1 ? keep : args[i + 1]; })();

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
    if (officesTo) {
      // art-06/§29/¶4 — on vacancy the Assembly appoints until an election is
      // held. The Assembly is all citizens (art-06/§30/¶1).
      const f = path.join(ROOT, 'register/offices.yml');
      let src = fs.readFileSync(f, 'utf8');
      src = src.replace(new RegExp(`^(\\s*holder:\\s*)${id}\\s*$`, 'gm'), `$1${officesTo}`);
      fs.writeFileSync(f, src);
      for (const o of held) {
        append(ROOT, {
          at: new Date().toISOString(),
          author: officesTo,
          kind: 'office.appointed',
          provision: 'art-06/§29/¶4',
          payload: { office: o.id, holder: officesTo, from: id },
        });
      }
      console.log(`  ${held.map((o) => o.id).join(', ')} appointed to ${officesTo} (art-06/§29/¶4)`);

      // The Keeper signs checkpoints; if that office moved, so must the key
      // the verifier checks against (art-02/§10/¶2).
      if (held.some((o) => (o.permissions || []).includes('checkpoint.sign'))) {
        const heir = citizens(ROOT).find((c) => c.id === officesTo);
        const key = (heir && heir.keys && heir.keys[0]) || null;
        if (key) {
          fs.writeFileSync(path.join(ROOT, 'register/keepers.txt'), key.split(/\s+/).slice(0, 2).join(' ') + ' ' + officesTo + '\n');
          console.log(`  register/keepers.txt now holds ${officesTo}'s key (art-02/§10/¶2)`);
        } else {
          console.log(`  warning: ${officesTo} has no key on the register; keepers.txt unchanged`);
        }
      }
    } else {
      console.log(`  note: ${id} held ${held.map((o) => o.id).join(', ')} — now vacant (art-06/§29/¶4)`);
    }
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
const held = offices(ROOT);
if (held.length) console.log(`Offices: ${held.map((o) => `${o.id}=${o.holder}`).join(', ')}`);
