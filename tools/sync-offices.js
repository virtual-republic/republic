#!/usr/bin/env node
// Reports drift between register/offices.yml and GitHub team membership.
//
// The office register is authoritative (art-01/§5/¶2, art-06/§28/¶3). GitHub
// teams are a projection of it. This does not change the register to match
// GitHub; it tells you where GitHub has drifted from the register.

import { execFileSync } from 'node:child_process';
import { offices, citizenById } from './lib/registers.js';

const ROOT = process.cwd();
const org = process.env.GITHUB_ORG || process.argv[2];
if (!org) { console.error('usage: node tools/sync-offices.js <github-org>'); process.exit(2); }

const gh = (args) => JSON.parse(execFileSync('gh', ['api', ...args]).toString());
let drift = 0;

for (const o of offices(ROOT)) {
  const holder = citizenById(ROOT, o.holder);
  const expected = holder?.github ? [holder.github] : [];
  let actual = [];
  try {
    actual = gh([`/orgs/${org}/teams/${o.id}/members`]).map((m) => m.login);
  } catch {
    console.log(`  ! team "${o.id}" does not exist in ${org}`);
    drift++;
    continue;
  }
  const extra = actual.filter((a) => !expected.includes(a));
  const missing = expected.filter((e) => !actual.includes(e));
  if (extra.length || missing.length) {
    drift++;
    console.log(`  ✗ ${o.id}: register says [${expected.join(', ') || '—'}], GitHub says [${actual.join(', ') || '—'}]`);
    for (const e of extra) console.log(`      remove ${e} — holds a permission the register does not grant (art-01/§3/¶3)`);
    for (const m of missing) console.log(`      add ${m}`);
  } else {
    console.log(`  ✓ ${o.id}`);
  }
}
console.log(drift ? `\n${drift} office(s) drifted from the register.` : '\nGitHub matches the register.');
process.exit(drift ? 1 : 0);
