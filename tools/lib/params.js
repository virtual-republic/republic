// The parameter registry (parameters.yml). No tool may hardcode a value that
// appears here — that is the whole point of the file.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

let cache = null;

export function params(root = process.cwd()) {
  if (cache) return cache;
  const file = path.join(root, 'parameters.yml');
  if (!fs.existsSync(file)) throw new Error('parameters.yml is missing — the Republic has no settings');
  cache = yaml.load(fs.readFileSync(file, 'utf8'));
  return cache;
}

export function classes(root) { return params(root).governance.classes; }
export function classSpec(root, name) {
  const c = classes(root)[name];
  if (!c) throw new Error(`unknown class "${name}" — expected one of: ${Object.keys(classes(root)).join(', ')}`);
  return c;
}
export function ballotRules(root) { return params(root).ballot; }
