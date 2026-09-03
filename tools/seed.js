#!/usr/bin/env node
// Founds the Republic (art-11/§64).
//
// Generates keys for the founding citizens, writes the registers, appends the
// founding records to the ledger, and publishes the first issue of the
// Journal. Run once. Everything it writes is ordinary data you can edit by
// hand afterwards — this is a convenience, not a privileged operation.

import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPair } from './lib/sshsig.js';
import { append } from './lib/events.js';

const ROOT = process.cwd();
const now = (offsetMinutes = 0) => new Date(Date.UTC(2026, 7, 26, 12, offsetMinutes)).toISOString();

const FOUNDERS = [
  { id: 'c-0001', display: 'Founder One', office: 'registrar' },
  { id: 'c-0002', display: 'Founder Two', office: 'keeper' },
  { id: 'c-0003', display: 'Founder Three', office: 'treasurer' },
  { id: 'c-0004', display: 'Founder Four', office: 'auditor' },
  { id: 'c-0005', display: 'Founder Five', office: null },
];

fs.mkdirSync(path.join(ROOT, 'private'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'register/citizens'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'register/entities'), { recursive: true });

const persons = {};
const keepers = [];

for (const f of FOUNDERS) {
  const kp = generateKeyPair(f.id);
  fs.writeFileSync(path.join(ROOT, `private/${f.id}.pem`), kp.privateKeyPem, { mode: 0o600 });
  if (f.office === 'keeper') {
    fs.writeFileSync(path.join(ROOT, 'private/keeper.pem'), kp.privateKeyPem, { mode: 0o600 });
    keepers.push(kp.publicKeyLine);
  }

  // The register holds no personal data — art-07/§37/¶2.
  fs.writeFileSync(
    path.join(ROOT, `register/citizens/${f.id}.yml`),
    [
      `id: ${f.id}`,
      `status: active`,
      `admitted: ${now().slice(0, 10)}`,
      `admitted_under: art-11/§64/¶2`,
      `supported_by: [${FOUNDERS.filter((x) => x.id !== f.id).slice(0, 2).map((x) => x.id).join(', ')}]`,
      `keys:`,
      `  - ${kp.publicKeyLine}`,
      '',
    ].join('\n')
  );

  // Personal data lives apart, and is not committed.
  persons[f.id] = { display: f.display, joined: now().slice(0, 10) };
}

fs.writeFileSync(path.join(ROOT, 'private/persons.json'), JSON.stringify(persons, null, 2));
fs.writeFileSync(path.join(ROOT, 'register/keepers.txt'), keepers.join('\n') + '\n');

// --- offices (art-06/§28) --------------------------------------------------

const OFFICES = [
  { id: 'registrar', title_en: 'Registrar', title_fr: 'Greffier', holder: 'c-0001',
    permissions: ['register.admit', 'register.object', 'entity.register'] },
  { id: 'keeper', title_en: 'Keeper of the Journal', title_fr: 'Gardien du Journal', holder: 'c-0002',
    permissions: ['journal.publish', 'checkpoint.sign'] },
  { id: 'treasurer', title_en: 'Treasurer', title_fr: 'Trésorier', holder: 'c-0003',
    permissions: ['value.issue', 'treasury.disburse'] },
  { id: 'auditor', title_en: 'Auditor', title_fr: 'Auditeur', holder: 'c-0004',
    permissions: ['audit.report'] },
];

fs.writeFileSync(
  path.join(ROOT, 'register/offices.yml'),
  'offices:\n' +
    OFFICES.map((o) =>
      [
        `  - id: ${o.id}`,
        `    title_en: ${o.title_en}`,
        `    title_fr: ${o.title_fr}`,
        `    holder: ${o.holder}`,
        `    since: ${now().slice(0, 10)}`,
        `    term_ends: 2027-08-26`,
        `    established_under: art-06/§28/¶1`,
        `    permissions: [${o.permissions.join(', ')}]`,
      ].join('\n')
    ).join('\n') +
    '\n'
);

// --- an entity, to show the pipeline (art-04/§19) --------------------------

fs.writeFileSync(
  path.join(ROOT, 'register/entities/e-0001.yml'),
  [
    'id: e-0001',
    'type: association',
    'name_en: Society of the Register',
    'name_fr: Société du Registre',
    'formed: 2026-08-26',
    'formed_under: art-04/§19/¶1',
    'charter: charters/e-0001.md',
    'organs:',
    '  - name: convenor',
    '    held_by: [c-0005]',
    'members: [c-0001, c-0005]',
    'status: active',
    '',
  ].join('\n')
);

// --- the founding records --------------------------------------------------

if (fs.existsSync(path.join(ROOT, 'ledger/events.jsonl'))) {
  fs.unlinkSync(path.join(ROOT, 'ledger/events.jsonl'));
}

let t = 0;
const record = (author, kind, provision, payload) =>
  append(ROOT, { at: now(t++), author, kind, provision, payload });

record('c-0001', 'constitution.enacted', 'art-11/§64/¶1', {
  version: '1.0.0',
  languages: ['en', 'fr'],
  note: 'Takes effect on publication in the first issue of the Journal.',
});

for (const f of FOUNDERS) {
  record(f.id, 'citizen.admitted', 'art-11/§64/¶2', { citizen: f.id });
}

for (const o of OFFICES) {
  record(o.holder, 'office.taken', 'art-06/§28/¶1', { office: o.id, holder: o.holder, term_ends: '2027-08-26' });
}

record('c-0005', 'entity.formed', 'art-04/§19/¶1', {
  entity: 'e-0001',
  type: 'association',
  name: 'Society of the Register',
});

record('c-0003', 'value.issued', 'art-09/§49/¶1', {
  amount: 50000,
  unit: 'obol',
  to: 'treasury',
  resolution: 'founding',
});

for (const f of FOUNDERS) {
  record('c-0003', 'value.transferred', 'art-09/§50/¶2', { from: 'treasury', to: f.id, amount: 1000, unit: 'obol' });
}

// --- the first issue of the Journal (art-05/§25) ---------------------------

fs.mkdirSync(path.join(ROOT, 'journal/2026'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'journal/2026/0001-founding.md'),
  `---
number: 1
date: ${now().slice(0, 10)}
title_en: Founding of the Republic
title_fr: Fondation de la République
cites: art-11/§64
---

The Constitution of the Digital Republic takes effect this day, on its
publication in this issue, under Article 11 § 64 ¹.

The founding citizens are those named in the first record of the register,
under Article 11 § 64 ².

Offices are taken under Article 6 § 28 ¹ and are held until 26 August 2027.
`
);

console.log('The Republic is founded.');
console.log(`  ${FOUNDERS.length} citizens, ${OFFICES.length} offices, 1 entity`);
console.log(`  private keys in private/ — never commit them`);
console.log(`  next: npm run checkpoint && npm run verify && npm run build`);
