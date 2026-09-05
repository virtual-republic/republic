#!/usr/bin/env node
// Every feature, end to end, from nothing.
//
// Builds a whole Republic in a scratch directory and exercises each capability
// in turn: founding, admission, measures, statute, amendment, elections,
// offices, entities, charters, value, shares, the exchange, contracts, the
// Court, the gate, and the site build. Each step asserts its own result.
//
//   node tools/selftest.js          run it
//   node tools/selftest.js --keep   leave the scratch republic for inspection

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const SRC = process.cwd();
const KEEP = process.argv.includes('--keep');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'republic-selftest-'));

let pass = 0, fail = 0;
const failures = [];

const run = (cmd, args, opts = {}) => {
  try { return { ok: true, out: execFileSync(cmd, args, { cwd: DIR, encoding: 'utf8', stdio: 'pipe', ...opts }) }; }
  catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || ''), code: e.status }; }
};
const node = (...args) => run('node', args);

function check(name, fn) {
  try {
    const why = fn();
    if (why === true || why === undefined) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}\n      ${why}`); fail++; failures.push(name); }
  } catch (e) {
    console.log(`  ✗ ${name}\n      ${e.message.split('\n').slice(0, 3).join('\n      ')}`);
    fail++; failures.push(name);
  }
}
const has = (f) => fs.existsSync(path.join(DIR, f));
const readf = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const write = (f, t) => { fs.mkdirSync(path.dirname(path.join(DIR, f)), { recursive: true }); fs.writeFileSync(path.join(DIR, f), t); };

// ---- set up a fresh republic from this repository's code ---------------------

for (const d of ['tools', 'site', 'journal/constitution', '.github', 'node_modules']) {
  if (fs.existsSync(path.join(SRC, d))) fs.cpSync(path.join(SRC, d), path.join(DIR, d), { recursive: true });
}
for (const f of ['parameters.yml', 'package.json']) fs.cpSync(path.join(SRC, f), path.join(DIR, f));


console.log(`\nScratch republic: ${DIR}\n`);
console.log('Founding\n');

check('found a republic with a generated key', () => {
  const r = node('tools/found.js', '--id', 'c-0001', '--generate', '--name', 'Tester');
  return r.ok || r.out;
});
check('the register names one citizen', () => has('register/citizens/c-0001.yml') || 'no c-0001.yml');
check('every office of art-06/§28 exists', () => {
  node('tools/migrate.js');
  const y = readf('register/offices.yml');
  const missing = ['registrar', 'keeper', 'treasurer', 'auditor', 'judge'].filter((o) => !y.includes(`id: ${o}`));
  return missing.length ? `missing: ${missing.join(', ')}` : true;
});
check('offices are held by the founder', () => {
  node('tools/office.js', 'vacant', '--fill', 'c-0001');
  const y = readf('register/offices.yml');
  return (y.match(/holder: c-0001/g) || []).length >= 5 || 'not all offices held';
});
check('the register verifies', () => node('tools/verify.js').out.includes('verifies') || 'does not verify');
check('the invariants hold', () => node('tools/test.js').out.includes('0 failed') || 'a test failed');

console.log('\nCitizenship\n');

check('a second citizenship may be created and admitted', () => {
  node('tools/keygen.js', 'c-0002');
  const r = node('tools/join.js', 'private/c-0002.pem', 'c-0002');
  return r.ok || r.out;
});
check('key.js identifies a key by content', () => {
  fs.copyFileSync(path.join(DIR, 'private/c-0002.pem'), path.join(DIR, 'anything.pem'));
  const r = node('tools/key.js', 'import', 'anything.pem');
  return r.out.includes('c-0002') || r.out;
});
check('a citizenship may depart', () => {
  const r = node('tools/depart.js', 'c-0002');
  return readf('register/citizens/c-0002.yml').includes('departed') || r.out;
});
check('a departed citizenship is not counted', () => {
  const r = node('tools/value.js', '--accounts');
  return !r.out.includes('c-0002') || 'still counted';
});

console.log('\nMeasures and law\n');

write('proposals/P-0001-meetings.md', `---
id: P-0001
title: Statute on Meetings
sponsor: c-0001
class: policy
cites: [art-01/§4/¶3]
opened: 2026-01-01
closes: 2099-01-01
---

## § 1  Calling

¹ The Assembly meets when a citizen calls it.
`);

check('a measure is received', () => node('tools/validate.js', 'proposals/P-0001-meetings.md').out.includes('Received') || 'not received');
check('a measure citing nothing resolvable is refused', () => {
  write('proposals/P-9998-bad.md', `---\nid: P-9998\ntitle: Bad\nsponsor: c-0001\nclass: policy\ncites: [art-99/§400]\nopened: 2026-01-01\n---\n\n## § 1\n\n¹ x\n`);
  const r = node('tools/validate.js', 'proposals/P-9998-bad.md');
  fs.rmSync(path.join(DIR, 'proposals/P-9998-bad.md'));
  return !r.ok || 'accepted an unresolvable citation';
});
check('a ballot may be signed', () => node('tools/sign.js', 'P-0001', 'yes', 'c-0001').ok || 'could not sign');
check('a measure closes early on full participation', () => {
  const r = node('tools/tally.js', 'P-0001');
  return r.out.includes('closed early') && r.out.includes('CARRIED') || r.out;
});
check('a carried measure enacts', () => {
  const r = node('tools/enact.js', 'P-0001');
  return r.out.includes('Enacted') || r.out;
});
check('the statute is written as law in force', () => has('journal/statutes/statute-on-meetings.md') || 'no statute');
check('the Journal records the act without copying the text', () => {
  const issues = fs.readdirSync(path.join(DIR, 'journal/issues/2026'));
  const j = readf(`journal/issues/2026/${issues.find((f) => f.includes('p-0001'))}`);
  return !j.includes('Assembly meets when') || 'the Journal duplicates the statute';
});
check('a statute may be amended, and the version rises', () => {
  write('proposals/P-0002-amend.md', `---
id: P-0002
title: Statute on Meetings
sponsor: c-0001
class: policy
amends_statute: statute-on-meetings
cites: [art-01/§4/¶3]
opened: 2026-01-01
closes: 2099-01-01
---

## § 1  Calling

¹ The Assembly meets when any citizen calls it, on three days' notice.
`);
  node('tools/sign.js', 'P-0002', 'yes', 'c-0001');
  node('tools/tally.js', 'P-0002');
  node('tools/enact.js', 'P-0002');
  const st = readf('journal/statutes/statute-on-meetings.md');
  return st.includes('version: 2') || 'version did not rise';
});
check('the superseded text is kept', () => has('journal/statutes/superseded/statute-on-meetings.v1.md') || 'not kept');

