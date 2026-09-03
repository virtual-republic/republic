// The registers.
//
// art-07/§37/¶2 requires that personal data be held apart from the register,
// and that the register refer to a person only by their pseudonymous
// identifier. That is why nothing in register/citizens/ contains a name, an
// email address, or anything else identifying. Erasure under art-07/§38
// deletes a row in a separate private store; the civic record survives under
// the identifier alone, and no record is altered.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

function loadDir(root, dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((f) => (f.endsWith('.yml') || f.endsWith('.yaml')) && !f.startsWith('_'))
    .sort()
    .map((f) => ({ file: f, ...yaml.load(fs.readFileSync(path.join(full, f), 'utf8')) }));
}

export function citizens(root) {
  return loadDir(root, 'register/citizens');
}

export function activeCitizens(root) {
  return citizens(root).filter((c) => c.status === 'active');
}

export function entities(root) {
  return loadDir(root, 'register/entities');
}

export function offices(root) {
  const file = path.join(root, 'register/offices.yml');
  if (!fs.existsSync(file)) return [];
  return yaml.load(fs.readFileSync(file, 'utf8')).offices || [];
}

// Every key on the register, for signature verification.
export function allowedKeys(root) {
  const out = [];
  for (const c of activeCitizens(root)) {
    for (const k of c.keys || []) out.push(`${k} ${c.id}`);
  }
  return out;
}

export function keysFor(root, citizenId) {
  const c = citizens(root).find((x) => x.id === citizenId);
  if (!c) return [];
  return (c.keys || []).map((k) => `${k} ${c.id}`);
}

export function citizenById(root, id) {
  return citizens(root).find((c) => c.id === id) || null;
}

// Personal data lives here and nowhere else. Not committed to the public
// repository — see .gitignore. Erasure is deletion from this file.
export function personalStore(root) {
  const file = path.join(root, 'private/persons.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function displayName(root, id) {
  const store = personalStore(root);
  return store[id]?.display || id;
}
