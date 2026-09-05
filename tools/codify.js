#!/usr/bin/env node
// Brings existing law into the code.
//
// A measure enacted before the Law section existed is promulgated in the
// Journal but has no statute file, so it does not appear as law in force. This
// reads the Journal, finds every issue that enacted a standing measure, and
// writes the statute from the measure's own text.
//
// Idempotent: a statute that already exists is left alone.
//
//   node tools/codify.js [--dry-run]

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { append } from './lib/events.js';
import { offices } from './lib/registers.js';

const ROOT = process.cwd();
const STATUTES = fs.existsSync(path.join(ROOT, 'journal/statutes')) ? path.join(ROOT, 'journal/statutes') : path.join(ROOT, 'statutes');
const dry = process.argv.includes('--dry-run');
const STANDING = ['ordinary', 'organic', 'policy'];

const issues = [];
const jdir = fs.existsSync(path.join(ROOT, 'journal/issues')) ? path.join(ROOT, 'journal/issues') : path.join(ROOT, 'journal');
const walk = (d) => { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d).sort()) {
  const p = path.join(d, f);
  if (fs.statSync(p).isDirectory()) walk(p);
  else if (f.endsWith('.md')) {
    const src = fs.readFileSync(p, 'utf8');
    const end = src.indexOf('\n---', 3);
    issues.push({ ...(yaml.load(src.slice(4, end)) || {}), file: p });
  }
} };
walk(jdir);

const keeper = offices(ROOT).find((o) => (o.permissions || []).includes('journal.publish'));
let made = 0, skipped = 0;

for (const j of issues) {
  if (!j.measure) { skipped++; continue; }
  const pf = fs.existsSync(path.join(ROOT, 'proposals'))
    ? fs.readdirSync(path.join(ROOT, 'proposals')).find((f) => f.startsWith(j.measure) && f.endsWith('.md')) : null;
  if (!pf) { console.log(`  · Journal ${j.number}: ${j.measure} — the measure is no longer in proposals/, skipped`); skipped++; continue; }

  const src = fs.readFileSync(path.join(ROOT, 'proposals', pf), 'utf8');
  const end = src.indexOf('\n---', 3);
  const front = yaml.load(src.slice(4, end)) || {};
  const body = src.slice(end + 4).trim();
  if (!STANDING.includes(front.class)) { skipped++; continue; }

  const slug = (front.title || front.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const out = path.join(STATUTES, `${slug}.md`);
  if (fs.existsSync(out)) { skipped++; continue; }

  console.log(`  + stat.${slug}  \u2190 ${j.measure}, Journal ${j.number}`);
  made++;
  if (dry) continue;

  fs.mkdirSync(STATUTES, { recursive: true });
  fs.writeFileSync(out, `---
id: ${slug}
title: ${front.title || front.id}
class: ${front.class}
version: 1
enacted: ${String(j.date).slice(0, 10)}
measure: ${j.measure}
journal: ${j.number}
cites: [${[].concat(front.cites || []).join(', ')}]
---

${body}
`);
  append(ROOT, {
    at: new Date().toISOString(),
    author: keeper ? keeper.holder : front.sponsor,
    kind: 'statute.codified',
    provision: 'art-01/§4/¶3',
    payload: { statute: slug, measure: j.measure, journal: j.number },
  });
}

console.log(`\n${made} statute(s) written, ${skipped} issue(s) skipped${dry ? ' (dry run)' : ''}.`);