console.log('\nElections and office\n');

check('a citizen may stand for office', () => {
  const r = node('tools/stand.js', '--office', 'treasurer', '--by', 'c-0001');
  return r.out.includes('Opened') || r.out;
});
check('a ranked ballot is counted and the winner elected', () => {
  const id = fs.readdirSync(path.join(DIR, 'proposals')).find((f) => f.includes('election'))?.match(/P-\d{4}/)?.[0];
  if (!id) return 'no election measure';
  node('tools/sign.js', id, 'c-0001', 'c-0001');
  const r = node('tools/tally.js', id);
  return r.out.includes('ELECTED c-0001') && r.out.includes('CARRIED') || r.out;
});
check('enacting an election installs the winner', () => {
  const id = fs.readdirSync(path.join(DIR, 'proposals')).find((f) => f.includes('election'))?.match(/P-\d{4}/)?.[0];
  const r = node('tools/enact.js', id);
  return r.out.includes('takes treasurer') || r.out;
});
check('office.js reports nothing outstanding', () => node('tools/office.js', 'pending').out.includes('has taken effect') || 'still outstanding');

console.log('\nEntities\n');

check('a citizen forms a company as of right', () => node('tools/entity.js', '--name', 'Test Company', '--type', 'company', '--by', 'c-0001', '--organ', 'director=c-0001').ok || 'could not form');
check('a commune is refused without a carried measure', () => !node('tools/entity.js', '--name', 'X', '--type', 'commune', '--by', 'c-0001').ok || 'a commune was formed without law');
check('a charter is created when missing', () => {
  fs.rmSync(path.join(DIR, 'charters/e-0001.md'), { force: true });
  node('tools/manage.js', 'charter', '--entity', 'e-0001', '--by', 'c-0001');
  return has('charters/e-0001.md') || 'no charter written';
});
check('members and organs may be changed', () => {
  node('tools/keygen.js', 'c-0003'); node('tools/join.js', 'private/c-0003.pem', 'c-0003');
  node('tools/manage.js', 'members', '--entity', 'e-0001', '--admit', 'c-0003', '--by', 'c-0001');
  node('tools/manage.js', 'organs', '--entity', 'e-0001', '--set', 'director=c-0001,secretary=c-0003', '--by', 'c-0001');
  node('tools/settle.js');
  const y = readf('register/entities/e-0001.yml');
  return y.includes('secretary') && y.includes('c-0003') || y;
});
check('a non-organ may not act for the entity', () => {
  node('tools/keygen.js', 'c-0004'); node('tools/join.js', 'private/c-0004.pem', 'c-0004');
  return !node('tools/manage.js', 'dissolve', '--entity', 'e-0001', '--by', 'c-0004').ok || 'an outsider acted';
});

