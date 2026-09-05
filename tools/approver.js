#!/usr/bin/env node
// Checks that a pull request has been approved by the Keeper of the Journal.
//
//   art-05/§25/¶2  publication is promulgation; an act not published has no effect
//   art-06/§28/¶3  every office holds an enumerated set of permissions
//
// The Assembly decides; the Keeper checks that what is being merged is what the
// Assembly carried. This resolves the Keeper from register/offices.yml
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

// art-05/§25/¶2 — publication is promulgation, and the Keeper publishes. What
// is merged is what is published, so the Keeper is who checks that a commit is
// the one the Assembly authorised.
const office = offices(ROOT).find((o) => (o.permissions || []).includes('journal.publish'))
            || offices(ROOT).find((o) => o.id === 'keeper');

if (!office) {
  console.log('No Keeper of the Journal is on the register, so no approval can be required (art-06/§29/¶4).');
  process.exit(0);
}

const holder = citizens(ROOT).find((c) => c.id === office.holder);
const account = holder?.github || null;

if (process.argv.includes('--who')) {
  console.log(`Keeper of the Journal: ${office.holder}${account ? ' (' + account + ')' : ' — no forge account recorded'}`);
  process.exit(0);
}

if (!account) {
  console.log(`The Keeper is ${office.holder}, but no forge account is recorded for them.`);
  console.log(`Add "github: <login>" to register/citizens/${office.holder}.yml to make this check bind.`);
  process.exit(0);           // do not block on a register that has not said who
}

const approvers = (a('approvers') || process.env.APPROVERS || '')
  .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);

console.log(`Keeper of the Journal: ${office.holder} (${account})`);
console.log(`Approved by: ${approvers.join(', ') || '(nobody yet)'}`);

if (approvers.map((x) => x.toLowerCase()).includes(account.toLowerCase())) {
  console.log(`\n\u2713 Approved by the Keeper of the Journal (art-05/\u00a725/\u00b62).`);
  process.exit(0);
}

console.error(`\n✗ This change awaits the Registrar's approval.`);
console.error(`  The Assembly decides what the law is; the Registrar checks that what is`);
console.error(`  merged is what the Assembly carried.`);
process.exit(1);
