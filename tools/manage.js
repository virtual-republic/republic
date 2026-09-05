#!/usr/bin/env node
// Acts on an entity, signed by one of its organs.
//
//   node tools/manage.js members --entity e-0001 --admit c-0007 --by c-0006
//   node tools/manage.js organs  --entity e-0001 --set director=c-0006,secretary=c-0007 --by c-0006
//   node tools/manage.js charter --entity e-0001 --file charters/e-0001.md --by c-0006
//   node tools/manage.js dissolve --entity e-0001 --by c-0006

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonical } from './lib/events.js';
import { sign } from './lib/sshsig.js';
import { readKey } from './lib/key.js';
import { mayActFor } from './lib/value.js';
import { entities, citizens } from './lib/registers.js';
import { defaultCharter } from './lib/charter.js';

const ROOT = process.cwd();
const cmd = process.argv[2];
const a = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };

const entity = a('entity'), by = a('by');
if (!cmd || !entity || !by) {
  console.error('usage: node tools/manage.js <members|organs|charter|dissolve> --entity <e-0001> --by <citizen> ...');
  process.exit(2);
}
const e = entities(ROOT).find((x) => x.id === entity);
if (!e) { console.error(`No entity ${entity}.`); process.exit(1); }
if (!mayActFor(ROOT, by, entity)) { console.error(`${by} is not an organ of ${entity} (art-04/§21/¶2).`); process.exit(1); }

let body = { entity, by, at: new Date().toISOString(), salt: crypto.randomBytes(8).toString('hex') };

if (cmd === 'members') {
  const admit = (a('admit') || '').split(',').filter(Boolean);
  const remove = (a('remove') || '').split(',').filter(Boolean);
  const roll = citizens(ROOT).map((c) => c.id);
  for (const m of [...admit, ...remove]) if (!roll.includes(m)) { console.error(`${m} is not on the register.`); process.exit(1); }
  if (admit.length) body = { ...body, kind: 'member.admit', members: admit };
  else if (remove.length) body = { ...body, kind: 'member.remove', members: remove };
  else { console.error('give --admit or --remove'); process.exit(2); }
} else if (cmd === 'organs') {
  const spec = a('set');
  if (!spec) { console.error('give --set role=citizen,role=citizen'); process.exit(2); }
  body = { ...body, kind: 'organ.set', organs: spec.split(',').map((x) => {
    const [name, holders] = x.split('=');
    return { name: name.trim(), held_by: (holders || '').split('/').map((h) => h.trim()).filter(Boolean) };
  }) };
} else if (cmd === 'charter') {
  const file = a('file', e.charter || `charters/${entity}.md`);
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    // art-04/§21/¶1 — every entity has a charter. An entity formed on the
    // website has none yet, because one commit link creates one file.
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, defaultCharter({
      id: entity, type: e.type, name: e.name || e.name_en || entity,
      organs: e.organs || [], today: new Date().toISOString().slice(0, 10),
    }));
    console.log(`${entity} had no charter — art-04/§21/¶1 says it must have one.`);
    console.log(`Written a default to:\n  ${full}`);
    console.log('');
    console.log('It exists only on this machine until you commit it:');
    console.log(`  git add ${file} && git commit -m "charter of ${entity}" && git push`);
    console.log('');
    console.log('Edit the text first if you want to. Then, to amend it later:');
    console.log(`  node tools/manage.js charter --entity ${entity} --by ${by}`);
    console.log(`  node tools/settle.js`);
    process.exit(0);
  }
  body = { ...body, kind: 'charter.amend', text: fs.readFileSync(full, 'utf8') };
} else if (cmd === 'dissolve') {
  body = { ...body, kind: 'entity.dissolve' };
} else { console.error(`unknown command "${cmd}"`); process.exit(2); }

let material;
try { material = readKey(ROOT, by); } catch (err) { console.error(err.message); process.exit(2); }
body.signature = sign(canonical(body), material, { namespace: 'republic' });

fs.mkdirSync(path.join(ROOT, 'entity-acts'), { recursive: true });
const name = `${body.at.replace(/[:.]/g, '-')}-${entity}-${body.kind.replace('.', '-')}`;
fs.writeFileSync(path.join(ROOT, `entity-acts/${name}.json`), JSON.stringify(body, null, 2) + '\n');
console.log(`Signed ${body.kind} for ${entity} — entity-acts/${name}.json`);
console.log('Settle it: node tools/settle.js');