console.log('\nValue\n');

write('proposals/P-0100-issue.md', `---
id: P-0100
title: Resolution on the First Issue
sponsor: c-0001
class: ordinary
cites: [art-09/§49/¶1]
opened: 2026-01-01
closes: 2099-01-01
---

## § 1

¹ The Treasurer is authorised to issue 50000 obols.
`);

check('a resolution authorising an issue carries', () => {
  for (const c of ['c-0001', 'c-0003', 'c-0004']) node('tools/sign.js', 'P-0100', 'yes', c);
  node('tools/tally.js', 'P-0100');
  const r = node('tools/enact.js', 'P-0100');
  return r.out.includes('Enacted') || r.out;
});
check('an issue under a measure that has not carried is refused', () => {
  const r = node('tools/issue.js', '--unit', '10', '--under', 'P-9999', '--by', 'c-0001');
  return !r.ok || 'issued under a measure that authorises nothing';
});
check('the Treasurer issues under it', () => {
  const r = node('tools/issue.js', '--unit', '50000', '--under', 'P-0100', '--by', 'c-0001');
  return r.out.includes('Issued') || r.out;
});
check('an issue without a resolution is refused', () => !node('tools/issue.js', '--unit', '10', '--by', 'c-0001').ok || 'issued without a resolution');
check('the Treasury disburses to a citizen', () => {
  node('tools/pay.js', '--from', 'treasury', '--to', 'c-0001', '--amount', '10000', '--by', 'c-0001');
  const r = node('tools/settle.js');
  return r.out.includes('treasury → c-0001') || r.out;
});
check('overspending is refused before it is even signed', () => {
  const r = node('tools/pay.js', '--from', 'c-0001', '--to', 'treasury', '--amount', '999999999', '--by', 'c-0001');
  return !r.ok || 'signed a transfer it cannot cover';
});
check('an instrument that fails at settlement is refused and the reason kept', () => {
  // Signed correctly, but the balance is gone by the time it settles.
  const r0 = node('--input-type=module', '-e', `
    import fs from 'node:fs'; import crypto from 'node:crypto';
    import { canonical } from './tools/lib/events.js';
    import { sign } from './tools/lib/sshsig.js';
    const b = { kind: 'transfer', from: 'c-0003', to: 'c-0001', amount: 4242, by: 'c-0003',
      at: new Date().toISOString(), salt: crypto.randomBytes(8).toString('hex') };
    b.signature = sign(canonical(b), fs.readFileSync('private/c-0003.pem', 'utf8'), { namespace: 'republic' });
    fs.mkdirSync('transfers', { recursive: true });
    fs.writeFileSync('transfers/short.json', JSON.stringify(b, null, 2));
  `);
  if (!r0.ok) return r0.out;
  const r = node('tools/settle.js');
  if (!r.out.includes('refused')) return r.out;
  const kept = fs.existsSync(path.join(DIR, 'refused/short.json'));
  return kept && JSON.parse(readf('refused/short.json'))._refused?.why ? true : 'the reason was not kept';
});
check('balances add up to what was issued', () => {
  const r = node('tools/value.js');
  const issued = Number((r.out.match(/Issued in total: (\d+)/) || [])[1] || 0);
  const held = [...r.out.matchAll(/^\s+\S+\s+(\d+) obol/gm)].reduce((a, m) => a + Number(m[1]), 0);
  return issued > 0 && issued === held || `issued ${issued}, held ${held}\n${r.out}`;
});

