#!/usr/bin/env node
// Fills an office from a carried election, or shows what is outstanding.
//
//   art-06/§29/¶1  an office is filled by election, and the term runs from the
//                  declaration of the result
//   art-08/§45/¶1  a measure that carries is enacted
//
// An election that carried but was never given effect leaves the register
// saying one thing and the Journal another. This reconciles them.
//
//   node tools/office.js pending                     what is outstanding
//   node tools/office.js install --all               give effect to carried elections
//   node tools/office.js set --office X --holder Y   appoint, art-06/§29/¶4
//   node tools/office.js vacant --fill c-0006        fill every office held by nobody

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { append } from './lib/events.js';
import { offices, activeCitizens } from './lib/registers.js';

const ROOT = process.cwd();
const cmd = process.argv[2] || 'pending';
const OFFICES = path.join(ROOT, 'register/offices.yml');

function elections() {
  const dir = path.join(ROOT, 'proposals');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md') && x !== 'TEMPLATE.md')) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const end = src.indexOf('\n---', 3);
    const front = yaml.load(src.slice(4, end)) || {};
    if (front.class !== 'election') continue;
    const rf = path.join(ROOT, 'ballots', front.id, '_result.json');
    if (!fs.existsSync(rf)) continue;
    const r = JSON.parse(fs.readFileSync(rf, 'utf8'));
    const winner = r.outcome?.winner;
    const carried = r.outcome?.carried ?? (!r.open && !!winner);
    if (!carried || !winner) continue;
    out.push({ id: front.id, office: front.office, winner, at: r.at });
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

const outstanding = () => {
  const held = offices(ROOT);
  return elections().filter((e) => {
    const o = held.find((x) => x.id === e.office);
    return o && o.holder !== e.winner;
  });
};

const active = () => new Set(activeCitizens(ROOT).map((c) => c.id));

// art-06/§29/¶4 — on vacancy the Assembly appoints until an election is held.
// A departed citizen holds nothing, so an office recorded to one is vacant in
// fact while the register still names them.
const stranded = () => offices(ROOT).filter((o) => !active().has(o.holder));

if (cmd === 'pending') {
  const held = offices(ROOT);
  console.log('Offices:\n');
  for (const o of held) console.log(`  ${o.id.padEnd(12)} ${String(o.holder).padEnd(10)} until ${o.term_ends instanceof Date ? o.term_ends.toISOString().slice(0, 10) : o.term_ends || '?'}`);
  const out = outstanding();
  console.log(out.length ? `\nCarried but not given effect:\n` : '\nEvery carried election has taken effect.');
  for (const e of out) console.log(`  ${e.id}  elected ${e.winner} to ${e.office}`);
  if (out.length) console.log(`\n  node tools/office.js install --all`);

  const empty = stranded();
  if (empty.length) {
    console.log(`\nHeld by a citizenship that is not active — vacant in fact (art-06/§29/¶4):\n`);
    for (const o of empty) console.log(`  ${o.id.padEnd(12)} recorded to ${o.holder}`);
    const who = [...active()][0];
    console.log(`\n  node tools/office.js vacant --fill ${who || '<citizen>'}`);
  }
  process.exit(0);
}

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? null : process.argv[i + 1]; };

// art-06/§29/¶4 — the Assembly appoints until an election is held.
function appoint(list, holder, why) {
  const doc = yaml.load(fs.readFileSync(OFFICES, 'utf8')) || {};
  const today = new Date().toISOString().slice(0, 10);
  const ends = new Date(); ends.setFullYear(ends.getFullYear() + 1);
  let n = 0;
  for (const id of list) {
    const o = (doc.offices || []).find((x) => x.id === id);
    if (!o) { console.error(`  no office "${id}" on the register`); continue; }
    const previous = o.holder;
    o.holder = holder;
    o.since = today;
    o.term_ends = ends.toISOString().slice(0, 10);
    o.held_under = why;
    n++;
    append(ROOT, { at: new Date().toISOString(), author: holder, kind: 'office.appointed',
      provision: 'art-06/§29/¶4', payload: { office: id, holder, from: previous, why } });
    console.log(`  ${holder} appointed ${id}${previous ? ` in place of ${previous}` : ''} — ${why}`);
  }
  if (!n) { console.log('Nothing changed.'); return; }
  for (const o of doc.offices || []) for (const k of ['since', 'term_ends'])
    if (o[k] instanceof Date) o[k] = o[k].toISOString().slice(0, 10);
  fs.writeFileSync(OFFICES, yaml.dump(doc, { lineWidth: 100 }));
  console.log('\nCommit register/offices.yml and ledger/events.jsonl for it to take effect on the site.');
}

