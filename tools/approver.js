#!/usr/bin/env node
// Checks that a pull request has been approved by the Registrar.
//
//   art-06/§28/¶3  every office holds an enumerated set of permissions
//   art-02/§11/¶1  every act cites the provision under which it is made
//
// The Assembly decides; the Registrar checks that what is being merged is what
// the Assembly carried. This resolves the Registrar from register/offices.yml
// and the citizen's registered forge account, so the identity is the one in the
// register and not a name kept somewhere else.
//
//   node tools/approver.js --approvers alice,bob
//   node tools/approver.js --who            print who the Registrar is

import fs from 'node:fs';
import path from 'node:path';
import { offices, citizens } from './lib/registers.js';

const ROOT = process.cwd();
const a = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };

const office = offices(ROOT).find((o) => (o.permissions || []).includes('register.admit'))
            || offices(ROOT).find((o) => o.id === 'registrar');

if (!office) {
  console.log('No Registrar is on the register, so no approval can be required (art-06/§29/¶4).');
  process.exit(0);
}

const holder = citizens(ROOT).find((c) => c.id === office.holder);
const account = holder?.github || null;

if (process.argv.includes('--who')) {
  console.log(`Registrar: ${office.holder}${account ? ' (' + account + ')' : ' — no forge account recorded'}`);
  process.exit(0);
}

if (!account) {
  console.log(`The Registrar is ${office.holder}, but no forge account is recorded for them.`);
  console.log(`Add "github: <login>" to register/citizens/${office.holder}.yml to make this check bind.`);
  process.exit(0);           // do not block on a register that has not said who
}

const approvers = (a('approvers') || process.env.APPROVERS || '')
  .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);

console.log(`Registrar: ${office.holder} (${account})`);
console.log(`Approved by: ${approvers.join(', ') || '(nobody yet)'}`);

if (approvers.map((x) => x.toLowerCase()).includes(account.toLowerCase())) {
  console.log(`\n✓ Approved by the Registrar (art-06/§28/¶3).`);
  process.exit(0);
}

console.error(`\n✗ This change awaits the Registrar's approval.`);
console.error(`  The Assembly decides what the law is; the Registrar checks that what is`);
console.error(`  merged is what the Assembly carried.`);
process.exit(1);
