#!/usr/bin/env node
// What is wrong, and what to do about it.
//
// A rebase or a merge can damage the register without anyone deciding to: two
// branches each append to ledger/events.jsonl, git concatenates the lines, and
// the hash chain no longer holds. That is damage, not an alteration under
// art-02/§9 — but it must be found, reported exactly, and repaired in the open.
//
//   node tools/doctor.js            diagnose
//   node tools/doctor.js --repair   repair what can be repaired safely

import fs from 'node:fs';
import path from 'node:path';
import { read, verifyChain, canonical, hashEvent, GENESIS, merkleRoot, checkpointList } from './lib/events.js';

const ROOT = process.cwd();
const repair = process.argv.includes('--repair');
const LEDGER = path.join(ROOT, 'ledger/events.jsonl');
const problems = [];
const note = (what, fix) => problems.push({ what, fix });

console.log('Examining the register.\n');

// --- 1. conflict markers, the plainest damage --------------------------------

for (const f of ['ledger/events.jsonl', 'register/offices.yml']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  if (!/^(<{7}|={7}|>{7})/m.test(src)) continue;
  note(`${f} contains merge conflict markers`,
    f === 'ledger/events.jsonl'
      ? 'the ledger is append-only, so both sides are real records — --repair keeps both, removes duplicates, and re-chains'
      : 'resolve this one by hand; nothing here can guess which side you meant');
}

// The ledger only ever grows. When two branches each append, both sides are
// genuine records, so the resolution is to keep every line from both and
// re-chain — never to choose one side over the other.
function resolveConflict() {
  const src = fs.readFileSync(LEDGER, 'utf8');
  const kept = src.split('\n').filter((l) => !/^(<{7}|={7}|>{7})/.test(l));
  fs.copyFileSync(LEDGER, LEDGER + '.with-conflict');
  fs.writeFileSync(LEDGER, kept.join('\n'));
}

function reparse() {
  const again = fs.readFileSync(LEDGER, 'utf8').split('\n').filter((l) => l.trim());
  parsed.length = 0;
  again.forEach((l, i) => {
    try { parsed.push(JSON.parse(l)); }
    catch { note(`ledger line ${i + 1} is still not valid JSON`, 'repair it by hand'); }
  });
  console.log(`  ${parsed.length} record(s) recovered`);
}

if (!fs.existsSync(LEDGER)) {
  console.log('  No ledger at ledger/events.jsonl.');
  process.exit(0);
}

// --- 2. lines that are not records -------------------------------------------

const lines = fs.readFileSync(LEDGER, 'utf8').split('\n').filter((l) => l.trim());
const parsed = [];
lines.forEach((l, i) => {
  try { parsed.push(JSON.parse(l)); }
  catch { note(`ledger line ${i + 1} is not valid JSON`, 'remove or repair that line'); }
});
console.log(`  ${lines.length} line(s), ${parsed.length} parsed as records`);

// --- 3. duplicates, which a merge produces -----------------------------------

const byHash = new Map();
const dupes = [];
for (const e of parsed) {
  if (byHash.has(e.hash)) dupes.push(e); else byHash.set(e.hash, e);
}
if (dupes.length) note(`${dupes.length} record(s) appear more than once`, 'a merge appended the same records twice; --repair removes the duplicates');

const seqs = new Map();
for (const e of parsed) seqs.set(e.seq, (seqs.get(e.seq) || 0) + 1);
const collided = [...seqs.entries()].filter(([, n]) => n > 1);
if (collided.length) note(`${collided.length} sequence number(s) used more than once: ${collided.slice(0, 5).map(([s]) => s).join(', ')}`, 'two branches each appended; --repair re-chains them in time order');

// --- 4. the chain ------------------------------------------------------------
//
// Only if every line parses. Reading a ledger with conflict markers in it throws,
// and a diagnostic that crashes on the fault it is looking for is no diagnostic.

