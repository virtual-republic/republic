#!/usr/bin/env node
// Enacts a carried measure.
//
//   art-08/§45/¶1  a measure that carries is enacted by publication in the Journal
//   art-05/§25/¶2  publication is promulgation; an act not published has no effect
//
// Writes the Journal issue, appends the enactment record, and stops if the
// measure did not carry. Runs from the tally workflow, so promulgation is not
// left to anyone's memory.
//
// Usage: node tools/enact.js <measure>

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { append } from './lib/events.js';
import { params } from './lib/params.js';
import { isoDate } from './lib/corpus.js';
import { offices } from './lib/registers.js';

const ROOT = process.cwd();
const id = process.argv[2];
if (!id) { console.error('usage: node tools/enact.js <measure>'); process.exit(2); }

if (!params(ROOT).journal.auto_publish_on_enactment) {
  console.log('parameters.yml disables automatic publication.');
  process.exit(0);
}

const resultFile = path.join(ROOT, 'ballots', id, '_result.json');
if (!fs.existsSync(resultFile)) { console.error(`No tally for ${id}. Run tools/tally.js first.`); process.exit(1); }
const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));

if (result.open) { console.log(`${id} is still open. Nothing to enact.`); process.exit(0); }
if (!result.outcome?.carried) { console.log(`${id} did not carry. Nothing to enact (art-08/§45/¶1).`); process.exit(0); }

const file = fs.readdirSync(path.join(ROOT, 'proposals')).find((f) => f.startsWith(id) && f.endsWith('.md'));
const src = fs.readFileSync(path.join(ROOT, 'proposals', file), 'utf8');
const front = yaml.load(src.slice(4, src.indexOf('\n---', 3))) || {};
const body = src.slice(src.indexOf('\n---', 3) + 4).trim();

// --- next issue number -----------------------------------------------------

const journalDir = path.join(ROOT, 'journal');
let highest = 0;
const walk = (d) => { for (const f of fs.readdirSync(d)) {
  const p = path.join(d, f);
  if (fs.statSync(p).isDirectory()) walk(p);
  else if (f.endsWith('.md')) {
    const m = fs.readFileSync(p, 'utf8').match(/^number:\s*(\d+)/m);
    if (m) highest = Math.max(highest, Number(m[1]));
    if (fs.readFileSync(p, 'utf8').includes(`measure: ${id}`)) { console.log(`${id} is already published in the Journal.`); process.exit(0); }
  }
} };
if (fs.existsSync(journalDir)) walk(journalDir);

const number = highest + 1;
const today = new Date().toISOString().slice(0, 10);
const year = today.slice(0, 4);
const keeper = offices(ROOT).find((o) => (o.permissions || []).includes('journal.publish'));

const cites = [].concat(front.cites || []).map(String);

const issue = `---
number: ${number}
date: ${today}
measure: ${id}
title: ${front.title || id}
cites: [art-08/§45/¶1${cites.length ? ', ' + cites.join(', ') : ''}]
---

${front.title || id} was carried by the Assembly and is enacted
by publication in this issue, under Article 8 § 45 ¹.

The measure was of class ${front.class}. Of ${result.outcome.cast} ballots cast
against an electorate of ${result.outcome.electorate}, ${result.outcome.yes} were
in favour and ${result.outcome.no} against, ${(result.outcome.share * 100).toFixed(1)}%
of decisive votes against a threshold of ${(result.outcome.threshold * 100).toFixed(2)}%.

The text as enacted:

${body.replace(/^#+\s*/gm, '')}
`;

fs.mkdirSync(path.join(journalDir, year), { recursive: true });
const out = path.join(journalDir, year, `${String(number).padStart(4, '0')}-${id.toLowerCase()}.md`);
fs.writeFileSync(out, issue);

append(ROOT, {
  at: new Date().toISOString(),
  author: keeper ? keeper.holder : front.sponsor,
  kind: 'measure.enacted',
  provision: 'art-08/§45/¶1',
  payload: { measure: id, class: front.class, journal: number, yes: result.outcome.yes, no: result.outcome.no },
});

console.log(`Enacted ${id}.`);
console.log(`  Journal issue ${number} written to ${path.relative(ROOT, out)}`);
console.log(`  enactment recorded under art-08/§45/¶1`);
