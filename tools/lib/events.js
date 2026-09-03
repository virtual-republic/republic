// The register. Append-only, hash-chained, Merkle-checkpointed.
//
// Enforces, mechanically:
//   art-02/§8/¶1   every record identifies exactly one author
//   art-02/§9/¶1   a record, once committed, is not altered
//   art-02/§10/¶1  every record carries the hash of the record preceding it
//   art-02/§11/¶1  every act cites the provision under which it is made

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const LEDGER = 'ledger/events.jsonl';
export const GENESIS = Buffer.alloc(32, 0).toString('hex');

// Deterministic serialisation. Two implementations must agree byte for byte
// or the chain will not verify across clients.
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function hashEvent(prevHash, body) {
  return sha256(prevHash + canonical(body));
}

export function read(root) {
  const file = path.join(root, LEDGER);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(`ledger line ${i + 1} is not valid JSON: ${e.message}`);
      }
    });
}

const REQUIRED = ['at', 'author', 'kind', 'provision', 'payload'];

export function append(root, event) {
  for (const field of REQUIRED) {
    if (event[field] === undefined || event[field] === null || event[field] === '') {
      throw new Error(`record rejected: missing "${field}" (art-02/§8, art-02/§11)`);
    }
  }
  if (Array.isArray(event.author)) {
    throw new Error('record rejected: exactly one author required (art-02/§8/¶1)');
  }

  const events = read(root);
  const prev = events.length ? events[events.length - 1].hash : GENESIS;
  const body = {
    seq: events.length + 1,
    at: event.at,
    author: event.author,
    entity: event.entity,
    kind: event.kind,
    provision: event.provision,
    payload: event.payload,
    prev: prev,
  };
  const record = { ...body, hash: hashEvent(prev, body) };

  fs.mkdirSync(path.join(root, 'ledger'), { recursive: true });
  fs.appendFileSync(path.join(root, LEDGER), JSON.stringify(record) + '\n');
  return record;
}

// art-02/§9: verify nothing has been altered.
export function verifyChain(root) {
  const events = read(root);
  const problems = [];
  let prev = GENESIS;

  events.forEach((e, i) => {
    const { hash, ...body } = e;
    if (body.seq !== i + 1) problems.push({ seq: i + 1, error: `sequence is ${body.seq}` });
    if (body.prev !== prev) problems.push({ seq: body.seq, error: 'broken link to previous record' });
    const expected = hashEvent(prev, body);
    if (expected !== hash) problems.push({ seq: body.seq, error: 'hash does not match content' });
    prev = hash;
  });

  return { ok: problems.length === 0, count: events.length, head: prev, problems };
}

// --- Merkle checkpoints (art-02/§10/¶2) -----------------------------------

export function merkleRoot(leaves) {
  if (leaves.length === 0) return sha256('');
  let level = leaves.map((l) => sha256('\x00' + l));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = level[i + 1] ?? level[i];
      next.push(sha256('\x01' + a + b));
    }
    level = next;
  }
  return level[0];
}

export function merkleProof(leaves, index) {
  const proof = [];
  let level = leaves.map((l) => sha256('\x00' + l));
  let idx = index;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = level[i + 1] ?? level[i];
      if (i === idx || i + 1 === idx) {
        proof.push(idx === i ? { side: 'right', hash: b } : { side: 'left', hash: a });
        idx = next.length;
      }
      next.push(sha256('\x01' + a + b));
    }
    level = next;
  }
  return proof;
}

export function verifyProof(leaf, proof, root) {
  let h = sha256('\x00' + leaf);
  for (const step of proof) {
    h = step.side === 'right' ? sha256('\x01' + h + step.hash) : sha256('\x01' + step.hash + h);
  }
  return h === root;
}

export function checkpointList(root) {
  const dir = path.join(root, 'checkpoints');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}
