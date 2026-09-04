#!/usr/bin/env node
// Forms an entity.
//
//   art-04/§19/¶1  every citizen MAY form an entity; no permission is required
//   art-04/§19/¶2  formation is a record stating type, charter, organs, members
//   art-04/§20/¶3  an entity has the capacities of its type and no others
//   art-04/§21/¶3  a charter MUST NOT be inconsistent with this Constitution
//
// Usage:
//   node tools/entity.js --name "Society of the Register" --type association --by c-0001
//   node tools/entity.js --name "Cercle du Registre" --type commune --by c-0001 \
//        --name-fr "Cercle du Registre" --organ convenor=c-0001 --members c-0001,c-0002

import fs from 'node:fs';
import path from 'node:path';
import { append } from './lib/events.js';
import { citizens, entities } from './lib/registers.js';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const all = (n) => args.reduce((acc, a, i) => (a === `--${n}` ? [...acc, args[i + 1]] : acc), []);

// art-04/§20/¶1 — the types, and no others until statute adds one.
const TYPES = {
  association: { en: 'Association', fr: 'Association', of: 'a body of members joined for a common purpose' },
  commune: { en: 'Commune', fr: 'Commune', of: 'a local community of citizens' },
  company: { en: 'Company', fr: 'Société', of: 'a body issuing instruments under art-09/§51' },
  foundation: { en: 'Foundation', fr: 'Fondation', of: 'a body holding property for a stated purpose' },
  organ: { en: 'Organ of the Republic', fr: 'Organe de la République', of: 'a body established by the Assembly' },
};

const name = arg('name');
const type = (arg('type') || 'association').toLowerCase();
const by = arg('by');
const nameFr = arg('name-fr', name);
const purpose = arg('purpose', '');

if (!name || !by) {
  console.error('usage: node tools/entity.js --name "<name>" --type <type> --by <citizen>\n');
  console.error('types:');
  for (const [k, v] of Object.entries(TYPES)) console.error(`  ${k.padEnd(12)} ${v.of}`);
  console.error('\noptional: --name-fr, --purpose, --organ role=citizen (repeatable), --members c-0001,c-0002');
  process.exit(2);
}

if (!TYPES[type]) {
  console.error(`Unknown type "${type}". art-04/§20/¶2 — statute may create further types, but until it does:`);
  for (const k of Object.keys(TYPES)) console.error(`  ${k}`);
  process.exit(1);
}

// art-04/§19/¶1 — the right belongs to citizens.
const roll = citizens(ROOT);
if (!roll.some((c) => c.id === by && c.status === 'active')) {
  console.error(`${by} is not an active citizenship. Only a citizen may form an entity (art-04/§19/¶1).`);
  process.exit(1);
}

// art-04/§22/¶2 — an entity may not be a citizen, vote, or hold an office.
const members = (arg('members') || by).split(',').map((s) => s.trim()).filter(Boolean);
for (const m of members) {
  if (!roll.some((c) => c.id === m)) { console.error(`member "${m}" is not on the register`); process.exit(1); }
}

const organs = all('organ').map((spec) => {
  const [role, holder] = String(spec).split('=');
  if (!role || !holder) { console.error(`--organ expects role=citizen, got "${spec}"`); process.exit(1); }
  for (const h of holder.split(',')) {
    if (!roll.some((c) => c.id === h.trim())) { console.error(`organ holder "${h}" is not on the register`); process.exit(1); }
  }
  return { name: role, held_by: holder.split(',').map((s) => s.trim()) };
});
if (!organs.length) organs.push({ name: 'convenor', held_by: [by] });

// --- identifier ------------------------------------------------------------

const existing = entities(ROOT);
const nums = existing.map((e) => Number(String(e.id).replace('e-', ''))).filter(Number.isFinite);
const id = arg('id') || 'e-' + String(Math.max(0, ...nums) + 1).padStart(4, '0');
if (existing.some((e) => e.id === id)) { console.error(`${id} already exists`); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);

// --- charter (art-04/§21/¶1) ----------------------------------------------

fs.mkdirSync(path.join(ROOT, 'charters'), { recursive: true });
const charterPath = `charters/${id}.md`;

if (!fs.existsSync(path.join(ROOT, charterPath))) {
  fs.writeFileSync(path.join(ROOT, charterPath), `---
id: ${id}
type: ${type}
title: ${name}
title_fr: ${nameFr}
formed: ${today}
---

## § 1  Name and type

¹ The entity is named ${name}.

² It is ${type === 'organ' ? 'an organ of the Republic' : `a ${type}`} formed under Article 4 § 19 ¹.

## § 2  Purpose

¹ ${purpose || 'The purpose of the entity is stated by its members and may be altered by them.'}

## § 3  Membership

¹ Membership is open to any citizen on application to an organ named in § 4.

² A member may withdraw at any time by a signed record.

## § 4  Organs

${organs.map((o, i) => `${'¹²³⁴⁵⁶⁷⁸⁹'[i] || i + 1} The ${o.name} is held by ${o.held_by.join(', ')} and acts for the entity within the authority this charter confers.`).join('\n\n')}

## § 5  Decisions

¹ The entity decides by a majority of its members, unless this charter provides otherwise.

² Every decision is recorded and published.

## § 6  Consistency

¹ This charter is subordinate to the Constitution, and any provision inconsistent with it is of no effect — Article 4 § 21 ³.

## § 7  Dissolution

¹ The entity is dissolved by resolution of its members, by the procedure in this charter, or by judgment of the Court.

² On dissolution its holdings pass to the Treasury, unless the resolution of dissolution provides otherwise — Article 4 § 23 ².
`);
}

// --- register entry --------------------------------------------------------

fs.mkdirSync(path.join(ROOT, 'register/entities'), { recursive: true });
fs.writeFileSync(path.join(ROOT, `register/entities/${id}.yml`), [
  `id: ${id}`,
  `type: ${type}`,
  `name_en: ${name}`,
  `name_fr: ${nameFr}`,
  `formed: ${today}`,
  `formed_by: ${by}`,
  `formed_under: art-04/§19/¶1`,
  `charter: ${charterPath}`,
  `organs:`,
  ...organs.flatMap((o) => [`  - name: ${o.name}`, `    held_by: [${o.held_by.join(', ')}]`]),
  `members: [${members.join(', ')}]`,
  `status: active`,
  '',
].join('\n'));

// --- record ----------------------------------------------------------------

append(ROOT, {
  at: new Date().toISOString(),
  author: by,
  kind: 'entity.formed',
  provision: 'art-04/§19/¶1',
  payload: { entity: id, type, name, organs: organs.map((o) => o.name), members },
});

console.log(`Formed ${id} — ${name}`);
console.log(`  type      ${type} (${TYPES[type].en})`);
console.log(`  organs    ${organs.map((o) => `${o.name}: ${o.held_by.join(', ')}`).join('; ')}`);
console.log(`  members   ${members.join(', ')}`);
console.log(`  charter   ${charterPath}`);
console.log(`\nNo permission was required — art-04/§19/¶1.`);
console.log(`Edit the charter, then: npm test && npm run verify && git add -A && git commit -m "form ${id}" && git push`);
