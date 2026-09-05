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
import { citizens, entities, offices } from './lib/registers.js';
import { params } from './lib/params.js';
import { defaultCharter } from './lib/charter.js';
import yaml from 'js-yaml';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const all = (n) => args.reduce((acc, a, i) => (a === `--${n}` ? [...acc, args[i + 1]] : acc), []);

// art-04/§20 — the types and how each is formed, from parameters.yml.
const TYPES = params(ROOT).entities.types;

const name = arg('name');
const type = (arg('type') || 'association').toLowerCase();
const by = arg('by');
const purpose = arg('purpose', '');

if (!name || !by) {
  console.error('usage: node tools/entity.js --name "<name>" --type <type> --by <citizen> [--under <measure>]\n');
  console.error('types:');
  for (const [k, v] of Object.entries(TYPES))
    console.error(`  ${k.padEnd(12)} ${v.label.padEnd(22)} ${v.formation === 'citizen' ? 'formed by any citizen as of right (art-04/§19/¶1)' : 'formed only on a carried measure, entered by the Registrar'}`);
  console.error('\noptional: --purpose, --organ role=citizen (repeatable), --members c-0001,c-0002');
  process.exit(2);
}

if (!TYPES[type]) {
  console.error(`Unknown type "${type}". art-04/§20/¶2 — statute may create further types, but until it does:`);
  for (const k of Object.keys(TYPES)) console.error(`  ${k}`);
  process.exit(1);
}

// art-04/§20/¶2 — a type may be reserved. A commune or an organ of the Republic
// exists only because the Assembly said so, and only the Registrar enters it.
const rule = TYPES[type];
const under = arg('under');
if (rule.formation === 'law') {
  if (!under) {
    console.error(`A ${type} is formed only on a carried measure (parameters.yml, art-04/§20/¶3).`);
    console.error(`Pass --under <measure>, and have the Assembly carry it first.`);
    process.exit(1);
  }
  const pf = fs.existsSync(path.join(ROOT, 'proposals'))
    ? fs.readdirSync(path.join(ROOT, 'proposals')).find((f) => f.startsWith(under) && f.endsWith('.md')) : null;
  if (!pf) { console.error(`No measure "${under}".`); process.exit(1); }
  const res = path.join(ROOT, 'ballots', under, '_result.json');
  if (!fs.existsSync(res)) { console.error(`${under} has not been counted.`); process.exit(1); }
  const r = JSON.parse(fs.readFileSync(res, 'utf8'));
  if (!r.outcome?.carried) { console.error(`${under} did not carry, so it establishes nothing (art-08/§45/¶1).`); process.exit(1); }

  const registrar = offices(ROOT).find((o) => (o.permissions || []).includes('entity.register'));
  if (rule.established_by === 'registrar' && (!registrar || registrar.holder !== by)) {
    console.error(`Only the Registrar may enter a ${type} (art-04/§20/¶3). That is ${registrar ? registrar.holder : 'nobody'}.`);
    process.exit(1);
  }
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
  fs.writeFileSync(path.join(ROOT, charterPath), defaultCharter({
    id, type, name, organs, purpose, today,
  }));
}

// --- register entry --------------------------------------------------------

fs.mkdirSync(path.join(ROOT, 'register/entities'), { recursive: true });
fs.writeFileSync(path.join(ROOT, `register/entities/${id}.yml`), [
  `id: ${id}`,
  `type: ${type}`,
  `name: ${name}`,
  `formed: ${today}`,
  `formed_by: ${by}`,
  rule.formation === 'law' ? `formed_under: art-04/§20/¶3` : `formed_under: art-04/§19/¶1`,
  ...(under ? [`established_by_measure: ${under}`] : []),
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
  provision: rule.formation === 'law' ? 'art-04/§20/¶3' : 'art-04/§19/¶1',
  payload: { entity: id, type, name, organs: organs.map((o) => o.name), members, ...(under ? { measure: under } : {}) },
});

console.log(`Formed ${id} — ${name}`);
console.log(`  type      ${type} (${rule.label})`);
console.log(`  organs    ${organs.map((o) => `${o.name}: ${o.held_by.join(', ')}`).join('; ')}`);
console.log(`  members   ${members.join(', ')}`);
console.log(`  charter   ${charterPath}`);
console.log(rule.formation === 'law'
  ? `\nEstablished under ${under}, entered by the Registrar — art-04/§20/¶3.`
  : `\nNo permission was required — art-04/§19/¶1.`);
console.log(`Edit the charter, then: npm test && npm run verify && git add -A && git commit -m "form ${id}" && git push`);
