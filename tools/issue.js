#!/usr/bin/env node
// Issues value or instruments.
//
//   art-09/§49/¶1  the unit is issued only by the Treasurer, only under a
//                  resolution of the Assembly, and only in the amount it states
//   art-09/§51/¶1  an entity may issue instruments representing a share in it
//
//   node tools/issue.js --unit 50000 --under P-0004 --by c-0006
//   node tools/issue.js --instrument e-0001:ordinary --quantity 1000 --by c-0006

import fs from 'node:fs';
import path from 'node:path';
import { append } from './lib/events.js';
import { offices, entities } from './lib/registers.js';
import { params } from './lib/params.js';
import { ledgerState, mayActFor, TREASURY } from './lib/value.js';

const ROOT = process.cwd();
const a = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };

const unit = a('unit') ? Number(a('unit')) : null;
const instrument = a('instrument');
const quantity = a('quantity') ? Number(a('quantity')) : null;
const under = a('under');
const by = a('by');
const to = a('to');

if (!by || (!unit && !instrument)) {
  console.error('usage:\n  node tools/issue.js --unit <n> --under <measure> --by <citizen>\n  node tools/issue.js --instrument <entity>:<class> --quantity <n> --by <citizen> [--to <account>]');
  process.exit(2);
}

if (unit != null) {
  // art-09/§49/¶1 — only the Treasurer, only under a resolution.
  const treasurer = offices(ROOT).find((o) => (o.permissions || []).includes('value.issue'));
  if (!treasurer || treasurer.holder !== by) {
    console.error(`Only the holder of value.issue may issue the unit (art-09/§49/¶1). That is ${treasurer ? treasurer.holder : 'nobody'}.`);
    process.exit(1);
  }
  if (!under) { console.error('An issue requires the resolution that authorises it (art-09/§49/¶1). Pass --under <measure>.'); process.exit(1); }

  // art-08/§45/¶1 — a measure that has not carried authorises nothing. Naming
  // one is not the same as having one.
  const resultFile = path.join(ROOT, 'ballots', under, '_result.json');
  if (!fs.existsSync(resultFile)) {
    console.error(`${under} has not been counted, so it authorises nothing (art-08/§45/¶1).`);
    process.exit(1);
  }
  const outcome = JSON.parse(fs.readFileSync(resultFile, 'utf8')).outcome || {};
  if (!outcome.carried) {
    console.error(`${under} ${outcome.open ? 'is still open' : 'did not carry'}, so it authorises nothing (art-08/§45/¶1).`);
    process.exit(1);
  }
  const cap = params(ROOT).value.issue_cap_per_resolution;
  if (unit > cap) { console.error(`${unit} exceeds the cap of ${cap} per resolution (parameters.yml).`); process.exit(1); }

  append(ROOT, { at: new Date().toISOString(), author: by, kind: 'value.issued',
    provision: 'art-09/§49/¶1', payload: { amount: unit, unit: params(ROOT).value.unit, to: to || TREASURY, resolution: under } });
  console.log(`Issued ${unit} ${params(ROOT).value.unit} to ${to || TREASURY} under ${under}.`);
  process.exit(0);
}

// art-09/§51/¶1 — an entity issues a share in itself.
const [entityId, cls] = String(instrument).split(':');
const e = entities(ROOT).find((x) => x.id === entityId);
if (!e) { console.error(`No entity "${entityId}".`); process.exit(1); }
const type = params(ROOT).entities.types[e.type];
if (!type?.may_issue_instruments) {
  console.error(`A ${e.type} may not issue instruments (art-04/§20/¶3). Only: ${Object.entries(params(ROOT).entities.types).filter(([, t]) => t.may_issue_instruments).map(([k]) => k).join(', ')}.`);
  process.exit(1);
}
if (!mayActFor(ROOT, by, entityId)) { console.error(`${by} is not an organ of ${entityId} (art-04/§21/¶2).`); process.exit(1); }
if (!quantity || quantity <= 0) { console.error('--quantity must be a positive number'); process.exit(1); }

append(ROOT, { at: new Date().toISOString(), author: by, entity: entityId, kind: 'instrument.issued',
  provision: 'art-09/§51/¶1', payload: { instrument: `${entityId}:${cls || 'ordinary'}`, issuer: entityId, class: cls || 'ordinary', quantity, to: to || entityId } });

console.log(`Issued ${quantity} × ${entityId}:${cls || 'ordinary'} to ${to || entityId}.`);
console.log(`  citable as the instrument of ${entityId}; transfer with tools/pay.js`);
