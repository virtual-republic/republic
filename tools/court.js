#!/usr/bin/env node
// The Court.
//
//   art-06/§31/¶2  the Court decides disputes arising under this Constitution,
//                  reviews acts for consistency with it, and construes the text
//   art-06/§31/¶3  the Court may halt an act within its enactment window, and
//                  may declare an act of no effect
//   art-06/§31/¶4  the Court may not transfer value, and holds no permission
//                  over the Treasury
//   art-06/§31/¶5  every judgment is published, cites the provisions construed,
//                  and states reasons
//   art-07/§36/¶2  a citizen may appear before the Court and may appeal
//
//   node tools/court.js file --against P-0004 --by c-0006 --ground "cites no provision" --seeking halt
//   node tools/court.js judge --case 1 --by c-0006 --holding halt --reasons "..." --construes art-08/§41/¶3
//   node tools/court.js list

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { append } from './lib/events.js';
import { activeCitizens, offices } from './lib/registers.js';
import { buildCorpus, normalise } from './lib/corpus.js';

const ROOT = process.cwd();
const cmd = process.argv[2];
const a = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const DIR = fs.existsSync(path.join(ROOT, 'journal/judgments')) ? path.join(ROOT, 'journal/judgments') : path.join(ROOT, 'judgments');

const SEEKING = {
  halt: 'that the act be halted within its enactment window (art-06/§31/¶3)',
  void: 'that the act be declared of no effect (art-06/§31/¶3)',
  construe: 'that a provision be construed (art-06/§31/¶2)',
  remedy: 'a remedy for an infringement of Article 7 (art-07/§25/¶2)',
};

function cases() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    const end = src.indexOf('\n---', 3);
    return { ...(yaml.load(src.slice(4, end)) || {}), file: path.relative(ROOT, path.join(DIR, f)), body: src.slice(end + 4).trim() };
  });
}

// art-06/§31/¶1 — where no Judge is elected, the Assembly exercises the Court's
// functions, so a Republic without a Court still has a forum.
function bench() {
  return offices(ROOT).filter((o) => (o.permissions || []).includes('court.judge'));
}

if (cmd === 'list') {
  const all = cases();
  if (!all.length) { console.log('No cases.'); process.exit(0); }
  for (const c of all) {
    console.log(`${String(c.number).padStart(3)}  ${c.title}`);
    console.log(`     against ${c.against} · ${c.seeking} · ${c.holding ? 'decided: ' + c.holding : 'undecided'}`);
  }
  const b = bench();
  console.log(`\nBench: ${b.length ? b.map((o) => o.holder).join(', ') : 'none elected — the Assembly sits as the Court (art-06/§31/¶1)'}`);
  process.exit(0);
}