if (cmd === 'set') {
  const office = arg('office'), holder = arg('holder');
  if (!office || !holder) { console.error('usage: node tools/office.js set --office <id> --holder <citizen>'); process.exit(2); }
  if (!active().has(holder)) { console.error(`${holder} is not an active citizenship.`); process.exit(1); }
  appoint([office], holder, 'art-06/§29/¶4');
  process.exit(0);
}

if (cmd === 'vacant') {
  const holder = arg('fill');
  const empty = stranded();
  if (!empty.length) { console.log('No office is held by an inactive citizenship.'); process.exit(0); }
  if (!holder) {
    console.log('Vacant in fact (art-06/§29/¶4):\n');
    for (const o of empty) console.log(`  ${o.id.padEnd(12)} recorded to ${o.holder}`);
    console.log('\n  node tools/office.js vacant --fill <citizen>');
    process.exit(0);
  }
  if (!active().has(holder)) { console.error(`${holder} is not an active citizenship.`); process.exit(1); }
  appoint(empty.map((o) => o.id), holder, 'art-06/§29/¶4');
  process.exit(0);
}

if (cmd !== 'install') {
  console.error('usage:\n  node tools/office.js pending\n  node tools/office.js install [measure|--all]\n  node tools/office.js set --office <id> --holder <citizen>\n  node tools/office.js vacant [--fill <citizen>]');
  process.exit(2);
}

const all = process.argv.includes('--all');
const one = process.argv.find((x) => /^P-\d{4}$/.test(x));
const todo = all ? outstanding() : elections().filter((e) => e.id === one);

if (!todo.length) {
  console.log(one ? `${one} is not a carried election, or it has already taken effect.` : 'Nothing outstanding.');
  process.exit(0);
}

// Parse, change, write. A regular expression over YAML is a way to silently
// change nothing, which is what it did.
const doc = yaml.load(fs.readFileSync(OFFICES, 'utf8')) || {};
const today = new Date().toISOString().slice(0, 10);
let changed = 0;

for (const e of todo) {
  const o = (doc.offices || []).find((x) => x.id === e.office);
  if (!o) { console.error(`  ${e.id}: no office "${e.office}" on the register (art-06/§28/¶1)`); continue; }
  if (!activeCitizens(ROOT).some((c) => c.id === e.winner)) {
    console.error(`  ${e.id}: ${e.winner} is not an active citizenship`); continue;
  }
  const ends = new Date(); ends.setFullYear(ends.getFullYear() + 1);
  const previous = o.holder;

  o.holder = e.winner;
  o.since = today;
  o.term_ends = ends.toISOString().slice(0, 10);
  o.held_under = e.id;
  delete o.held_under_transitional;
  changed++;

  append(ROOT, {
    at: new Date().toISOString(), author: e.winner, kind: 'office.taken', provision: 'art-06/§29/¶1',
    payload: { office: e.office, holder: e.winner, from: previous, measure: e.id, term_ends: o.term_ends },
  });
  console.log(`  ${e.winner} takes ${e.office} under ${e.id}, until ${o.term_ends}`);
}

if (!changed) { console.log('Nothing changed.'); process.exit(0); }

// Dates as plain strings, so the register reads as text and not as a timestamp.
for (const o of doc.offices || []) for (const k of ['since', 'term_ends'])
  if (o[k] instanceof Date) o[k] = o[k].toISOString().slice(0, 10);

fs.writeFileSync(OFFICES, yaml.dump(doc, { lineWidth: 100 }));

console.log('\nCommit register/offices.yml and ledger/events.jsonl for it to take effect on the site.');