console.log('\nShares and the exchange\n');

check('a company issues a share in itself', () => node('tools/issue.js', '--instrument', 'e-0001:ordinary', '--quantity', '1000', '--by', 'c-0001', '--to', 'e-0001').ok || 'could not issue');
check('a foundation may not issue', () => {
  node('tools/entity.js', '--name', 'Test Foundation', '--type', 'foundation', '--by', 'c-0001', '--organ', 'convenor=c-0001');
  return !node('tools/issue.js', '--instrument', 'e-0002:ordinary', '--quantity', '1', '--by', 'c-0001').ok || 'a foundation issued';
});
check('shares transfer', () => {
  node('tools/pay.js', '--from', 'e-0001', '--to', 'c-0001', '--instrument', 'e-0001:ordinary', '--quantity', '300', '--by', 'c-0001');
  const r = node('tools/settle.js');
  return r.out.includes('300 × e-0001:ordinary') || r.out;
});
check('the exchange clears at a uniform price', () => {
  node('tools/order.js', '--side', 'sell', '--instrument', 'e-0001:ordinary', '--quantity', '100', '--price', '20', '--by', 'c-0001', '--account', 'e-0001');
  node('tools/order.js', '--side', 'buy', '--instrument', 'e-0001:ordinary', '--quantity', '80', '--price', '25', '--by', 'c-0001', '--account', 'c-0001');
  const r = node('tools/settle.js');
  return r.out.includes('cleared 80 at 20') || r.out;
});

console.log('\nContracts\n');

check('a contract is drafted', () => node('tools/contract.js', 'draft', '--title', 'Test Contract', '--parties', 'c-0001,c-0003', '--by', 'c-0001').ok || 'could not draft');
check('it does not execute on one signature', () => {
  node('tools/contract.js', 'sign', '--id', 'test-contract', '--by', 'c-0001');
  const r = node('tools/settle.js');
  return !r.out.includes('test-contract executed') || 'executed on one signature';
});
check('it executes when every party has signed', () => {
  node('tools/contract.js', 'sign', '--id', 'test-contract', '--by', 'c-0003');
  const r = node('tools/settle.js');
  return r.out.includes('executed') || r.out;
});
check('an alteration after signature voids the signatures', () => {
  node('tools/contract.js', 'draft', '--title', 'Tamper', '--parties', 'c-0001,c-0003', '--by', 'c-0001');
  node('tools/contract.js', 'sign', '--id', 'tamper', '--by', 'c-0001');
  node('tools/contract.js', 'sign', '--id', 'tamper', '--by', 'c-0003');
  fs.appendFileSync(path.join(DIR, 'contracts/tamper.md'), '\n');
  const r = node('tools/settle.js');
  return r.out.includes('changed after signature') || r.out;
});

console.log('\nThe Court\n');

check('a case may be brought', () => node('tools/court.js', 'file', '--against', 'P-0001', '--by', 'c-0001', '--seeking', 'construe', '--ground', 'A ground.').ok || 'could not file');
check('a judge decides it', () => {
  node('tools/office.js', 'set', '--office', 'judge', '--holder', 'c-0001');
  const r = node('tools/court.js', 'judge', '--case', '1', '--by', 'c-0001', '--holding', 'dismissed', '--reasons', 'Because.');
  return r.out.includes('decided') || r.out;
});
check('someone who does not sit may not judge', () => {
  node('tools/court.js', 'file', '--against', 'P-0002', '--by', 'c-0001', '--ground', 'g');
  return !node('tools/court.js', 'judge', '--case', '2', '--by', 'c-0003', '--holding', 'void', '--reasons', 'r').ok || 'a non-judge decided';
});

console.log('\nThe gate\n');

const gitq = (...a) => run('git', a);
gitq('init', '-q'); gitq('config', 'user.email', 't@t'); gitq('config', 'user.name', 't');
gitq('add', '-A'); gitq('commit', '-qm', 'base');

const gateClass = (file) => {
  fs.appendFileSync(path.join(DIR, file), '\n');
  gitq('add', '-A'); gitq('commit', '-qm', 'x');
  const r = node('tools/gate.js', '--base', 'HEAD~1');
  const m = r.out.match(/class "([a-z]+)"/);
  return m ? m[1] : (r.out.includes('No governed path') ? 'none' : '?');
};

