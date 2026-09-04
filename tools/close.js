#!/usr/bin/env node
// Closes every measure that is due, and enacts those that carried.
//
//   art-08/§43/¶5  voting closes at the earlier of the end of the period, or
//                  the moment the outcome can no longer change
//   art-08/§45/¶1  a measure that carries is enacted by publication
//
// Run on a schedule, this means no measure sits open after it is decided and
// no carried measure waits on someone remembering to promulgate it.
//
// Usage:
//   node tools/close.js            close everything that is due
//   node tools/close.js P-0002     close one measure
//   node tools/close.js --dry-run  report what would close, change nothing

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { execFileSync } from 'node:child_process';
import { classSpec, ballotRules } from './lib/params.js';
import { isoDate } from './lib/corpus.js';
import { activeCitizens } from './lib/registers.js';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const only = args.find((a) => /^P-\d{4}$/.test(a));

const roll = activeCitizens(ROOT);
const early = (ballotRules(ROOT).early_close) || {};

const dir = path.join(ROOT, 'proposals');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'TEMPLATE.md') : [];

const due = [];

for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const end = src.indexOf('\n---', 3);
  if (end === -1) continue;
  const front = yaml.load(src.slice(4, end)) || {};
  if (!front.id) continue;
  if (only && front.id !== only) continue;

  let spec;
  try { spec = classSpec(ROOT, front.class); } catch { continue; }

  // Already published? Then it is done.
  const result = readResult(front.id);
  if (result && result.open === false && result.enacted) continue;

  const opened = front.opened ? new Date(isoDate(front.opened) + 'T00:00:00Z') : null;
  const closes = front.closes ? new Date(isoDate(front.closes) + 'T23:59:59Z')
    : opened ? new Date(opened.getTime() + spec.window_days * 86400000) : null;

  const expired = closes ? new Date() >= closes : false;
  const ballots = countBallots(front.id);
  const determined = early.enabled && early.on_full_participation && roll.length > 0 && ballots >= roll.length;

  if (expired || determined) {
    due.push({ id: front.id, title: front.title || front.title_en || '', why: expired ? 'the period has ended' : 'every citizenship has voted (art-08/§43/¶6)' });
  }
}

if (!due.length) {
  console.log(only ? `${only} is not due to close.` : 'Nothing is due to close.');
  process.exit(0);
}

console.log(`${due.length} measure(s) due:\n`);
for (const d of due) console.log(`  ${d.id} — ${d.title}\n      ${d.why}`);
console.log('');

if (dry) { console.log('(dry run — nothing changed)'); process.exit(0); }

let closed = 0, enacted = 0;

for (const d of due) {
  console.log(`\n=== ${d.id} ===`);
  let carried = false;
  try {
    const out = execFileSync('node', ['tools/tally.js', d.id], { encoding: 'utf8' });
    console.log(out.trim());
    carried = /\bCARRIED\b/.test(out) && !/NOT CARRIED/.test(out);
  } catch (e) {
    console.log(((e.stdout || '') + (e.stderr || '')).trim());
    carried = false;
  }
  closed++;

  if (carried) {
    try {
      console.log(execFileSync('node', ['tools/enact.js', d.id], { encoding: 'utf8' }).trim());
      markEnacted(d.id);
      enacted++;
    } catch (e) {
      console.error(`  could not enact: ${((e.stdout || '') + (e.stderr || '')).trim()}`);
    }
  }
}

console.log(`\n${closed} closed, ${enacted} enacted.`);

function readResult(id) {
  const f = path.join(ROOT, 'ballots', id, '_result.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

function markEnacted(id) {
  const f = path.join(ROOT, 'ballots', id, '_result.json');
  if (!fs.existsSync(f)) return;
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  r.enacted = new Date().toISOString();
  fs.writeFileSync(f, JSON.stringify(r, null, 2));
}

function countBallots(id) {
  const d = path.join(ROOT, 'ballots', id);
  if (!fs.existsSync(d)) return 0;
  return fs.readdirSync(d).filter((f) => f.endsWith('.json') && !f.startsWith('_')).length;
}
