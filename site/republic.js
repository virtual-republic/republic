// The Republic, in the browser.
//
// Everything here runs client-side with no server and no dependencies. Keys are
// generated with Web Crypto (Ed25519 is available in every major engine since
// Chrome 137, Firefox 129 and Safari 17) and never leave the device.
//
// Signatures are SSHSIG, byte-identical to what tools/sign.js and
// `ssh-keygen -Y sign` produce, so tools/tally.js verifies them unchanged.

const enc = new TextEncoder();
const SSHSIG = enc.encode('SSHSIG');

// ---- bytes ---------------------------------------------------------------

const cat = (...arrays) => {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  return out;
};

const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const str = (b) => { const x = typeof b === 'string' ? enc.encode(b) : b; return cat(u32(x.length), x); };
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

// ---- canonical JSON — must match tools/lib/events.js byte for byte --------

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

export async function sha256(input) {
  const data = typeof input === 'string' ? enc.encode(input) : input;
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

async function sha512Bytes(input) {
  const data = typeof input === 'string' ? enc.encode(input) : input;
  return new Uint8Array(await crypto.subtle.digest('SHA-512', data));
}

// ---- keys ----------------------------------------------------------------

const SPKI_PREFIX = unb64('MCowBQYDK2VwAyEA');   // 302a300506032b6570032100
const PKCS8_PREFIX = unb64('MC4CAQAwBQYDK2VwBCIEIA=='); // 302e020100300506032b657004220420

export function supported() {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

export async function generateKey(comment = 'citizen') {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const raw = spki.slice(SPKI_PREFIX.length);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return {
    publicKeyLine: publicKeyLine(raw, comment),
    privateKeyPem: pem(pkcs8),
    privateKeyB64: b64(pkcs8),
  };
}

export function publicKeyLine(raw, comment = '') {
  const blob = cat(str('ssh-ed25519'), str(raw));
  return `ssh-ed25519 ${b64(blob)}${comment ? ' ' + comment : ''}`;
}

function pem(pkcs8) {
  const body = b64(pkcs8).replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
}

export async function importPrivateKey(pemOrB64) {
  const body = String(pemOrB64)
    .replace(/-----[A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const pkcs8 = unb64(body);
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']);
  // Recover the public half so the caller can show which citizenship this is.
  const raw = pkcs8.slice(PKCS8_PREFIX.length, PKCS8_PREFIX.length + 32);
  const pub = await crypto.subtle.importKey('raw', await derivePublic(key, raw), { name: 'Ed25519' }, true, ['verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pub));
  return { key, raw: spki.slice(SPKI_PREFIX.length) };
}

// Web Crypto gives no direct scalar->point op, so round-trip through a
// signature-verifying import: export the private key's public counterpart by
// re-importing the seed as a JWK.
async function derivePublic(_key, seed) {
  const jwk = { kty: 'OKP', crv: 'Ed25519', d: b64url(seed), x: '' };
  // Browsers require x; derive it by generating from the seed via PKCS8 import
  // and exporting SPKI, which is what importKey already did above. Fall back to
  // asking the browser directly.
  try {
    const priv = await crypto.subtle.importKey(
      'pkcs8', cat(PKCS8_PREFIX, seed), { name: 'Ed25519' }, true, ['sign']
    );
    const jwkOut = await crypto.subtle.exportKey('jwk', priv);
    return unb64(jwkOut.x.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    delete jwk.x;
    throw new Error('could not derive the public key from this private key');
  }
}

const b64url = (b) => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---- SSHSIG --------------------------------------------------------------

export async function sign(message, privateKey, { namespace = 'republic' } = {}) {
  const key = privateKey.key || privateKey;
  const raw = privateKey.raw;
  const hash = await sha512Bytes(message);

  const toSign = cat(SSHSIG, str(namespace), str(''), str('sha512'), str(hash));
  const rawSig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, toSign));

  const blob = cat(
    SSHSIG,
    u32(1),
    str(cat(str('ssh-ed25519'), str(raw))),
    str(namespace),
    str(''),
    str('sha512'),
    str(cat(str('ssh-ed25519'), str(rawSig)))
  );
  const body = b64(blob).replace(/(.{70})/g, '$1\n');
  return `-----BEGIN SSH SIGNATURE-----\n${body}\n-----END SSH SIGNATURE-----\n`;
}

// ---- ballots -------------------------------------------------------------

export async function makeBallot(proposal, choice, privateKey) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const message = canonical({ proposal, choice, salt });
  const signature = await sign(message, privateKey, { namespace: 'republic' });
  return { ballot: { proposal, choice, salt, signature }, receipt: (await sha256(message)).slice(0, 16) };
}

// ---- verifying the register in the page (art-05/§26) ---------------------

const GENESIS = '0'.repeat(64);

export async function verifyRegister(eventsText) {
  const events = eventsText.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const problems = [];
  let prev = GENESIS;

  for (const [i, e] of events.entries()) {
    const { hash, ...body } = e;
    if (body.seq !== i + 1) problems.push({ seq: i + 1, error: `sequence is ${body.seq}` });
    if (body.prev !== prev) problems.push({ seq: body.seq, error: 'broken link to previous record' });
    const expected = await sha256(prev + canonical(body));
    if (expected !== hash) problems.push({ seq: body.seq, error: 'hash does not match content' });
    prev = hash;
  }
  return { ok: problems.length === 0, count: events.length, head: prev, problems, events };
}

export async function merkleRoot(leaves) {
  if (!leaves.length) return sha256('');
  let level = [];
  for (const l of leaves) level.push(await sha256('\x00' + l));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(await sha256('\x01' + level[i] + (level[i + 1] ?? level[i])));
    }
    level = next;
  }
  return level[0];
}

// ---- handing off to GitHub (no backend) ----------------------------------

export function commitUrl(repo, branch, filename, contents, message) {
  const base = `https://github.com/${repo}/new/${branch}`;
  const q = new URLSearchParams({ filename, value: contents });
  if (message) q.set('message', message);
  return `${base}?${q}`;
}

// ---- key held in the browser ---------------------------------------------

const STORE = 'republic.key';

export const vault = {
  save(id, privateKeyB64) {
    try { localStorage.setItem(STORE, JSON.stringify({ id, key: privateKeyB64 })); } catch {}
  },
  load() {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; }
  },
  clear() {
    try { localStorage.removeItem(STORE); } catch {}
  },
};