check('the Constitution needs an amendment', () => gateClass('journal/constitution/en/06-offices.md') === 'amendment' || 'wrong class');
check('an entrenched Article needs more', () => gateClass('journal/constitution/en/02-invariants.md') === 'entrenched' || 'wrong class');
check('the tools need an organic measure', () => gateClass('tools/tally.js') === 'organic' || 'wrong class');
check('parameters need an organic measure', () => gateClass('parameters.yml') === 'organic' || 'wrong class');
check('statute needs a policy measure', () => gateClass('journal/statutes/statute-on-meetings.md') === 'policy' || 'wrong class');
check('records need nothing', () => gateClass('ledger/events.jsonl') === 'none' || 'records were gated');
check('a stylesheet needs nothing', () => gateClass('site/style.css') === 'none' || 'presentation was gated');

console.log('\nIntegrity and the site\n');

check('the register still verifies', () => node('tools/verify.js').out.includes('verifies') || node('tools/verify.js').out);
check('every invariant still holds', () => node('tools/test.js').out.includes('0 failed') || node('tools/test.js').out);
check('the doctor finds nothing wrong', () => node('tools/doctor.js').out.includes('Nothing is wrong') || node('tools/doctor.js').out);
check('a checkpoint signs and verifies', () => {
  fs.copyFileSync(path.join(DIR, 'private/c-0001.pem'), path.join(DIR, 'private/keeper.pem'));
  node('tools/checkpoint.js');
  return node('tools/verify.js').out.includes('signature valid') || 'checkpoint did not verify';
});
check('the site builds', () => {
  const r = node('tools/build.js');
  return r.out.includes('Built') || r.out;
});
check('every generated script parses', () => {
  const bad = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name === 'index.html') {
      for (const m of fs.readFileSync(p, 'utf8').matchAll(/<script type="module">([\s\S]*?)<\/script>/g)) {
        const t = path.join(DIR, '_chk.mjs'); fs.writeFileSync(t, m[1]);
        const r = run('node', ['--check', '_chk.mjs']);
        if (!r.ok) bad.push(p.replace(DIR, ''));
        fs.rmSync(t);
      }
    }
  } };
  walk(path.join(DIR, 'dist'));
  return bad.length ? `${bad.length} broken: ${bad.slice(0, 3).join(', ')}` : true;
});
check('no page shows undefined or NaN', () => {
  const bad = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name === 'index.html' && />undefined<|NaN/.test(fs.readFileSync(p, 'utf8'))) bad.push(p.replace(DIR, ''));
  } };
  walk(path.join(DIR, 'dist'));
  return bad.length ? bad.slice(0, 3).join(', ') : true;
});
check('the law section carries the Constitution and the statute', () => {
  const h = fs.readFileSync(path.join(DIR, 'dist/journal/law/index.html'), 'utf8');
  return h.includes('const.art-01') && h.includes('stat.statute-on-meetings') || 'law index incomplete';
});
check('the doctor resolves conflict markers in the ledger', () => {
  const good = readf('ledger/events.jsonl');
  const lines = good.trim().split('\n');
  write('ledger/events.jsonl', [
    ...lines.slice(0, 3), '<<<<<<< HEAD', ...lines.slice(3, 6), '=======',
    ...lines.slice(6), '>>>>>>> origin/main',
  ].join('\n') + '\n');
  if (node('tools/doctor.js').ok) return 'markers not detected';
  const r = node('tools/doctor.js', '--repair');
  if (!r.out.includes('markers removed')) return r.out;
  node('tools/checkpoint.js');
  return node('tools/verify.js').out.includes('verifies') || 'did not recover';
});
check('the doctor repairs a merge-damaged register', () => {
  const before = readf('ledger/events.jsonl');
  fs.appendFileSync(path.join(DIR, 'ledger/events.jsonl'), before.split('\n').slice(0, 5).join('\n') + '\n');
  if (node('tools/doctor.js').ok) return 'damage not detected';
  node('tools/doctor.js', '--repair');
  node('tools/checkpoint.js');
  return node('tools/verify.js').out.includes('verifies') || 'repair failed';
});

// ---- report -------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) { console.log('Failed:'); for (const f of failures) console.log(`  ${f}`); }
if (KEEP) console.log(`\nScratch republic kept at ${DIR}`);
else fs.rmSync(DIR, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
