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
  // --- Records and instruments: exempt ------------------------------------
  // These ARE the outputs of procedure. Requiring a vote to record a vote
  // would deadlock the Republic on its first measure.
  { pattern: /^ballots\//,                          class: null, why: 'ballots are how voting happens' },
  { pattern: /^proposals\//,                        class: null, why: 'proposing is not enacting (art-08/§41)' },
  { pattern: /^ledger\//,                           class: null, why: 'records (art-05/§24)' },
  { pattern: /^checkpoints\//,                      class: null, why: 'checkpoints (art-02/§10/¶2)' },
  { pattern: /^journal\/issues\//,                  class: null, why: 'publication is promulgation (art-05/§25/¶2)' },
  { pattern: /^journal\/judgments\//,               class: null, why: 'the Court decides; the Assembly does not vote on judgments (art-06/§31)' },
  { pattern: /^register\/citizens\//,               class: null, why: 'admission takes effect on recording (art-03/§16/¶3)' },
  { pattern: /^transfers\//,                        class: null, why: 'a signed transfer, settled by the workflow (art-09/§50/¶2)' },
  { pattern: /^orders\//,                           class: null, why: 'an order on the exchange (art-09/§52/¶3)' },
  { pattern: /^settled\//,                          class: null, why: 'settled instruments' },
  { pattern: /^entity-acts\//,                      class: null, why: 'an entity acting through its organs (art-04/§21/¶2)' },
  { pattern: /^contracts\//,                        class: null, why: 'a contract between parties, not an act of the Assembly' },
  { pattern: /^charters\//,                         class: null, why: 'an entity charter is the entity\u2019s own instrument (art-04/§21/¶1)' },
  { pattern: /^(README|SETUP|samples)/,             class: null, why: 'documentation' },

  // --- Entities: as of right, or by law -----------------------------------
  // art-04/§19/¶1 gives every citizen the right to form an association, a
  // company, or a foundation. A commune or an organ of the Republic exists
  // only because the Assembly said so, so entering one is an ordinary act
  // that must cite the measure — parameters.yml decides which is which, and
  // tools/entity.js enforces it at the point of formation.
  { pattern: /^register\/entities\//,               class: null, why: 'formation as of right, or by measure, as tools/entity.js enforces (art-04/§19, §20/¶3)' },

  // --- The Constitution ----------------------------------------------------
  // Both layouts, so a repository mid-migration is never ungated.
  { pattern: /^(journal\/)?constitution\/(en|fr)?\/?(02|07|11)-/, class: 'entrenched', why: 'entrenched Article (art-11/§61)' },
  { pattern: /^(journal\/)?constitution\//,         class: 'amendment', why: 'amends the Constitution (art-11/§60)' },

  // --- Statute -------------------------------------------------------------
  { pattern: /^(journal\/)?statutes\//,             class: 'policy', why: 'statute (art-01/§4/¶3)' },

  // --- Code ----------------------------------------------------------------
  // The tools ARE the procedure: whoever can edit the tally can redefine what
  // "carried" means. site/republic.js signs ballots, so it sits here too.
  { pattern: /^tools\//,                            class: 'organic', why: 'the published tools (art-05/§26/¶1)' },
  { pattern: /^site\/republic\.js$/,                class: 'organic', why: 'the browser signs ballots with this (art-08/§43/¶2)' },
  { pattern: /^site\//,                             class: null, why: 'presentation, not law' },
  { pattern: /^\.github\/workflows\//,              class: 'organic', why: 'procedure executing (art-08/§41)' },
  { pattern: /^\.github\/(ruleset|CODEOWNERS)/,     class: 'organic', why: 'merge discipline' },
  { pattern: /^parameters\.yml$/,                   class: 'organic', why: 'a tunable value; the tools read it (art-01/§4/¶3)' },
  { pattern: /^package\.json$/,                     class: 'organic', why: 'what the tools run as' },

  // --- Offices -------------------------------------------------------------
  { pattern: /^register\/offices\.yml$/,            class: 'ordinary', why: 'offices and permissions (art-06/§28/¶3)' },
  { pattern: /^register\/keepers\.txt$/,            class: 'ordinary', why: 'the Keeper\u2019s signing key' },

  // Anything else under journal/ is published record.
  { pattern: /^journal\//,                          class: null, why: 'published record (art-05/§25)' },
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

console.log(`This change requires a measure of class "${required}" (${spec.label}):\n`);
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

// art-08/§45/¶1 — what is enacted is what carried. A measure may name the
// change it authorises, and then only that change may be merged under it. A
// measure that names nothing authorises anything of its class, which is looser
// and is why naming it is the better practice.
const authorises = [].concat(
  (fs.readFileSync(path.join(ROOT, 'proposals', proposalFile), 'utf8').match(/^authorises:\s*(.+)$/m) || [])[1] || []
).join('').trim();

if (authorises) {
  const pr = process.env.PR_NUMBER || (process.env.GITHUB_REF || '').match(/refs\/pull\/(\d+)/)?.[1] || '';
  const sha = process.env.PR_HEAD_SHA || process.env.GITHUB_SHA || '';
  // YAML may hand us "#12" quoted, since # starts a comment unquoted.
  const named = authorises.replace(/["']/g, '').split(/[,\s]+/).filter(Boolean);
  const matched = named.some((n) => {
    const bare = n.replace(/^#/, '').trim();
    return (pr && bare === pr) || (sha && sha.startsWith(bare)) || (bare.length >= 7 && sha.includes(bare));
  });
  console.log(`\n${measure} authorises: ${named.join(', ')}`);
  console.log(`This change is: pull request ${pr || '(none)'}${sha ? ', commit ' + sha.slice(0, 10) : ''}`);
  if (!matched) {
    fail([
      `${measure} authorises ${named.join(', ')}, which is not this change.`,
      `A measure enacts what it named and nothing else (art-08/§45/¶1).`,
      `Either open the change the measure named, or carry a measure naming this one.`,
    ]);
  }
  console.log(`✓ this is the change ${measure} authorised.`);
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
