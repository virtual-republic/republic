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
  const body = b64(pkcs8).replace(/(.{64})/g, '$1\n').trim();
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
}

// A public key pasted where a private one belongs is the most common mistake,
// so name it rather than failing with "Invalid keyData".
export function looksLikePublicKey(text) {
  const t = String(text).trim();
  return t.startsWith('ssh-') || /^AAAAC3NzaC1lZDI1NTE5/.test(t.replace(/\s+/g, ''));
}

export async function importPrivateKey(pemOrB64) {
  const raw = String(pemOrB64).trim();
  if (!raw) throw new Error('nothing pasted');
  if (looksLikePublicKey(raw)) {
    throw new Error('that is your PUBLIC key — the one that goes on the register. The private key is the .pem file, and begins "-----BEGIN PRIVATE KEY-----".');
  }

  const body = raw.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  let pkcs8;
  try { pkcs8 = unb64(body); } catch { throw new Error('this is not base64 — paste the whole .pem file, headers included'); }
  if (pkcs8.length < 48) throw new Error('this key is too short to be an Ed25519 private key');

  let key;
  try {
    key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']);
  } catch {
    throw new Error('the browser could not read this as an Ed25519 private key. If it begins "-----BEGIN OPENSSH PRIVATE KEY-----" it is the wrong format — use a key made here, or convert it.');
  }

  // Recover the public half so the caller can say which citizenship this is.
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return { key, raw: unb64(jwk.x.replace(/-/g, '+').replace(/_/g, '/')) };
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
  const at = new Date().toISOString();
  const message = canonical({ proposal, choice, at, salt });
  const signature = await sign(message, privateKey, { namespace: 'republic' });
  return { ballot: { proposal, choice, at, salt, signature }, receipt: (await sha256(message)).slice(0, 16) };
}

// Count a measure in the browser, from the published ballots. Same arithmetic
// as tools/tally.js, so the running total a citizen sees is the real one.
export async function tally(measure, ballots, roll, spec, closes, early = {}) {
  const keys = new Map();
  for (const c of roll) for (const k of c.keys || []) keys.set(k.split(/\s+/)[1], c.id);

  const counted = new Map();
  const rejected = [];
  for (const [citizenId, b] of Object.entries(ballots)) {
    if (!roll.some((c) => c.id === citizenId && c.status === 'active')) { rejected.push({ citizenId, reason: 'not an active citizenship' }); continue; }
    if (b.proposal !== measure) { rejected.push({ citizenId, reason: 'wrong measure' }); continue; }
    if (closes && b.at && new Date(b.at) > new Date(closes)) { rejected.push({ citizenId, reason: 'cast after close' }); continue; }
    const held = counted.get(citizenId);
    if (!held || (b.at && held.at && new Date(b.at) > new Date(held.at))) counted.set(citizenId, b);
  }

  const t = { yes: 0, no: 0, abstain: 0 };
  for (const b of counted.values()) if (t[b.choice] !== undefined) t[b.choice]++;
  const cast = counted.size;
  const decisive = t.yes + t.no;
  const quorumNeeded = Math.ceil(spec.quorum * roll.filter((c) => c.status === 'active').length);
  const share = decisive ? t.yes / decisive : 0;
  const byCalendar = closes ? new Date() < new Date(closes) : true;

  // art-08/§43/¶5–¶6 — voting closes once waiting cannot change anything.
  const N = roll.filter((c) => c.status === 'active').length;
  const remaining = N - cast;
  let closedEarly = null;
  if (early.enabled && N && cast / N >= (early.minimum_participation ?? 1)) {
    if (early.on_full_participation && remaining <= 0) {
      closedEarly = 'every citizenship has voted';
    } else if (early.on_determined_outcome) {
      const carries = (y, n) => (cast + remaining) >= quorumNeeded && (y + n) > 0 && y / (y + n) >= spec.threshold;
      if (cast + remaining < quorumNeeded) closedEarly = 'quorum can no longer be reached';
      else {
        const best = carries(t.yes + remaining, t.no), worst = carries(t.yes, t.no + remaining);
        if (best === worst) closedEarly = best ? 'carries however the remaining ballots are cast' : 'fails however the remaining ballots are cast';
      }
    }
  }

  const open = byCalendar && !closedEarly;
  return {
    ...t, cast, electorate: N, remaining, quorumNeeded, quorumMet: cast >= quorumNeeded,
    share, threshold: spec.threshold, thresholdMet: share >= spec.threshold,
    open, closedEarly,
    carried: cast >= quorumNeeded && share >= spec.threshold && !open,
    rejected,
  };
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
