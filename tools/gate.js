#!/usr/bin/env node
// The vote gate.
//
// Decides, from the paths a pull request touches, whether the change requires
// a measure of the Assembly — and if so, whether that measure carried. Run as
// a required status check, this makes art-08/§45/¶1 mechanical: a measure that
// carries is enacted by publication, and nothing else is enacted at all.
//
// Usage:
//   node tools/gate.js --base origin/main [--measure P-0002]
//
// The measure id is taken from --measure, from the branch name
// (measure/P-0002), or from the environment (PR_TITLE, PR_BODY).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { classSpec, classes } from './lib/params.js';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };

// Which paths are governed by which class of measure. First match wins.
// Anything not listed is exempt: the Republic should not need a referendum to
// fix a typo in its stylesheet.
const RULES = [
  // Records, not decisions. These ARE the outputs of procedure, so requiring a
  // vote to write them would deadlock the Republic.
  { pattern: /^ballots\//,                 class: null, why: 'ballots are how voting happens' },
  { pattern: /^proposals\//,               class: null, why: 'proposing is not enacting (art-08/§41)' },
  { pattern: /^ledger\//,                  class: null, why: 'records (art-05/§24)' },
  { pattern: /^checkpoints\//,             class: null, why: 'checkpoints (art-02/§10/¶2)' },
  { pattern: /^journal\//,                 class: null, why: 'publication (art-05/§25)' },
  { pattern: /^register\/citizens\//,      class: null, why: 'admission takes effect on recording (art-03/§16/¶3)' },
  { pattern: /^register\/entities\//,      class: null, why: 'entities are formed as of right (art-04/§19/¶1)' },
  { pattern: /^(site|dist)\//,             class: null, why: 'presentation, not law' },
  { pattern: /^(README|SETUP)/,            class: null, why: 'documentation' },

  // Tunable values. A parameter change is a real change with no code change,
  // which is exactly why it is governed and exactly why it is cheap.
  { pattern: /^parameters\.yml$/,          class: 'organic', why: 'a tunable value; the tools read it (art-01/§4/¶3)' },

  // Prose policy that no tool executes.
  { pattern: /^statutes\//,                class: 'policy', why: 'statute (art-01/§4/¶3)' },

  // Entrenched Articles.
  { pattern: /^constitution\/(en|fr)\/(02|07|11)-/, class: 'entrenched', why: 'entrenched Article (art-11/§61)' },

  // The rest of the Constitution.
  { pattern: /^constitution\//,            class: 'amendment', why: 'amends the Constitution (art-11/§60)' },

  // The tools are the law in executable form; changing them changes what the
  // Constitution does. Same tier as organic statute.
  { pattern: /^tools\//,                   class: 'organic', why: 'the published tools (art-05/§26/¶1)' },
  { pattern: /^\.github\/workflows\//,     class: 'organic', why: 'procedure executing (art-08/§41)' },
  { pattern: /^\.github\/ruleset/,         class: 'organic', why: 'merge discipline' },

  // Offices and their permissions.
  { pattern: /^register\/offices\.yml$/,   class: 'ordinary', why: 'offices and permissions (art-06/§28/¶3)' },
  { pattern: /^register\/keepers\.txt$/,   class: 'ordinary', why: 'the Keeper’s signing key' },
];

const ORDER = ['policy', 'ordinary', 'organic', 'amendment', 'entrenched'];

// --- what changed ----------------------------------------------------------

const base = arg('base', process.env.BASE_REF ? `origin/${process.env.BASE_REF}` : 'origin/main');
let changed;
try {
  changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
} catch {
  changed = execFileSync('git', ['diff', '--name-only', 'HEAD~1'], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
}

if (!changed.length) {
  console.log('Nothing changed.');
  process.exit(0);
}

// --- what class does it need ----------------------------------------------

const governed = [];
let required = null;

for (const file of changed) {
  const rule = RULES.find((r) => r.pattern.test(file));
  if (!rule || !rule.class) continue;
  governed.push({ file, ...rule });
  if (!required || ORDER.indexOf(rule.class) > ORDER.indexOf(required)) required = rule.class;
}

console.log(`Changed: ${changed.length} file(s)\n`);

if (!required) {
  console.log('No governed path touched. No measure required.');
  for (const f of changed) console.log(`  · ${f}`);
  process.exit(0);
}

const spec = classSpec(ROOT, required);

console.log(`This change requires a measure of class "${required}" (${spec.label_en}):\n`);
for (const g of governed) console.log(`  ${g.file}\n      ${g.why}`);
console.log('');

// --- which measure -------------------------------------------------------

const haystack = [
  arg('measure'),
  process.env.PR_TITLE,
  process.env.PR_BODY,
  process.env.GITHUB_HEAD_REF,
  (() => { try { return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }); } catch { return ''; } })(),
].filter(Boolean).join(' ');

const found = haystack.match(/\bP-\d{4}\b/);

if (!found) {
  fail([
    'No measure is cited.',
    '',
    'Name the measure in the pull request title or body, or branch as measure/P-0002.',
    'art-02/§11/¶1 — every act of the Republic must cite the provision under which it is made,',
    'and a change of this class is an act.',
  ]);
}

const measure = found[0];
console.log(`Measure cited: ${measure}`);

// --- did it carry ---------------------------------------------------------

const proposalFile = fs.existsSync(path.join(ROOT, 'proposals'))
  ? fs.readdirSync(path.join(ROOT, 'proposals')).find((f) => f.startsWith(measure))
  : null;

if (!proposalFile) fail([`${measure} is not among the proposals. It must be received before it can be carried.`]);

const proposalClass = (fs.readFileSync(path.join(ROOT, 'proposals', proposalFile), 'utf8')
  .match(/^class:\s*(\S+)/m) || [])[1];

if (proposalClass !== required) {
  fail([
    `${measure} is of class "${proposalClass}", but this change requires "${required}".`,
    `A measure cannot enact more than the class it was voted under.`,
  ]);
}

let carried = false;
let output = '';
try {
  output = execFileSync('node', ['tools/tally.js', measure], { encoding: 'utf8' });
  carried = /\bCARRIED\b/.test(output) && !/NOT CARRIED/.test(output);
} catch (e) {
  output = (e.stdout || '') + (e.stderr || '');
  carried = false;
}

console.log('\n--- tally ---');
console.log(output.trim());
console.log('-------------\n');

if (!carried) {
  fail([`${measure} has not carried. art-08/§45/¶1 — a measure that carries is enacted; this one has not.`]);
}

// art-11/§60/¶3 — amendments must be carried twice, thirty days apart.
if (spec.successive) {
  const successiveDays = spec.successive_days || 30;
  const resultFile = path.join(ROOT, 'ballots', measure, '_result.json');
  const priorFile = path.join(ROOT, 'ballots', measure, '_result.first.json');
  if (!fs.existsSync(priorFile)) {
    fail([
      `${measure} is of class "${required}", which must be carried twice, thirty days apart (art-11/§60/¶3).`,
      `Only one reading is recorded. Preserve the first as ballots/${measure}/_result.first.json,`,
      `then hold the second reading.`,
    ]);
  }
  const first = new Date(JSON.parse(fs.readFileSync(priorFile, 'utf8')).at);
  const second = new Date(JSON.parse(fs.readFileSync(resultFile, 'utf8')).at);
  const days = (second - first) / 86400000;
  if (days < successiveDays) {
    fail([`The two readings of ${measure} are ${days.toFixed(1)} days apart. ${successiveDays} are required (art-11/§60/¶3).`]);
  }
  console.log(`Two readings, ${days.toFixed(0)} days apart — art-11/§60/¶3 satisfied.`);
}

console.log(`${measure} carried. This change may be enacted (art-08/§45/¶1).`);
process.exit(0);

function fail(lines) {
  console.error('\nNot enacted:');
  for (const l of lines) console.error(`  ${l}`);
  process.exit(1);
}
