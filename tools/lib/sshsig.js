// SSHSIG (the format produced by `ssh-keygen -Y sign`) in pure Node.
//
// Why not shell out to ssh-keygen? Because art-05/§26/¶3 says verification
// must need no permission and no account — and in practice that also means it
// should need no unusual software. Anyone with node can check the Republic.
//
// Compatible both ways: signatures made here verify with `ssh-keygen -Y verify`,
// and signatures made by ssh-keygen verify here. Ed25519 only, deliberately.

import crypto from 'node:crypto';

const MAGIC = Buffer.from('SSHSIG');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

// --- SSH wire format ------------------------------------------------------

function str(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(b.length);
  return Buffer.concat([len, b]);
}

function reader(buf) {
  let off = 0;
  return {
    string() {
      const len = buf.readUInt32BE(off);
      off += 4;
      const out = buf.subarray(off, off + len);
      off += len;
      return out;
    },
    u32() {
      const v = buf.readUInt32BE(off);
      off += 4;
      return v;
    },
    skip(n) {
      off += n;
    },
    rest() {
      return buf.subarray(off);
    },
  };
}

// --- Public keys ----------------------------------------------------------

export function parsePublicKey(line) {
  const parts = String(line).trim().split(/\s+/);
  const idx = parts.findIndex((p) => p === 'ssh-ed25519');
  if (idx === -1) throw new Error('only ssh-ed25519 keys are accepted');
  const blob = Buffer.from(parts[idx + 1], 'base64');
  const r = reader(blob);
  const type = r.string().toString();
  if (type !== 'ssh-ed25519') throw new Error(`unexpected key type ${type}`);
  const raw = r.string();
  if (raw.length !== 32) throw new Error('malformed ed25519 key');
  return { blob, raw, keyObject: rawToKeyObject(raw) };
}

function rawToKeyObject(raw) {
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

export function publicKeyLine(raw, comment = '') {
  const blob = Buffer.concat([str('ssh-ed25519'), str(raw)]);
  return `ssh-ed25519 ${blob.toString('base64')}${comment ? ' ' + comment : ''}`;
}

// --- The blob that is actually signed --------------------------------------

function signedBlob(namespace, hashAlg, messageHash) {
  return Buffer.concat([
    MAGIC,
    str(namespace),
    str(''), // reserved
    str(hashAlg),
    str(messageHash),
  ]);
}

// --- Armour ---------------------------------------------------------------

function armour(buf) {
  const b64 = buf.toString('base64').replace(/(.{70})/g, '$1\n');
  return `-----BEGIN SSH SIGNATURE-----\n${b64}\n-----END SSH SIGNATURE-----\n`;
}

function dearmour(text) {
  const body = String(text)
    .replace(/-----BEGIN SSH SIGNATURE-----/, '')
    .replace(/-----END SSH SIGNATURE-----/, '')
    .replace(/\s+/g, '');
  return Buffer.from(body, 'base64');
}

// --- Sign / verify --------------------------------------------------------

export function sign(message, privateKeyPem, { namespace = 'republic', hashAlg = 'sha512' } = {}) {
  const key = crypto.createPrivateKey(privateKeyPem);
  const raw = crypto
    .createPublicKey(key)
    .export({ format: 'der', type: 'spki' })
    .subarray(ED25519_SPKI_PREFIX.length);

  const messageHash = crypto.createHash(hashAlg).update(message).digest();
  const toSign = signedBlob(namespace, hashAlg, messageHash);
  const rawSig = crypto.sign(null, toSign, key);

  const blob = Buffer.concat([
    MAGIC,
    (() => {
      const v = Buffer.alloc(4);
      v.writeUInt32BE(1);
      return v;
    })(),
    str(Buffer.concat([str('ssh-ed25519'), str(raw)])),
    str(namespace),
    str(''),
    str(hashAlg),
    str(Buffer.concat([str('ssh-ed25519'), str(rawSig)])),
  ]);
  return armour(blob);
}

export function parseSignature(armoured) {
  const buf = dearmour(armoured);
  if (!buf.subarray(0, 6).equals(MAGIC)) throw new Error('not an SSH signature');
  const r = reader(buf.subarray(6));
  const version = r.u32();
  if (version !== 1) throw new Error(`unsupported SSHSIG version ${version}`);
  const publickey = r.string();
  const namespace = r.string().toString();
  r.string(); // reserved
  const hashAlg = r.string().toString();
  const sigWrapper = r.string();

  const kr = reader(publickey);
  const keyType = kr.string().toString();
  const keyRaw = kr.string();

  const sr = reader(sigWrapper);
  const sigType = sr.string().toString();
  const signature = sr.string();

  return { keyType, keyRaw, namespace, hashAlg, sigType, signature };
}

// Returns { ok, signer } where signer is the matching key line, or { ok:false, error }.
export function verify(message, armoured, allowedKeyLines, { namespace = 'republic' } = {}) {
  let parsed;
  try {
    parsed = parseSignature(armoured);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (parsed.keyType !== 'ssh-ed25519' || parsed.sigType !== 'ssh-ed25519') {
    return { ok: false, error: 'only ed25519 signatures are accepted' };
  }
  if (parsed.namespace !== namespace) {
    return { ok: false, error: `signature namespace is "${parsed.namespace}", expected "${namespace}"` };
  }

  const match = allowedKeyLines.find((line) => {
    try {
      return parsePublicKey(line).raw.equals(parsed.keyRaw);
    } catch {
      return false;
    }
  });
  if (!match) return { ok: false, error: 'signing key is not on the register (art-02/§8/¶3)' };

  let hash;
  try {
    hash = crypto.createHash(parsed.hashAlg).update(message).digest();
  } catch {
    return { ok: false, error: `unsupported hash ${parsed.hashAlg}` };
  }

  const ok = crypto.verify(
    null,
    signedBlob(parsed.namespace, parsed.hashAlg, hash),
    rawToKeyObject(parsed.keyRaw),
    parsed.signature
  );
  return ok ? { ok: true, signer: match } : { ok: false, error: 'signature does not verify' };
}

// Convenience for citizens generating a key without ssh-keygen.
export function generateKeyPair(comment = '') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(ED25519_SPKI_PREFIX.length);
  return {
    publicKeyLine: publicKeyLine(raw, comment),
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  };
}
