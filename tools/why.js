#!/usr/bin/env node
// Explains why a ballot is or is not being counted.
// Usage: node tools/why.js P-0002

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { canonical } from './lib/events.js';
import { verify } from './lib/sshsig.js';
import { citizens, activeCitizens, keysFor } from './lib/registers.js';
import { classSpec } from './lib/params.js';
import { isoDate } from './lib/corpus.js';

const ROOT = process.cwd();
const id = process.argv[2];
if (!id) { console.error('usage: node tools/why.js <measure>'); process.exit(2); }

const file = fs.readdirSync(path.join(ROOT, 'proposals')).find((f) => f.startsWith(id) && f.endsWith('.md'));
if (!file) { console.error(`No measure "${id}". Proposals present:`); for (const f of fs.readdirSync(path.join(ROOT,'proposals'))) console.error('  ' + f); process.exit(1); }

const src = fs.readFileSync(path.join(ROOT, 'proposals', file), 'utf8');
const front = yaml.load(src.slice(4, src.indexOf('\n---', 3))) || {};
const spec = classSpec(ROOT, front.class);

console.log(`${front.id} — class ${front.class}`);
console.log(`opened ${isoDate(front.opened)}  closes ${isoDate(front.closes) || '(from window)'}\n`);

const roll = citizens(ROOT);
console.log('Register:');
for (const c of roll) console.log(`  ${c.id}  ${c.status}${c.status === 'active' ? '' : '  (not counted)'}`);
console.log(`  ${activeCitizens(ROOT).length} active — quorum needs ${Math.ceil(spec.quorum * activeCitizens(ROOT).length)}\n`);

const dir = path.join(ROOT, 'ballots', front.id);
if (!fs.existsSync(dir)) { console.log('No ballots directory. Nothing has been committed for this measure.'); process.exit(0); }

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
if (!files.length) { console.log('The ballots directory is empty.'); process.exit(0); }

console.log('Ballots:');
for (const f of files) {
  const who = path.basename(f, '.json');
  const b = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const problems = [];

  const c = roll.find((x) => x.id === who);
  if (!c) problems.push(`"${who}" is not on the register — the file must be named <citizen-id>.json`);
  else if (c.status !== 'active') problems.push(`${who} is ${c.status}, not active`);
  if (b.proposal !== front.id) problems.push(`the ballot is for ${b.proposal}`);
  if (!b.at) problems.push('no timestamp — signed by an old version of the tools');

  if (c && c.status === 'active') {
    const msg = canonical({ proposal: b.proposal, choice: b.choice, at: b.at, salt: b.salt });
    const r = verify(msg, b.signature || '', keysFor(ROOT, who), { namespace: 'republic' });
    if (!r.ok) problems.push(`signature: ${r.error}`);
  }

  console.log(`  ${f}  choice=${JSON.stringify(b.choice)}  ${problems.length ? '✗' : '✓ counted'}`);
  for (const p of problems) console.log(`      ${p}`);
}
