// Finding the key a tool needs to sign with.
//
// A key downloaded from the website lands in Downloads as citizenship.pem. The
// tools look for private/<citizen>.pem. That gap produced a raw ENOENT stack
// trace, which tells nobody anything.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { publicKeyLine } from './sshsig.js';
import { citizens } from './registers.js';

const SPKI = Buffer.from('302a300506032b6570032100', 'hex');

export function keyPathFor(root, citizenId) {
  return path.join(root, 'private', `${citizenId}.pem`);
}

export function readKey(root, citizenId) {
  const file = keyPathFor(root, citizenId);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');

  const dir = path.join(root, 'private');
  const have = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.pem')) : [];

  const lines = [
    `No key for ${citizenId} at private/${citizenId}.pem.`,
    '',
    have.length ? `private/ holds: ${have.join(', ')}` : 'private/ is empty or missing.',
    '',
    'If you made your key on the website, it downloaded under whatever name your',
    'browser gave it. Find and install it:',
    '  node tools/key.js find',
    '  node tools/key.js import',
    '',
    'If you have no key yet:',
    `  node tools/keygen.js ${citizenId}`,
  ];
  const err = new Error(lines.join('\n'));
  err.friendly = true;
  throw err;
}

// Which citizenship does this key belong to? Answered from the register, so a
// file named anything at all lands in the right place.
export function identify(root, pem) {
  const priv = crypto.createPrivateKey(normalise(pem));
  const raw = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(SPKI.length);
  const mine = publicKeyLine(raw, '').split(/\s+/)[1];
  const c = citizens(root).find((x) => (x.keys || []).some((k) => k.split(/\s+/)[1] === mine));
  return { raw, citizen: c ? c.id : null, publicKeyLine: publicKeyLine(raw, c ? c.id : '') };
}

// Any PEM, however it was saved — blank lines, stray whitespace, no trailing newline.
export function normalise(pem) {
  const body = String(pem).replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  return `-----BEGIN PRIVATE KEY-----\n${body.replace(/(.{64})/g, '$1\n').trim()}\n-----END PRIVATE KEY-----\n`;
}

// Wrap a tool's main so a friendly error prints as guidance, not a stack trace.
export function guard(fn) {
  try { fn(); }
  catch (e) {
    if (e && e.friendly) { console.error(e.message); process.exit(2); }
    throw e;
  }
}
