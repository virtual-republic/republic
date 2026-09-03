#!/usr/bin/env node
// Tests the invariants of Article 2. Each test names the provision it checks.
// If one of these fails, the Republic is not doing what its Constitution says.

import fs from 'node:fs';
import { canonical, hashEvent, merkleRoot, merkleProof, verifyProof, read, verifyChain, GENESIS } from './lib/events.js';
import { generateKeyPair, sign, verify, parsePublicKey, publicKeyLine } from './lib/sshsig.js';
import { loadConstitution, provisionIndex, normaliseCitation } from './lib/constitution.js';
import { activeCitizens } from './lib/registers.js';

const ROOT = process.cwd();
let pass = 0, fail = 0;

function t(provision, name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${provision.padEnd(16)} ${name}`);
    pass++;
  } catch (e) {
    console.log(`  \u2717 ${provision.padEnd(16)} ${name}\n      ${e.message}`);
    fail++;
  }
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

console.log('\nInvariants\n');

t('art-02/§8/¶1', 'a record identifies exactly one author', () => {
  const events = read(ROOT);
  for (const e of events) {
    assert(typeof e.author === 'string' && e.author.length > 0, `record ${e.seq} has no author`);
    assert(!Array.isArray(e.author), `record ${e.seq} has several authors`);
  }
});

t('art-02/§8/¶3', 'a record from an unregistered key is not received', () => {
  const stranger = generateKeyPair('stranger');
  const citizen = generateKeyPair('citizen');
  const sig = sign('anything', stranger.privateKeyPem);
  const r = verify('anything', sig, [citizen.publicKeyLine]);
  assert(r.ok === false, 'a stranger\u2019s signature was accepted');
});

t('art-02/§9/¶1', 'altering any record breaks the chain', () => {
  const events = read(ROOT);
  assert(events.length > 2, 'need records to test with');
  const i = 1;
  const { hash, ...body } = events[i];
  const tampered = { ...body, payload: { ...body.payload, tampered: true } };
  assert(hashEvent(body.prev, tampered) !== hash, 'tampering did not change the hash');
});

t('art-02/§10/¶1', 'every record carries the hash of the one before it', () => {
  const chain = verifyChain(ROOT);
  assert(chain.ok, chain.problems.map((p) => `record ${p.seq}: ${p.error}`).join('; '));
  const events = read(ROOT);
  assert(events.length === 0 || events[0].prev === GENESIS, 'first record does not link to genesis');
});

t('art-02/§10/¶3', 'inclusion is provable without permission', () => {
  const leaves = read(ROOT).map((e) => e.hash);
  assert(leaves.length > 0, 'no records');
  const root = merkleRoot(leaves);
  for (const i of [0, Math.floor(leaves.length / 2), leaves.length - 1]) {
    assert(verifyProof(leaves[i], merkleProof(leaves, i), root), `proof failed for leaf ${i}`);
  }
  assert(!verifyProof('0'.repeat(64), merkleProof(leaves, 0), root), 'a false leaf proved inclusion');
});

t('art-02/§11/¶1', 'every record cites a provision that resolves', () => {
  const index = provisionIndex(loadConstitution(ROOT));
  for (const e of read(ROOT)) {
    const id = normaliseCitation(e.provision);
    assert(index.has(id), `record ${e.seq} cites "${e.provision}", which does not resolve`);
  }
});

t('art-02/§12/¶2', 'transfers neither create nor destroy value', () => {
  const balances = new Map();
  const move = (who, delta) => balances.set(who, (balances.get(who) || 0) + delta);
  let issued = 0;
  for (const e of read(ROOT)) {
    if (e.kind === 'value.issued') { issued += e.payload.amount; move(e.payload.to, e.payload.amount); }
    if (e.kind === 'value.transferred') { move(e.payload.from, -e.payload.amount); move(e.payload.to, e.payload.amount); }
  }
  const total = [...balances.values()].reduce((a, b) => a + b, 0);
  assert(total === issued, `total holdings ${total} \u2260 total issued ${issued}`);
});

t('art-02/§13/¶1', 'no person holds more than one citizenship', () => {
  const seen = new Set();
  for (const c of activeCitizens(ROOT)) {
    assert(!seen.has(c.id), `duplicate citizen ${c.id}`);
    seen.add(c.id);
    for (const k of c.keys || []) {
      const raw = parsePublicKey(k).raw.toString('hex');
      assert(!seen.has(raw), `key reused across citizens: ${c.id}`);
      seen.add(raw);
    }
  }
});

console.log('\nEquality of language versions\n');

t('art-01/§6/¶2', 'both authentic versions number provisions identically', () => {
  const c = loadConstitution(ROOT);
  for (const art of c.articles) {
    const langs = Object.keys(art.versions);
    if (langs.length < 2) continue;
    const shape = (l) => art.versions[l].sections.map((s) => `${s.num}:${s.paragraphs.map((p) => p.num).join(',')}`).join('|');
    const first = shape(langs[0]);
    for (const l of langs.slice(1)) {
      assert(shape(l) === first, `${art.id}: ${langs[0]} and ${l} do not number alike`);
    }
  }
});

console.log('\nSignatures\n');

t('art-08/§43/¶2', 'a ballot verifies only against its own key and message', () => {
  const kp = generateKeyPair('voter');
  const message = canonical({ proposal: 'P-0001', choice: 'yes', salt: 'abc' });
  const sig = sign(message, kp.privateKeyPem, { namespace: 'republic' });
  assert(verify(message, sig, [kp.publicKeyLine], { namespace: 'republic' }).ok, 'valid ballot rejected');
  const altered = canonical({ proposal: 'P-0001', choice: 'no', salt: 'abc' });
  assert(!verify(altered, sig, [kp.publicKeyLine], { namespace: 'republic' }).ok, 'a changed choice still verified');
  assert(!verify(message, sig, [kp.publicKeyLine], { namespace: 'republic-checkpoint' }).ok, 'namespace was not enforced');
});

t('art-05/§26/¶1', 'the key format round-trips', () => {
  const kp = generateKeyPair('x');
  const parsed = parsePublicKey(kp.publicKeyLine);
  assert(publicKeyLine(parsed.raw, 'x') === kp.publicKeyLine, 'public key did not round-trip');
});

console.log('\nDeterminism\n');

t('art-08/§44/¶3', 'canonical serialisation is order-independent', () => {
  const a = canonical({ b: 1, a: [3, { z: 1, y: 2 }] });
  const b = canonical({ a: [3, { y: 2, z: 1 }], b: 1 });
  assert(a === b, `"${a}" \u2260 "${b}"`);
});

t('art-07/§37/¶2', 'the public register contains no personal data', () => {
  const forbidden = /(@|\b(?:name|email|address|phone|dob|birth)\s*:)/i;
  for (const c of activeCitizens(ROOT)) {
    const raw = fs.readFileSync(`register/citizens/${c.file}`, 'utf8');
    const withoutKeys = raw.replace(/ssh-ed25519 \S+( \S+)?/g, '');
    assert(!forbidden.test(withoutKeys), `${c.file} appears to contain personal data`);
  }
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
