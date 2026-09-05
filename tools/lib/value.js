// Balances, holdings, and the signed instruments that move them.
//
//   art-02/§12/¶1  value is created only by the issuing organ
//   art-02/§12/¶2  a transfer neither creates nor destroys value
//   art-02/§12/¶3  no account may be debited except by its holder, by an
//                  assessment made under statute, or by an order of the Court
//   art-09/§50/¶2  a transfer is a record and takes effect when recorded
//
// Nothing here writes to the ledger. Signed instruments are files; tools/settle.js
// verifies them and appends the records. That split is what lets the whole system
// work through a browser and a commit link, with no server anywhere.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { read, canonical } from './events.js';
import { verify } from './sshsig.js';
import { citizens, activeCitizens, entities, offices, keysFor } from './registers.js';
import { params } from './params.js';

export const TREASURY = 'treasury';

// ---- the state of value, folded from the register ---------------------------

export function ledgerState(root) {
  const balances = new Map();          // account -> obols
  const holdings = new Map();          // account -> Map(instrument -> qty)
  const instruments = new Map();       // instrument -> { issuer, issued }
  let issued = 0;

  const move = (who, delta) => balances.set(who, (balances.get(who) || 0) + delta);
  const moveShares = (who, inst, delta) => {
    if (!holdings.has(who)) holdings.set(who, new Map());
    const h = holdings.get(who);
    h.set(inst, (h.get(inst) || 0) + delta);
  };

  for (const e of read(root)) {
    const p = e.payload || {};
    switch (e.kind) {
      case 'value.issued':
        issued += p.amount; move(p.to, p.amount); break;
      case 'value.transferred':
        move(p.from, -p.amount); move(p.to, p.amount); break;
      case 'instrument.issued':
        instruments.set(p.instrument, { issuer: p.issuer, issued: p.quantity, class: p.class });
        moveShares(p.to, p.instrument, p.quantity); break;
      case 'instrument.transferred':
        moveShares(p.from, p.instrument, -p.quantity); moveShares(p.to, p.instrument, p.quantity); break;
      case 'order.matched':
        moveShares(p.seller, p.instrument, -p.quantity); moveShares(p.buyer, p.instrument, p.quantity);
        move(p.buyer, -p.quantity * p.price); move(p.seller, p.quantity * p.price); break;
    }
  }
  return { balances, holdings, instruments, issued };
}

export function balanceOf(root, account) {
  return ledgerState(root).balances.get(account) || 0;
}

// ---- who may hold an account ------------------------------------------------

export function accounts(root) {
  const out = new Map();
  for (const c of activeCitizens(root)) out.set(c.id, { kind: 'citizen' });
  const types = params(root).entities.types;
  for (const e of entities(root)) {
    if (e.status !== 'active') continue;
    if (types[e.type]?.may_hold_account) out.set(e.id, { kind: 'entity', type: e.type, organs: e.organs || [] });
  }
  out.set(TREASURY, { kind: 'treasury' });
  return out;
}

// A citizen acts for an entity through an organ of it — art-04/§21/¶2.
export function mayActFor(root, citizenId, account) {
  if (citizenId === account) return true;
  // art-09/§53/¶3 — nothing leaves the Treasury except under an appropriation,
  // and the officer holding treasury.disburse is who executes it.
  if (account === TREASURY) {
    return offices(root).some((o) => o.holder === citizenId && (o.permissions || []).includes('treasury.disburse'));
  }
  const e = entities(root).find((x) => x.id === account);
  if (!e) return false;
  return (e.organs || []).some((o) => (o.held_by || []).includes(citizenId));
}

// ---- signed instruments -----------------------------------------------------

export function loadPending(root, dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .sort()
    .map((f) => ({ file: f, path: path.join(full, f), ...JSON.parse(fs.readFileSync(path.join(full, f), 'utf8')) }));
}

// The signed message is the instrument minus its signature, canonically ordered.
export function signedBody(o) {
  const { signature, file, path: _p, ...body } = o;
  return canonical(body);
}

export function checkSignature(root, instrument, signerId) {
  const keys = keysFor(root, signerId);
  if (!keys.length) return { ok: false, error: `${signerId} has no key on the register` };
  return verify(signedBody(instrument), instrument.signature || '', keys, { namespace: 'republic' });
}

// ---- contracts ---------------------------------------------------------------

export function contracts(root) {
  const dir = path.join(root, 'contracts');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.md')) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const end = src.indexOf('\n---', 3);
    const meta = yaml.load(src.slice(4, end)) || {};
    const sigDir = path.join(dir, meta.id || path.basename(f, '.md'));
    const signatures = fs.existsSync(sigDir)
      ? fs.readdirSync(sigDir).filter((x) => x.endsWith('.json'))
          .map((x) => ({ by: path.basename(x, '.json'), ...JSON.parse(fs.readFileSync(path.join(sigDir, x), 'utf8')) }))
      : [];
    out.push({ ...meta, file: `contracts/${f}`, body: src.slice(end + 4).trim(), signatures });
  }
  return out;
}

export function contractComplete(root, c) {
  const need = [].concat(c.parties || []);
  const have = new Set(c.signatures.map((s) => s.by));
  return need.length > 0 && need.every((p) => have.has(p));
}
