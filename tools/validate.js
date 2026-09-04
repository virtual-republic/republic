#!/usr/bin/env node
// Validates a proposal against the Constitution.
//
// This is the first step of the workflow described in art-08/§41. It is the
// executable form of:
//
//   art-08/§41/¶2  a proposal must state its class, its text, and the
//                  provision under which it is made
//   art-08/§41/¶3  a proposal that does not cite a resolvable provision is
//                  not received
//   art-08/§41/¶4  a proposal must concern one subject only
//
// Usage: node tools/validate.js proposals/0007-something.md

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { loadConstitution, provisionIndex, normaliseCitation, entrenched } from './lib/constitution.js';
import { classes as classRegistry, classSpec } from './lib/params.js';
import { activeCitizens } from './lib/registers.js';

const ROOT = process.cwd();
const file = process.argv[2];

if (!file) {
  console.error('usage: node tools/validate.js <proposal.md>');
  process.exit(2);
}

const src = fs.readFileSync(file, 'utf8');
const end = src.indexOf('\n---', 3);
if (!src.startsWith('---') || end === -1) {
  fail(['proposal has no front matter']);
}
const meta = yaml.load(src.slice(4, end)) || {};
const body = src.slice(end + 4).trim();

const constitution = loadConstitution(ROOT);
const index = provisionIndex(constitution);
const classes = classRegistry(ROOT);

const errors = [];
const warnings = [];

// --- required fields -------------------------------------------------------

for (const field of ['id', 'title', 'sponsor', 'class', 'cites']) {
  if (meta[field] === undefined) errors.push(`missing front-matter field "${field}" (art-08/§41/¶2)`);
}

if (meta.class && !classes[meta.class]) {
  errors.push(`unknown class "${meta.class}" — expected one of: ${Object.keys(classes).join(', ')}`);
}

if (!body || body.length < 40) {
  errors.push('proposal has no text (art-08/§41/¶2)');
}

// --- sponsor is a citizen --------------------------------------------------

const roll = activeCitizens(ROOT);
if (meta.sponsor && !roll.some((c) => c.id === meta.sponsor)) {
  errors.push(`sponsor "${meta.sponsor}" is not an active citizen (art-07/§34/¶1)`);
}

// --- citations resolve -----------------------------------------------------

const cites = Array.isArray(meta.cites) ? meta.cites : meta.cites ? [meta.cites] : [];
if (cites.length === 0) {
  errors.push('proposal cites no provision and is not received (art-08/§41/¶3)');
}

const resolved = [];
for (const raw of cites) {
  const id = normaliseCitation(raw);
  if (!index.has(id)) {
    errors.push(`citation "${raw}" does not resolve and the proposal is not received (art-08/§41/¶3)`);
  } else {
    resolved.push(id);
  }
}

// --- unity of subject ------------------------------------------------------
// A rough but honest test: a proposal that reaches into three or more separate
// Articles is doing more than one thing. Flagged, not fatal — the Assembly is
// the judge of its own agenda, but it should be told.

const touchedArticles = new Set(resolved.map((id) => id.split('/')[0]));
if (touchedArticles.size > 2) {
  warnings.push(
    `proposal cites ${touchedArticles.size} Articles (${[...touchedArticles].join(', ')}); ` +
      `consider whether it concerns one subject only (art-08/§41/¶4)`
  );
}

// --- class must match what is being amended --------------------------------

const amends = meta.amends ? (Array.isArray(meta.amends) ? meta.amends : [meta.amends]) : [];
for (const target of amends) {
  const id = normaliseCitation(target);
  if (!index.has(id)) {
    errors.push(`amends "${target}", which does not resolve`);
    continue;
  }
  const article = id.split('/')[0];
  if (entrenched(constitution, article) && meta.class !== 'entrenched') {
    errors.push(
      `amends ${article}, which is entrenched, so the class must be "entrenched", not "${meta.class}" (art-11/§61/¶2)`
    );
  }
  if (!entrenched(constitution, article) && meta.class === 'ordinary') {
    errors.push(`amends the Constitution, so the class must be "amendment", not "ordinary" (art-11/§60/¶1)`);
  }
}

// art-11/§61/¶3 — the exit and division guarantees cannot be narrowed.
const PROTECTED = ['art-07/§39', 'art-10/§54'];
for (const target of amends.map(normaliseCitation)) {
  if (PROTECTED.some((p) => target.startsWith(p))) {
    errors.push(`${target} may not be amended so as to impede exit or division (art-11/§61/¶3)`);
  }
}

// --- report ----------------------------------------------------------------

if (warnings.length) {
  console.log('Warnings:');
  for (const w of warnings) console.log('  ! ' + w);
  console.log('');
}

if (errors.length) fail(errors);

const spec = classes[meta.class];
console.log(`Received: ${meta.id} — ${meta.title}`);
console.log(`  class     ${meta.class} (${spec.label})`);
console.log(`  sponsor   ${meta.sponsor}`);
console.log(`  cites     ${resolved.join(', ')}`);
console.log(`  quorum    ${(spec.quorum * 100).toFixed(0)}% of ${roll.length} citizens = ${Math.ceil(spec.quorum * roll.length)} ballots`);
if (spec.threshold) console.log(`  threshold ${(spec.threshold * 100).toFixed(2)}% of ballots cast`);
console.log(`  window    ${spec.window_days} days`);
if (spec.successive) console.log(`  note      must be carried twice, thirty days apart (art-11/§60/¶3)`);
process.exit(0);

function fail(list) {
  console.error('Not received (art-02/§11/¶2):');
  for (const e of list) console.error('  ✗ ' + e);
  process.exit(1);
}
