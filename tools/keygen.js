#!/usr/bin/env node
// Generates a citizen's key without requiring ssh-keygen.
import fs from 'node:fs';
import { generateKeyPair } from './lib/sshsig.js';
const comment = process.argv[2] || 'citizen';
const kp = generateKeyPair(comment);
fs.mkdirSync('private', { recursive: true });
const out = `private/${comment.replace(/[^a-z0-9._-]/gi, '_')}.pem`;
fs.writeFileSync(out, kp.privateKeyPem, { mode: 0o600 });
console.log(`Private key written to ${out} — keep it, never commit it.`);
console.log(`\nYour public key, for register/citizens/<id>.yml:\n\n${kp.publicKeyLine}\n`);
