#!/usr/bin/env node
// Publishes a signed checkpoint (art-02/§10/¶2).
//
// A checkpoint attests the whole register at a moment: the number of records,
// the Merkle root over them, the head of the hash chain, and a link to the
// previous checkpoint. Anyone can verify it with tools/verify.js and nothing
// else. art-02/§10/¶3.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
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

// Sign with whichever key the Keeper actually has. A PKCS8 PEM (from
// tools/keygen.js) is signed in pure Node. An OpenSSH private key — the one
// most people already have at ~/.ssh/id_ed25519 — is signed by ssh-keygen,
// which produces the identical SSHSIG format.
const candidates = [
  process.env.REPUBLIC_KEY,
  'private/keeper.pem',
  path.join(os.homedir(), '.ssh/id_ed25519'),
].filter(Boolean);

const keyPath = candidates.find((f) => fs.existsSync(f));

if (!keyPath) {
  console.warn(`(no signing key found — checkpoint is unsigned)`);
} else {
  const material = fs.readFileSync(keyPath, 'utf8');
  if (material.includes('BEGIN PRIVATE KEY')) {
    body.signature = sign(canonical(body), material, { namespace: 'republic-checkpoint' });
    console.log(`Signed with ${keyPath}`);
  } else if (material.includes('BEGIN OPENSSH PRIVATE KEY')) {
    const tmp = path.join(os.tmpdir(), `cp-${process.pid}`);
    fs.writeFileSync(tmp, canonical(body));
    try {
      execFileSync('ssh-keygen', ['-Y', 'sign', '-q', '-f', keyPath, '-n', 'republic-checkpoint', tmp]);
      body.signature = fs.readFileSync(`${tmp}.sig`, 'utf8');
      console.log(`Signed with ${keyPath} via ssh-keygen`);
    } catch (e) {
      console.warn(`(ssh-keygen could not sign: ${e.message.split('\n')[0]} — checkpoint is unsigned)`);
    } finally {
      fs.rmSync(tmp, { force: true });
      fs.rmSync(`${tmp}.sig`, { force: true });
    }
  } else {
    console.warn(`(${keyPath} is not a recognised key format — checkpoint is unsigned)`);
  }
}

const name = `checkpoints/${String(body.number).padStart(6, '0')}.json`;
fs.mkdirSync(path.join(ROOT, 'checkpoints'), { recursive: true });
fs.writeFileSync(path.join(ROOT, name), JSON.stringify(body, null, 2) + '\n');
console.log(`Checkpoint ${body.number}: ${body.records} records, root ${body.root.slice(0, 16)}…`);
console.log(`Written to ${name}`);
