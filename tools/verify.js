#!/usr/bin/env node
// The citizen's verifier (art-05/§26).
//
// Needs nothing but node and a copy of the repository. No account, no
// permission, no network. Run it, and you know whether the Republic has
// rewritten its own history.

import fs from 'node:fs';
import path from 'node:path';
import { verifyChain, read, merkleRoot, merkleProof, verifyProof, checkpointList, GENESIS, canonical } from './lib/events.js';
import { verify as verifySig } from './lib/sshsig.js';

const ROOT = process.cwd();
let failures = 0;

function ok(msg) { console.log('  \u2713 ' + msg); }
function bad(msg) { console.log('  \u2717 ' + msg); failures++; }

console.log('\nRegister\n');
const chain = verifyChain(ROOT);
if (chain.ok) ok(`${chain.count} records, chain intact, head ${chain.head.slice(0, 16)}\u2026`);
else { bad(`${chain.problems.length} problem(s) in the chain:`); for (const p of chain.problems) console.log(`      record ${p.seq}: ${p.error}`); }

console.log('\nCheckpoints\n');
const events = read(ROOT);
const leaves = events.map((e) => e.hash);
const checkpoints = checkpointList(ROOT);
if (!checkpoints.length) console.log('  (none published yet)');

let expectedPrev = GENESIS;
for (const cp of checkpoints) {
  const label = `checkpoint ${cp.number} (${cp.records} records)`;
  if (cp.previous !== expectedPrev) bad(`${label}: does not follow the previous checkpoint`);
  else if (cp.records > events.length) bad(`${label}: claims more records than the register holds`);
  else {
    const root = merkleRoot(leaves.slice(0, cp.records));
    if (root !== cp.root) bad(`${label}: Merkle root does not match the register`);
    else ok(`${label}: root matches`);
  }
  if (cp.signature) {
    const { signature, ...body } = cp;
    const keys = fs.existsSync(path.join(ROOT, 'register/keepers.txt'))
      ? fs.readFileSync(path.join(ROOT, 'register/keepers.txt'), 'utf8').split('\n').filter(Boolean)
      : [];
    const r = verifySig(canonical(body), signature, keys, { namespace: 'republic-checkpoint' });
    if (r.ok) ok(`  signature valid`); else bad(`  signature: ${r.error}`);
  }
  expectedPrev = cp.root;
}

console.log('\nInclusion proof (spot check)\n');
if (events.length) {
  const i = Math.floor(events.length / 2);
  const proof = merkleProof(leaves, i);
  const good = verifyProof(leaves[i], proof, merkleRoot(leaves));
  good ? ok(`record ${i + 1} proves inclusion in ${proof.length} steps`) : bad('inclusion proof failed');
}

console.log(`\n${failures === 0 ? 'The Republic verifies.' : `${failures} failure(s).`}\n`);
process.exit(failures ? 1 : 0);
