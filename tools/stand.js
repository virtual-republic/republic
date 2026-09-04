#!/usr/bin/env node
// Opens an election, or adds a candidate to one already open.
//
//   art-07/§34/¶1  every citizen has the right to stand for office
//   art-06/§29/¶1  an office is held for one year and filled by election
//   art-08/§46/¶1  offices are filled by the single transferable vote in its
//                  instant-runoff form
//
// Usage:
//   node tools/stand.js --office registrar --by c-0001
//   node tools/stand.js --office keeper --by c-0002 --measure P-0007   (join an open one)

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { activeCitizens, offices } from './lib/registers.js';
import { classSpec } from './lib/params.js';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };

const office = arg('office');
const by = arg('by');
const joining = arg('measure');

if (!office || !by) {
  console.error('usage: node tools/stand.js --office <office> --by <citizen> [--measure P-0007]\n');
  console.error('offices:');
  for (const o of offices(ROOT)) console.error(`  ${o.id.padEnd(12)} ${o.title}  (held by ${o.holder} until ${o.term_ends || '?'})`);
  process.exit(2);
}

// art-07/§34/¶1 — the right belongs to citizens.
const roll = activeCitizens(ROOT);
if (!roll.some((c) => c.id === by)) {
  console.error(`${by} is not an active citizenship. Only a citizen may stand (art-07/§34/¶1).`);
  process.exit(1);
}

const known = offices(ROOT);
const target = known.find((o) => o.id === office);
if (!target) {
  console.error(`No office "${office}". art-06/§28/¶2 — statute may create further offices, but the register holds:`);
  for (const o of known) console.error(`  ${o.id}`);
  process.exit(1);
}

const spec = classSpec(ROOT, 'election');
const dir = path.join(ROOT, 'proposals');

// --- joining an election already open --------------------------------------

if (joining) {
  const f = fs.readdirSync(dir).find((x) => x.startsWith(joining) && x.endsWith('.md'));
  if (!f) { console.error(`No measure "${joining}"`); process.exit(1); }
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const end = src.indexOf('\n---', 3);
  const front = yaml.load(src.slice(4, end)) || {};
  if (front.class !== 'election') { console.error(`${joining} is not an election.`); process.exit(1); }
  const cands = [].concat(front.candidates || []);
  if (cands.includes(by)) { console.log(`${by} already stands in ${joining}.`); process.exit(0); }
  cands.push(by);
  const updated = src.slice(0, end + 1).replace(/^candidates:.*$/m, `candidates: [${cands.join(', ')}]`) + src.slice(end + 1);
  fs.writeFileSync(path.join(dir, f), updated);
  console.log(`${by} now stands in ${joining} for ${office}.`);
  console.log(`Candidates: ${cands.join(', ')}`);
  process.exit(0);
}

// --- opening a new election ------------------------------------------------

const nums = fs.readdirSync(dir).map((f) => (f.match(/^P-(\d{4})/) || [])[1]).filter(Boolean).map(Number);
const id = 'P-' + String(Math.max(0, ...nums) + 1).padStart(4, '0');

const opened = new Date();
const closes = new Date(opened.getTime() + spec.window_days * 86400000);
const d = (x) => x.toISOString().slice(0, 10);

const file = path.join(dir, `${id}-election-${office}.md`);
fs.writeFileSync(file, `---
id: ${id}
title: Election — ${target.title}
title_fr: Élection — ${target.title_fr || target.title}
sponsor: ${by}
class: election
office: ${office}
candidates: [${by}]
cites:
  - art-06/§29/¶1
  - art-07/§34/¶1
  - art-08/§46/¶1
opened: ${d(opened)}
closes: ${d(closes)}
---

## § 1  The office

¹ The office of ${target.title} is filled under Article 6 § 29 ¹.

² The office is held for one year from the declaration of the result.

## § 2  Method

¹ The vote is taken by the single transferable vote in its instant-runoff form — Article 8 § 46 ¹.

² Voters rank the candidates in order of preference. The rounds of elimination are published — Article 8 § 46 ².

## § 3  Candidates

¹ Every citizen may stand — Article 7 § 34 ¹.

² A citizen stands by being named in the candidates of this measure, and may be added at any time before the close.
`);

console.log(`Opened ${id} — election for ${target.title}`);
console.log(`  candidate  ${by}`);
console.log(`  opens      ${d(opened)}`);
console.log(`  closes     ${d(closes)}`);
console.log(`  currently  ${target.holder} holds this office`);
console.log(`\nOthers stand with:  node tools/stand.js --office ${office} --by <citizen> --measure ${id}`);
console.log(`Vote with:          node tools/sign.js ${id} <first,second,third> <citizen>`);
console.log(`Then:               npm run build && git add -A && git commit -m "election ${id}" && git push`);
