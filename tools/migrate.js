#!/usr/bin/env node
// Moves the Republic to one corpus root.
//
// The Journal is the record of everything the Republic has done, and the law is
// part of that record rather than a separate shelf. So:
//
//   constitution/        -> journal/constitution/
//   statutes/            -> journal/statutes/
//   journal/YYYY/*.md    -> journal/issues/YYYY/*.md
//   judgments/           -> journal/judgments/
//
// Idempotent, and it uses `git mv` where git is present so the history follows
// the file. Nothing in the ledger changes: art-02/§9 forbids it, and citations
// are logical (const.art-04/§20) rather than paths, so nothing breaks.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const dry = process.argv.includes('--dry-run');
const hasGit = fs.existsSync(path.join(ROOT, '.git'));

const move = (from, to) => {
  const src = path.join(ROOT, from), dst = path.join(ROOT, to);
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dst)) { console.log(`  · ${to} already exists, leaving ${from} alone`); return false; }
  console.log(`  ${from} → ${to}`);
  if (dry) return true;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (hasGit) { try { execFileSync('git', ['mv', from, to], { cwd: ROOT, stdio: 'pipe' }); return true; } catch {} }
  fs.renameSync(src, dst);
  return true;
};

console.log('Moving to one corpus root under journal/\n');
let n = 0;

n += move('constitution', 'journal/constitution') ? 1 : 0;
n += move('statutes', 'journal/statutes') ? 1 : 0;
n += move('judgments', 'journal/judgments') ? 1 : 0;

// the dated issue folders
const jdir = path.join(ROOT, 'journal');
if (fs.existsSync(jdir)) {
  for (const f of fs.readdirSync(jdir)) {
    if (/^\d{4}$/.test(f) && fs.statSync(path.join(jdir, f)).isDirectory()) {
      n += move(`journal/${f}`, `journal/issues/${f}`) ? 1 : 0;
    }
  }
}

if (!dry) {
  for (const d of ['journal/constitution', 'journal/statutes', 'journal/judgments', 'journal/issues']) {
    fs.mkdirSync(path.join(ROOT, d), { recursive: true });
  }
}

console.log(`\n${n} move(s)${dry ? ' (dry run)' : ''}.`);
if (n && !dry) console.log('Now: npm test && npm run verify && npm run build');
