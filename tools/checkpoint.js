#!/usr/bin/env node
// Publishes a signed checkpoint (art-02/§10/¶2).
//
// A checkpoint attests the whole register at a moment: the number of records,
// the Merkle root over them, the head of the hash chain, and a link to the
// previous checkpoint. Anyone can verify it with tools/verify.js and nothing
// else. art-02/§10/¶3.

import fs from 'node:fs';
import path from 'node:path';
import { read, merkleRoot, verifyChain, GENESIS, canonical } from './lib/events.js';
import { sign } from './lib/sshsig.js';

const ROOT = process.cwd();
const chain = verifyChain(ROOT);
if (!chain.ok) {
  console.error('Refusing to checkpoint: the register does not verify.');
  for (const p of chain.problems) console.error(`  ✗ record ${p.seq}: ${p.error}`);
  process.exit(1);
}

const events = read(ROOT);
const leaves = events.map((e) => e.hash);
const previous = fs.existsSync(path.join(ROOT, 'checkpoints'))
  ? fs.readdirSync(path.join(ROOT, 'checkpoints')).filter((f) => f.endsWith('.json')).sort()
  : [];
const prevFile = previous[previous.length - 1];
const prev = prevFile ? JSON.parse(fs.readFileSync(path.join(ROOT, 'checkpoints', prevFile), 'utf8')) : null;

const body = {
  number: (prev?.number ?? 0) + 1,
  at: new Date().toISOString(),
  records: events.length,
  root: merkleRoot(leaves),
  head: chain.head,
  previous: prev ? prev.root : GENESIS,
};

const keyPath = process.env.REPUBLIC_KEY || 'private/keeper.pem';
if (fs.existsSync(keyPath)) {
  body.signature = sign(canonical(body), fs.readFileSync(keyPath, 'utf8'), { namespace: 'republic-checkpoint' });
} else {
  console.warn(`(no signing key at ${keyPath} — checkpoint is unsigned)`);
}

const name = `checkpoints/${String(body.number).padStart(6, '0')}.json`;
fs.mkdirSync(path.join(ROOT, 'checkpoints'), { recursive: true });
fs.writeFileSync(path.join(ROOT, name), JSON.stringify(body, null, 2) + '\n');
console.log(`Checkpoint ${body.number}: ${body.records} records, root ${body.root.slice(0, 16)}…`);
console.log(`Written to ${name}`);
