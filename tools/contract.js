#!/usr/bin/env node
// Contracts: drafted by one party, executed only when every party has signed.
//
// A contract is a document; signing it is a signed instrument over the document's
// hash, so a party signs the text and not a summary of it. Execution is recorded
// in the register under art-05/§24.
//
//   node tools/contract.js draft --title "Supply of records" --parties c-0006,e-0001 --by c-0006
//   node tools/contract.js sign  --id supply-of-records --by c-0006
//   node tools/contract.js list

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonical, sha256 } from './lib/events.js';
import { sign as sshsign } from './lib/sshsig.js';
import { accounts, mayActFor, contracts, contractComplete } from './lib/value.js';
import { params } from './lib/params.js';

const ROOT = process.cwd();
const cmd = process.argv[2];
const a = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };

const DIR = path.join(ROOT, 'contracts');

if (cmd === 'list') {
  const all = contracts(ROOT);
  if (!all.length) { console.log('No contracts.'); process.exit(0); }
  for (const c of all) {
    const need = [].concat(c.parties || []);
    const have = c.signatures.map((s) => s.by);
    console.log(`${c.id}  ${c.title}`);
    console.log(`  parties  ${need.map((p) => (have.includes(p) ? p + ' ✓' : p + ' —')).join('  ')}`);
    console.log(`  ${contractComplete(ROOT, c) ? 'executed' : 'awaiting signature'}`);
  }
  process.exit(0);
}

if (cmd === 'draft') {
  const title = a('title'), by = a('by');
  const parties = (a('parties') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const terms = a('terms', '');
  if (!title || !by || parties.length < 2) {
    console.error('usage: node tools/contract.js draft --title "..." --parties a,b --by <citizen> [--terms "..."]');
    process.exit(2);
  }
  const acct = accounts(ROOT);
  for (const p of parties) if (!acct.has(p)) { console.error(`"${p}" is not an account.`); process.exit(1); }
  if (!parties.some((p) => mayActFor(ROOT, by, p))) { console.error(`${by} is not a party and acts for none of them.`); process.exit(1); }

  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `${id}.md`);
  if (fs.existsSync(file)) { console.error(`${id} already exists.`); process.exit(1); }

  const expires = new Date(Date.now() + params(ROOT).contracts.expiry_days * 86400000).toISOString().slice(0, 10);
  fs.writeFileSync(file, `---
id: ${id}
title: ${title}
parties: [${parties.join(', ')}]
drafted_by: ${by}
drafted: ${new Date().toISOString().slice(0, 10)}
expires: ${expires}
---

## § 1  Parties

¹ This contract is between ${parties.join(' and ')}.

## § 2  Terms

¹ ${terms || 'The terms are as the parties agree and as set out below.'}

## § 3  Effect

¹ This contract takes effect when every party has signed it.

² Signature is by the key registered to the party, over the text of this document as it then stands.

³ An alteration after signature voids every signature given.
`);
  console.log(`Drafted ${id}.`);
  console.log(`  contracts/${id}.md — edit the terms, then each party signs`);
  console.log(`  node tools/contract.js sign --id ${id} --by <citizen>`);
  process.exit(0);
}

if (cmd === 'sign') {
  const id = a('id'), by = a('by');
  if (!id || !by) { console.error('usage: node tools/contract.js sign --id <id> --by <citizen>'); process.exit(2); }
  const c = contracts(ROOT).find((x) => x.id === id);
  if (!c) { console.error(`No contract "${id}".`); process.exit(1); }

  const party = [].concat(c.parties || []).find((p) => mayActFor(ROOT, by, p));
  if (!party) { console.error(`${by} is not a party to ${id} and acts for none of them.`); process.exit(1); }

  const key = `private/${by}.pem`;
  if (!fs.existsSync(key)) { console.error(`no key at ${key}`); process.exit(2); }

  // The signature covers the document as it stands — art-04 style: sign the text.
  const text = fs.readFileSync(path.join(ROOT, c.file), 'utf8');
  const body = { kind: 'contract-signature', contract: id, party, by, document: sha256(text), at: new Date().toISOString(), salt: crypto.randomBytes(8).toString('hex') };
  body.signature = sshsign(canonical(body), fs.readFileSync(key, 'utf8'), { namespace: 'republic' });

  fs.mkdirSync(path.join(DIR, id), { recursive: true });
  fs.writeFileSync(path.join(DIR, id, `${party}.json`), JSON.stringify(body, null, 2) + '\n');

  const after = contracts(ROOT).find((x) => x.id === id);
  console.log(`${party} signed ${id}.`);
  console.log(contractComplete(ROOT, after)
    ? '  every party has signed — settle to record execution: node tools/settle.js'
    : `  awaiting: ${[].concat(c.parties).filter((p) => !after.signatures.some((s) => s.by === p)).join(', ')}`);
  process.exit(0);
}

console.error('usage: node tools/contract.js <draft|sign|list> ...');
process.exit(2);