if (problems.length && problems.some((p) => p.what.includes('conflict markers') || p.what.includes('not valid JSON'))) {
  console.log('\n' + problems.length + ' problem(s):\n');
  for (const p of problems) console.log(`  \u2717 ${p.what}\n      ${p.fix}`);
  if (!repair) {
    console.log('\nA ledger with conflict markers cannot be read at all, so nothing else can be checked.');
    console.log('To resolve it:  node tools/doctor.js --repair');
    process.exit(1);
  }
  console.log('\nResolving the conflict.\n');
  resolveConflict();
  console.log('  markers removed, both sides kept\n');
  problems.length = 0;
  reparse();
}

const chain = verifyChain(ROOT);
if (!chain.ok) {
  note(`${chain.problems.length} break(s) in the hash chain`, '--repair re-chains every record, keeping its content exactly');
  for (const p of chain.problems.slice(0, 5)) console.log(`      record ${p.seq}: ${p.error}`);
} else {
  console.log('  chain intact');
}

// --- 5. checkpoints against the register --------------------------------------

const cps = checkpointList(ROOT);
const leaves = parsed.map((e) => e.hash);
for (const c of cps) {
  if (c.records > parsed.length) note(`checkpoint ${c.number} attests ${c.records} records but the register holds ${parsed.length}`, 'records were lost or removed; restore them, or --repair reissues the checkpoints');
  else if (merkleRoot(leaves.slice(0, c.records)) !== c.root) note(`checkpoint ${c.number} does not match the register`, 'the register changed after it was attested; --repair reissues the checkpoints');
}
if (cps.length && !problems.some((p) => p.what.startsWith('checkpoint'))) console.log(`  ${cps.length} checkpoint(s) match`);

// --- report -------------------------------------------------------------------

if (!problems.length) {
  console.log('\nNothing is wrong. The register verifies.');
  process.exit(0);
}

console.log(`\n${problems.length} problem(s):\n`);
for (const p of problems) console.log(`  \u2717 ${p.what}\n      ${p.fix}`);

if (!repair) {
  console.log('\nTo repair what can be repaired safely:  node tools/doctor.js --repair');
  console.log('Nothing is changed until you ask for it.');
  process.exit(1);
}

if (problems.some((p) => p.what.includes('conflict markers')) || problems.some((p) => p.what.includes('not valid JSON'))) {
  console.error('\nRefusing to repair: fix the conflict markers or unparsable lines by hand first.');
  process.exit(1);
}

// --- repair --------------------------------------------------------------------
//
// Every record's content is kept exactly. Only the ordering fields — seq, prev,
// hash — are recomputed, because those are what a merge destroys. Duplicates go.

console.log('\nRepairing.\n');
const seen = new Set();
const keep = [];
for (const e of parsed) {
  const fingerprint = canonical({ at: e.at, author: e.author, entity: e.entity, kind: e.kind, provision: e.provision, payload: e.payload });
  if (seen.has(fingerprint)) continue;
  seen.add(fingerprint);
  keep.push(e);
}
keep.sort((a, b) => String(a.at).localeCompare(String(b.at)));

fs.copyFileSync(LEDGER, LEDGER + '.before-repair');
let prev = GENESIS;
const out = keep.map((e, i) => {
  const body = { seq: i + 1, at: e.at, author: e.author, entity: e.entity, kind: e.kind, provision: e.provision, payload: e.payload, prev };
  const hash = hashEvent(prev, body);
  prev = hash;
  return JSON.stringify({ ...body, hash });
});
fs.writeFileSync(LEDGER, out.join('\n') + '\n');

console.log(`  ${parsed.length} record(s) in, ${keep.length} kept, ${parsed.length - keep.length} duplicate(s) removed`);
console.log(`  re-chained in time order; the previous file is at ledger/events.jsonl.before-repair`);

const stale = checkpointList(ROOT);
if (stale.length) {
  fs.rmSync(path.join(ROOT, 'checkpoints'), { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, 'checkpoints'), { recursive: true });
  console.log(`  ${stale.length} checkpoint(s) removed — they attested a register that no longer exists`);
  console.log(`  reissue one:  node tools/checkpoint.js`);
}

console.log('\nNow:  node tools/verify.js && node tools/test.js');
console.log('Then commit ledger/events.jsonl and checkpoints/, and say in the message what was repaired.');