if (cmd === 'file') {
  const by = a('by'), against = a('against'), ground = a('ground'), seeking = a('seeking', 'construe');
  if (!by || !against || !ground) {
    console.error('usage: node tools/court.js file --against <act> --by <citizen> --ground "..." [--seeking halt|void|construe|remedy]');
    console.error('\nseeking:'); for (const [k, v] of Object.entries(SEEKING)) console.error(`  ${k.padEnd(9)} ${v}`);
    process.exit(2);
  }
  if (!SEEKING[seeking]) { console.error(`unknown --seeking "${seeking}"`); process.exit(1); }
  // art-07/§36/¶2 — a citizen may appear before the Court.
  if (!activeCitizens(ROOT).some((c) => c.id === by)) { console.error(`${by} is not an active citizenship.`); process.exit(1); }

  const construes = (a('construes') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const entries = buildCorpus(ROOT).entries;
  for (const c of construes) if (!entries.has(normalise(c))) { console.error(`"${c}" does not resolve (art-02/§11/¶2).`); process.exit(1); }

  const number = cases().reduce((n, c) => Math.max(n, c.number || 0), 0) + 1;
  const today = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(DIR, { recursive: true });
  const slug = `${String(number).padStart(4, '0')}-${String(against).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  fs.writeFileSync(path.join(DIR, `${slug}.md`), `---
number: ${number}
title: ${a('title', `${by} v ${against}`)}
against: ${against}
applicant: ${by}
seeking: ${seeking}
filed: ${today}
construes: [${construes.join(', ')}]
cites: [art-06/§31/¶2, art-07/§36/¶2]
---

## § 1  The application

¹ ${by} applies ${SEEKING[seeking]}.

² The act complained of is ${against}.

## § 2  Ground

¹ ${ground}

## § 3  Answer

¹ *To be completed by the respondent, or left blank.*
`);

  append(ROOT, { at: new Date().toISOString(), author: by, kind: 'case.filed', provision: 'art-07/§36/¶2',
    payload: { case: number, against, seeking, applicant: by } });

  console.log(`Filed case ${number} — ${judgmentsNote()}`);
  console.log(`  judgments/${slug}.md`);
  if (seeking === 'halt') console.log(`  art-06/§31/¶3 — a halt is only available within the enactment window.`);
  process.exit(0);
}

if (cmd === 'judge') {
  const by = a('by'), n = Number(a('case')), holding = a('holding'), reasons = a('reasons');
  if (!by || !n || !holding || !reasons) {
    console.error('usage: node tools/court.js judge --case <n> --by <judge> --holding halt|void|dismissed|construed --reasons "..." [--construes a,b]');
    process.exit(2);
  }
  // art-06/§31/¶4 — the Court holds no permission over the Treasury, and nothing
  // here can move value. The permission set is the guarantee.
  const b = bench();
  const seated = b.some((o) => o.holder === by);
  const assemblySits = b.length === 0 && activeCitizens(ROOT).some((c) => c.id === by);
  if (!seated && !assemblySits) {
    console.error(`${by} does not sit. The bench is ${b.map((o) => o.holder).join(', ') || 'empty'} (art-06/§31/¶1).`);
    process.exit(1);
  }

  const c = cases().find((x) => x.number === n);
  if (!c) { console.error(`No case ${n}.`); process.exit(1); }
  if (c.holding) { console.error(`Case ${n} was decided: ${c.holding}.`); process.exit(1); }

  const construes = (a('construes') || [].concat(c.construes || []).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);
  const src = fs.readFileSync(path.join(ROOT, c.file), 'utf8');
  const end = src.indexOf('\n---', 3);
  const meta = yaml.load(src.slice(4, end)) || {};
  meta.holding = holding;
  meta.decided = today;
  meta.bench = seated ? by : `${by} (Assembly sitting as the Court, art-06/§31/¶1)`;
  meta.construes = construes;

  fs.writeFileSync(path.join(ROOT, c.file), `---\n${yaml.dump(meta).trim()}\n---\n${src.slice(end + 4)}
## § 4  Judgment

¹ The Court holds: **${holding}**.

² Reasons: ${reasons}

³ Provisions construed: ${construes.length ? construes.join(', ') : 'none'}.

⁴ This judgment is published under Article 6 § 31 ⁵.
`);

  append(ROOT, { at: new Date().toISOString(), author: by, kind: 'judgment.given', provision: 'art-06/§31/¶5',
    payload: { case: n, against: c.against, holding, construes, bench: by } });

  if (holding === 'halt' || holding === 'void') {
    append(ROOT, { at: new Date().toISOString(), author: by,
      kind: holding === 'halt' ? 'act.halted' : 'act.voided', provision: 'art-06/§31/¶3',
      payload: { case: n, act: c.against } });
  }

  console.log(`Case ${n} decided: ${holding}.`);
  console.log(`  ${c.file}`);
  if (holding === 'void') console.log(`  ${c.against} is of no effect — art-06/§31/¶3.`);
  process.exit(0);
}

function judgmentsNote() { return 'the Court decides disputes arising under this Constitution (art-06/§31/¶2)'; }

console.error('usage: node tools/court.js <file|judge|list> ...');
process.exit(2);
