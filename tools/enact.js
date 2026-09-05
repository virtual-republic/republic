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
const STATUTES = fs.existsSync(path.join(ROOT, 'journal/statutes')) ? path.join(ROOT, 'journal/statutes') : path.join(ROOT, 'statutes');
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

const journalDir = fs.existsSync(path.join(ROOT, 'journal/issues')) ? path.join(ROOT, 'journal/issues') : path.join(ROOT, 'journal');
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

// art-06/§29/¶1 — an office is filled by election, and the term runs from the
// declaration of the result. An election that carries installs its winner; that
// is the whole point of holding one.
if (front.class === 'election' && result.outcome.winner) {
  const officeId = front.office || result.outcome.office;
  const file = path.join(ROOT, 'register/offices.yml');
  const doc = yaml.load(fs.readFileSync(file, 'utf8'));
  const o = (doc.offices || []).find((x) => x.id === officeId);
  if (!o) {
    console.error(`${id} elected ${result.outcome.winner} to "${officeId}", which is not on the register.`);
    process.exit(1);
  }
  const previous = o.holder;
  const ends = new Date(); ends.setFullYear(ends.getFullYear() + 1);
  let src = fs.readFileSync(file, 'utf8');
  src = src.replace(new RegExp(`(- id: ${officeId}\\n(?:.*\\n)*?\\s*holder: )\\S+`), `$1${result.outcome.winner}`);
  src = src.replace(new RegExp(`(- id: ${officeId}\\n(?:.*\\n)*?\\s*since: )\\S+`), `$1${today}`);
  src = src.replace(new RegExp(`(- id: ${officeId}\\n(?:.*\\n)*?\\s*term_ends: )\\S+`), `$1${ends.toISOString().slice(0, 10)}`);
  fs.writeFileSync(file, src);

  append(ROOT, {
    at: new Date().toISOString(),
    author: result.outcome.winner,
    kind: 'office.taken',
    provision: 'art-06/§29/¶1',
    payload: { office: officeId, holder: result.outcome.winner, from: previous, measure: id, term_ends: ends.toISOString().slice(0, 10) },
  });
  console.log(`  ${result.outcome.winner} takes ${officeId} until ${ends.toISOString().slice(0, 10)} (art-06/§29/¶1)`);
}

// art-01/§4/¶3 — statute is where rates, procedures and detail belong.
const STANDING = ['ordinary', 'organic', 'policy'];
let statuteSlug = null;

if (STANDING.includes(front.class)) {
  // art-11/§62 — an amendment produces a version; the text as amended is the
  // text in force, and the earlier version stays published in the Journal.
  const amends = front.amends_statute || null;
  const slug = amends || (front.title || id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  statuteSlug = slug;
  fs.mkdirSync(STATUTES, { recursive: true });
  const statute = path.join(STATUTES, `${slug}.md`);
  const existed = fs.existsSync(statute);

  if (existed && !amends) {
    console.log(`  statutes/${slug}.md already exists; nothing rewritten`);
  } else {
    let version = 1, history = [];
    if (existed) {
      const prior = fs.readFileSync(statute, 'utf8');
      const pend = prior.indexOf('\n---', 3);
      const pmeta = yaml.load(prior.slice(4, pend)) || {};
      version = (pmeta.version || 1) + 1;
      history = [].concat(pmeta.history || []).concat([`${pmeta.version || 1}: ${pmeta.measure || '?'} (Journal ${pmeta.journal || '?'})`]);
      // The superseded text survives in the Journal issue that enacted it.
      fs.mkdirSync(path.join(STATUTES, 'superseded'), { recursive: true });
      fs.writeFileSync(path.join(STATUTES, 'superseded', `${slug}.v${pmeta.version || 1}.md`), prior);
    }
    fs.writeFileSync(statute, `---
id: ${slug}
title: ${front.title || id}
class: ${front.class}
version: ${version}
enacted: ${today}
measure: ${id}
journal: ${number}
${history.length ? 'history:\n' + history.map((h) => '  - ' + h).join('\n') + '\n' : ''}cites: [${cites.join(', ')}]
---

${body}
`);
    append(ROOT, {
      at: new Date().toISOString(),
      author: keeper ? keeper.holder : front.sponsor,
      kind: existed ? 'statute.amended' : 'statute.enacted',
      provision: existed ? 'art-11/§62/¶1' : 'art-01/§4/¶3',
      payload: { statute: slug, measure: id, journal: number, version },
    });
    console.log(existed
      ? `  statutes/${slug}.md amended to version ${version}; version ${version - 1} preserved`
      : `  statute written to statutes/${slug}.md — citable as stat.${slug}/§1/¶1`);
  }
}

const issue = `---
number: ${number}
date: ${today}
measure: ${id}
title: ${front.title || id}
cites: [art-08/§45/¶1${cites.length ? ', ' + cites.join(', ') : ''}]
---

${front.class === 'election'
  ? `${result.outcome.winner} was elected ${front.office || 'to office'} by the Assembly, and takes the office on publication of this issue under Article 6 § 29 ¹.`
  : `${front.title || id} was carried by the Assembly and is enacted by publication in this issue, under Article 8 § 45 ¹.`}

The measure was of class ${front.class}. Of ${result.outcome.cast} ballots cast
against an electorate of ${result.outcome.electorate}, ${result.outcome.yes} were
in favour and ${result.outcome.no} against, ${(result.outcome.share * 100).toFixed(1)}%
of decisive votes against a threshold of ${(result.outcome.threshold * 100).toFixed(2)}%.

${statuteSlug
  ? `The text in force is stat.${statuteSlug}, as amended by every measure since.`
  : `The text as enacted:\n\n${body}`}
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
