#!/usr/bin/env node
// Builds the public site. The repository is authoritative (art-01/§5/¶2);
// this is one client of it.
//
// English only (art-01/§6/¶1). One typeface, three sizes, no footer.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { buildCorpus, linkify, isoDate } from './lib/corpus.js';
import { read, verifyChain, checkpointList } from './lib/events.js';
import { citizens, activeCitizens, entities, offices } from './lib/registers.js';
import { params, classes } from './lib/params.js';
import { defaultCharter } from './lib/charter.js';
import { ledgerState, accounts, contracts, contractComplete, TREASURY } from './lib/value.js';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'dist');
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');
const REPO = process.env.GITHUB_REPOSITORY || 'virtual-republic/republic';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const u = (p) => BASE + p;

const C = buildCorpus(ROOT);
const P = params(ROOT);
const CLASSES = classes(ROOT);
const events = read(ROOT);
const chain = verifyChain(ROOT);
const checkpoints = checkpointList(ROOT);
const roll = citizens(ROOT);
const active = activeCitizens(ROOT);
const ents = entities(ROOT).map((e) => {
  if (!e.charter || !fs.existsSync(path.join(ROOT, e.charter))) return e;
  const f = fs.readFileSync(path.join(ROOT, e.charter), 'utf8');
  const end = f.indexOf('\n---', 3);
  return { ...e, charterBody: f.slice(end + 4) };
});
const offs = offices(ROOT);
const V = ledgerState(ROOT);
const ACCTS = accounts(ROOT);
const CONTRACTS = contracts(ROOT);
const UNIT = P.value.unit;
const NAME = C.constitution.meta.republic.name || C.constitution.meta.republic.name_en || 'The Republic';
// The register is state and may still carry pre-rename field names.
const titleOf = (o) => o.title || o.title_en || o.id;
const nameOf = (e) => e.name || e.name_en || e.id;
const issueTitle = (j) => j.title || j.title_en || `Issue ${j.number}`;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const link = (t) => linkify(t, C.entries, { esc, base: BASE });
const slug = (bare) => bare.replace(/§/g, 's').replace(/¶/g, 'p').replace(/\//g, '-');
const href = (bare) => u(`/journal/constitution/${slug(bare)}/`);

// ---------------------------------------------------------------- helpers ---

function closesOf(p) {
  const spec = CLASSES[p.class];
  if (p.closes) return new Date(isoDate(p.closes) + 'T23:59:59Z');
  if (p.opened && spec) return new Date(new Date(isoDate(p.opened) + 'T00:00:00Z').getTime() + spec.window_days * 86400000);
  return null;
}
const isOpen = (p) => { const c = closesOf(p); return c ? new Date() < c : true; };

// A measure is open only if the calendar says so AND no result has been
// recorded. art-08/§43/¶5 lets a measure close early, so the date alone lies.
function statusOf(p) {
  const r = resultFor(p.id);
  if (r && r.open === false && r.outcome) {
    if (r.outcome.winner) return { open: false, label: r.outcome.carried ? `elected ${r.outcome.winner}` : 'no result', carried: !!r.outcome.carried, winner: r.outcome.winner };
    return { open: false, label: r.outcome.carried ? 'carried' : 'not carried', carried: !!r.outcome.carried };
  }
  if (r && r.outcome && r.outcome.open === false) {
    if (r.outcome.winner) return { open: false, label: r.outcome.carried ? `elected ${r.outcome.winner}` : 'no result', carried: !!r.outcome.carried, winner: r.outcome.winner };
    return { open: false, label: r.outcome.carried ? 'carried' : 'not carried', carried: !!r.outcome.carried };
  }
  if (!isOpen(p)) return { open: false, label: 'closed, not yet counted', carried: false };
  return { open: true, label: 'open', carried: false };
}

function ballotsFor(id) {
  const d = path.join(ROOT, 'ballots', id);
  if (!fs.existsSync(d)) return {};
  const out = {};
  for (const f of fs.readdirSync(d)) if (f.endsWith('.json') && !f.startsWith('_')) out[path.basename(f, '.json')] = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
  return out;
}
function resultFor(id) {
  const f = path.join(ROOT, 'ballots', id, '_result.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

// backlinks: every act, keyed by the provision it cites
const back = new Map();
const cite = (id, e) => {
  const n = id.includes('.') ? id : 'const.' + id;
  if (!back.has(n)) back.set(n, []);
  back.get(n).push(e);
  const parts = n.split('/');
  if (parts.length === 3) cite(parts.slice(0, 2).join('/'), e);
  if (parts.length === 2) cite(parts[0], e);
};
for (const e of events) cite(e.provision, { kind: 'record', label: e.kind, href: `/ledger/#r${e.seq}`, at: e.at });
for (const j of C.journal) for (const c of [].concat(j.cites || [])) cite(String(c), { kind: 'journal', label: `Journal ${j.number}`, href: `/journal/issues/${j.number}/`, at: j.date });
for (const p of C.proposals) for (const c of [].concat(p.cites || [])) cite(String(c), { kind: 'measure', label: p.id, href: `/assembly/${p.id}/`, at: isoDate(p.opened) });

// ------------------------------------------------------------------ page ---

const NAV = [['', 'Republic'], ['journal', 'Journal'], ['assembly', 'Assembly'],
             ['office', 'Office'], ['register', 'Register'], ['treasury', 'Value'], ['ledger', 'Ledger']];

// Everything the Republic has published lives under /journal/, as it does on
// disk. These are its parts.
const JOURNAL_NAV = [['journal/constitution', 'Constitution'], ['journal/law', 'Law'],
                     ['journal/court', 'Court'], ['journal/issues', 'Issues']];

function page(title, body, { on = '', script = '', narrow = false } = {}) {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${esc(NAME)}</title>
<link rel="stylesheet" href="${u('/style.css')}">
<body>
<header class="top">
  <a class="name" href="${u('/')}">${esc(NAME)}</a>
  <nav>${NAV.map(([s, l]) => `<a href="${u('/' + s + (s ? '/' : ''))}"${on === s || (s === 'journal' && on.startsWith('journal')) ? ' class="on"' : ''}>${esc(l)}</a>`).join('')}</nav>
  <span class="who"><a href="${u('/key/')}" id="whoami">sign in</a></span>
</header>
<main${narrow ? ' class="narrow"' : ''}>${on.startsWith('journal') ? `<nav class="sub-nav">${JOURNAL_NAV.map(([s, l]) => `<a href="${u('/' + s + '/')}"${on === s ? ' class="on"' : ''}>${esc(l)}</a>`).join('')}</nav>` : ''}${body}</main>
<script type="module">
// Show which citizenship this browser holds, in the masthead and nowhere else.
try {
  const held = JSON.parse(localStorage.getItem('republic.key') || 'null');
  if (held && held.id) document.getElementById('whoami').textContent = held.id;
  else if (held) document.getElementById('whoami').textContent = 'key loaded';
} catch {}
for (const a of document.querySelectorAll('a.anchor, a.mark')) {
  if (!a.dataset.cite) continue;
  a.onclick = (e) => {
    e.preventDefault();
    navigator.clipboard.writeText(a.dataset.cite + '  ' + new URL(a.getAttribute('href'), location).href);
    a.classList.add('copied');
    setTimeout(() => a.classList.remove('copied'), 1200);
    history.replaceState(null, '', a.getAttribute('href'));
  };
}
</script>
${script ? `<script type="module">${script}</script>` : ''}
</body></html>`;
}

const write = (rel, html) => {
  const f = path.join(OUT, rel, 'index.html');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, html);
};

// Markdown, enough for the Journal: headings, lists, quotes, emphasis, rules.
// Citations are linked by link() on the way through, so const.art-08/§45/¶1
// inside an issue resolves like anywhere else.
function markdown(src) {
  const out = [];
  let list = null, para = [], item = null, mark = null;

  const inline = (t) => link(t)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  const flushItem = () => { if (item) { out[out.length - 1] = `<li>${inline(item.join(' '))}</li>`; item = null; } };
  const flushMark = () => { if (mark) { out[out.length - 1] = para0(mark.n, mark.text.join(' ')); mark = null; } };
  const flushPara = () => { flushItem(); flushMark(); if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { flushItem(); if (list) { out.push(`</${list}>`); list = null; } };

  for (const raw of String(src).split('\n')) {
    const line = raw.trim();

    if (!line) { flushPara(); continue; }

    if (/^---+$/.test(line)) { flushPara(); flushList(); out.push('<hr class="rule">'); continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flushPara(); flushList(); const n = Math.min(h[1].length + 1, 4); out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }

    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) { flushPara(); if (list !== 'ul') { flushList(); out.push('<ul class="md">'); list = 'ul'; } item = [ul[1]]; out.push(''); continue; }

    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (ol) { flushPara(); if (list !== 'ol') { flushList(); out.push('<ol class="md">'); list = 'ol'; } item = [ol[1]]; out.push(''); continue; }

    const q = line.match(/^>\s?(.*)$/);
    if (q) { flushPara(); flushList(); out.push(`<blockquote>${inline(q[1])}</blockquote>`); continue; }

    // a numbered paragraph of law keeps its gutter
    const mk = line.match(/^([¹²³⁴⁵⁶⁷⁸⁹])\s+(.*)$/);
    if (mk) { flushPara(); flushList(); mark = { n: '¹²³⁴⁵⁶⁷⁸⁹'.indexOf(mk[1]) + 1, text: [mk[2]] }; out.push(''); continue; }

    // A line that continues the thing above it belongs to that thing, not to a
    // paragraph of its own. This is what broke wrapped list items.
    if (item) { item.push(line); continue; }
    if (mark) { mark.text.push(line); continue; }

    flushList();
    para.push(line);
  }
  flushPara(); flushList(); flushItem(); flushMark();
  return out.filter(Boolean).join('\n');
}
const para0 = (n, t) => `<p class="para"><span class="mark">${n}</span><span class="text">${link(t)}</span></p>`;

// two grid children only: the mark, and one span holding all the text
const para = (n, text, id, citeId) =>
  `<p class="para"${id ? ` id="${id}"` : ''}>` +
  (citeId ? `<a class="mark anchor" href="#${id}" data-cite="${citeId}">${n}</a>` : `<span class="mark">${n}</span>`) +
  `<span class="text">${link(text)}</span></p>`;

const sections = (secs, artId) => secs.map((s) => {
  const c = artId ? `const.${artId}/§${s.num}` : null;
  return `<section class="sec" id="s${s.num}">
    <h2><span class="n">§ ${s.num}</span> ${esc(s.heading)}
      ${c ? `<a class="anchor" href="#s${s.num}" data-cite="${c}" title="copy citation">§</a>` : ''}</h2>
    ${s.paragraphs.map((p) => para(p.num, p.text, `s${s.num}p${p.num}`, c ? `${c}/¶${p.num}` : null)).join('')}
  </section>`;
}).join('');

// ------------------------------------------------------------- identity JS --

const IDENT = `
import * as R from '${u('/republic.js')}';
const $ = (i) => document.getElementById(i);
function problem(where, err) {
  const m = $('msg');
  const t = where + ': ' + (err && err.message ? err.message : err);
  if (m) { m.textContent = t; m.className = 'msg bad'; }
  console.error('[republic]', where, err);
}
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status + ' for ' + url);
  return r.json();
}
let meta, priv = null, me = null, pem = null;
try { meta = await getJSON('${u('/data/meta.json')}'); } catch (e) { problem('could not load the site data', e); throw e; }
const roll = await getJSON('${u('/data/citizens.json')}');

async function useKey(text) {
  priv = await R.importPrivateKey(text);
  pem = text;
  const mine = R.publicKeyLine(priv.raw, '').split(/\\s+/)[1];
  const found = roll.find((c) => (c.keys || []).some((k) => k.split(/\\s+/)[1] === mine));
  me = found ? found.id : null;
  try { localStorage.setItem('republic.key', JSON.stringify({ id: me, key: text.replace(/-----[A-Z ]+-----/g, '').replace(/\\s+/g, '') })); } catch {}
  const w = $('whoami'); if (w) w.textContent = me || 'key loaded';
  document.dispatchEvent(new CustomEvent('identity'));
}
try {
  const held = JSON.parse(localStorage.getItem('republic.key') || 'null');
  if (held && held.key) await useKey('-----BEGIN PRIVATE KEY-----\\n' + held.key + '\\n-----END PRIVATE KEY-----');
} catch {}
`;

// ---------------------------------------------------------------- output ----

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.copyFileSync(path.join(ROOT, 'site/style.css'), path.join(OUT, 'style.css'));
fs.copyFileSync(path.join(ROOT, 'site/republic.js'), path.join(OUT, 'republic.js'));

// ---- home ------------------------------------------------------------------

const openMeasures = C.proposals.filter(isOpen);
write('', page('Republic', `
  <h1>${esc(NAME)}<span class="sub">${esc(C.constitution.meta.republic.motto || '')}</span></h1>
  <p class="lede">A voluntary civic association governed by a text its citizens wrote. Every act is recorded, published, and verifiable by anyone.</p>

  <h2>Before the Assembly</h2>
  <ul class="list">${(() => {
    const live = C.proposals.filter((p) => statusOf(p).open);
    return live.length ? live.slice().reverse().map((p) => {
      const st = statusOf(p);
      return `<li><a href="${u(`/assembly/${p.id}/`)}">${esc(p.title || p.id)}</a><span class="meta">closes ${esc(closesOf(p)?.toISOString().slice(0, 10) || '')}</span></li>`;
    }).join('') : '<li class="quiet">Nothing is before the Assembly.</li>';
  })()}</ul>

  <h2>Law in force</h2>
  <ul class="list">${C.statutes.length ? C.statutes.slice().reverse().map((st) => {
    const v = st.versions.en || Object.values(st.versions)[0];
    return `<li><a href="${u(`/journal/law/${st.slug}/`)}">${esc(v.title || st.slug)}</a><span class="meta">${esc(isoDate(v.enacted))}</span></li>`;
  }).join('') : '<li class="quiet">Nothing enacted yet.</li>'}</ul>

  <h2>Journal</h2>
  <ul class="list">${C.journal.slice(-5).reverse().map((j) =>
    `<li><a href="${u('/journal/issues/' + j.number + '/')}">${esc(issueTitle(j))}</a><span class="meta">${esc(j.date)}</span></li>`).join('')
    || '<li class="quiet">No issues yet.</li>'}</ul>

  <h2>State</h2>
  <table><tbody>
    <tr><td class="q">Citizens</td><td>${active.length}</td></tr>
    <tr><td class="q">Entities</td><td>${ents.length}</td></tr>
    <tr><td class="q">Records</td><td>${events.length}</td></tr>
    <tr><td class="q">Register</td><td>${chain.ok ? 'verifies' : 'DOES NOT VERIFY'}</td></tr>
  </tbody></table>`, { on: '', narrow: true }));

// ---- constitution ----------------------------------------------------------

write('journal/constitution', page('Constitution', `
  <h1>Constitution</h1>
  <ol class="contents">${C.constitution.articles.map((a) => {
    const v = a.versions.en;
    return `<li><span class="n">${esc(a.id.replace('art-', ''))}</span><a href="${href(a.id)}">${esc(v.title)}</a>
      ${a.entrenched ? '<span class="meta">entrenched</span>' : ''}</li>`;
  }).join('')}</ol>`, { on: 'journal/constitution', narrow: true }));

for (const art of C.constitution.articles) {
  const v = art.versions.en;
  write(`journal/constitution/${slug(art.id)}`, page(v.title, `
    <p class="crumb"><a href="${u('/journal/constitution/')}">Constitution</a> · ${esc(art.id)}</p>
    <article class="law">
      <h1>${esc(v.title)}${art.entrenched ? '<span class="sub">Entrenched — art-11/§61</span>' : ''}</h1>
      ${v.note ? `<div class="note">${v.note.split('\n\n').map((x) => `<p>${link(x.replace(/\*/g, ''))}</p>`).join('')}</div>` : ''}
      ${sections(v.sections, art.id)}
    </article>`, { on: 'journal/constitution', narrow: true }));

  for (const sec of v.sections) {
    const targets = [{ bare: `${art.id}/§${sec.num}`, only: null }, ...sec.paragraphs.map((p) => ({ bare: `${art.id}/§${sec.num}/¶${p.num}`, only: p.num }))];
    for (const t of targets) {
      const id = 'const.' + t.bare;
      const links = back.get(id) || [];
      const ps = t.only ? sec.paragraphs.filter((p) => p.num === t.only) : sec.paragraphs;
      write(`journal/constitution/${slug(t.bare)}`, page(t.bare, `
        <p class="crumb"><a href="${u('/journal/constitution/')}">Constitution</a> ·
          <a href="${href(art.id)}">${esc(v.title)}</a> · § ${sec.num}${t.only ? ' ¶ ' + t.only : ''}</p>
        <h1>${esc(sec.heading)}<span class="sub">${esc(id)}</span></h1>
        <article class="law">${ps.map((p) => para(p.num, p.text)).join('')}</article>
        <div class="row"><button class="plain" data-copy="${esc(id)}">copy citation</button></div>
        <h2>Acts under this provision</h2>
        ${links.length ? `<ul class="list">${links.map((l) =>
          `<li><a href="${u(l.href)}">${esc(l.label)}</a><span class="meta">${esc(String(l.at || '').slice(0, 10))}</span></li>`).join('')}</ul>`
          : '<p class="quiet">None yet.</p>'}`, { on: 'constitution', narrow: true, script: `
        for (const b of document.querySelectorAll('[data-copy]')) b.onclick = () => {
          navigator.clipboard.writeText(b.dataset.copy + '  ' + location.href);
          b.textContent = 'copied'; setTimeout(() => b.textContent = 'copy citation', 1200);
        };` }));
    }
  }
}

// ---- key -------------------------------------------------------------------

write('key', page('Key', `
  <h1>Your key<span class="sub">A citizenship is a keypair. It is made here and never leaves this browser.</span></h1>
  <p id="msg" class="msg quiet">No key loaded.</p>
  <div class="row">
    <button id="make">Create a citizenship</button>
    <button id="pick">Load a key</button>
    <button id="drop" class="plain">forget</button>
  </div>
  <div id="loader" hidden>
    <label for="file">Choose your .pem file</label>
    <input type="file" id="file" accept=".pem,.txt">
    <label for="paste">Or paste it, headers and all</label>
    <textarea id="paste" placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
    <div class="row"><button id="go">Load</button></div>
  </div>
  <div id="shown" hidden>
    <h2>Private key</h2>
    <p class="quiet">This is your citizenship. Save it. Never publish it, never commit it.</p>
    <div class="out" id="privout"></div>
    <div class="row"><button id="dl" class="plain">download</button><button id="copy" class="plain">copy</button></div>
    <h2>Public key</h2>
    <p class="quiet">The harmless half. This is what goes on the register.</p>
    <div class="out" id="pubout"></div>
    <div class="row"><a id="joinlink" class="button" hidden>Apply for citizenship on GitHub</a></div>
  </div>`, { on: '', narrow: true, script: IDENT + `
  function show() {
    $('shown').hidden = false;
    $('privout').textContent = pem.trim();
    const line = R.publicKeyLine(priv.raw, me || '');
    $('pubout').textContent = line;
    $('msg').className = 'msg';
    $('msg').textContent = me ? 'Signed in as ' + me + ', on the register.' : 'Key loaded. Not yet on the register.';
    if (!me) {
      const next = 'c-' + String(roll.length + 1).padStart(4, '0');
      const yml = ['id: ' + next, 'status: active', 'admitted: ' + new Date().toISOString().slice(0, 10),
        'admitted_under: art-03/§16/¶3', 'keys:', '  - ' + R.publicKeyLine(priv.raw, next), ''].join('\\n');
      $('joinlink').href = R.commitUrl(meta.repo, meta.branch, 'register/citizens/' + next + '.yml', yml, 'admit ' + next);
      $('joinlink').hidden = false;
    }
  }
  $('make').onclick = async () => {
    try {
      const kp = await R.generateKey('');
      await useKey(kp.privateKeyPem);
      show();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([kp.privateKeyPem], { type: 'application/x-pem-file' }));
      a.download = 'citizenship.pem'; a.click();
    } catch (e) { problem('could not create a key', e); }
  };
  $('pick').onclick = () => { $('loader').hidden = !$('loader').hidden; };
  $('file').onchange = async (e) => { const f = e.target.files[0]; if (f) load(await f.text()); };
  $('go').onclick = () => load($('paste').value);
  async function load(t) { try { await useKey(t); $('loader').hidden = true; show(); } catch (e) { problem('that key could not be read', e); } }
  $('dl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([pem])); a.download = (me || 'citizenship') + '.pem'; a.click(); };
  $('copy').onclick = () => navigator.clipboard.writeText(pem);
  $('drop').onclick = () => { localStorage.removeItem('republic.key'); location.reload(); };
  if (priv) show();
  ` }));

// ---- assembly ---------------------------------------------------------------

write('assembly', page('Assembly', `
  <h1>Assembly<span class="sub">The Assembly is all citizens — art-06/§30/¶1.</span></h1>
  <ul class="list">${C.proposals.length ? C.proposals.slice().reverse().map((p) => {
    const st = statusOf(p);
    return `<li><a href="${u(`/assembly/${p.id}/`)}">${esc(p.title || p.id)}</a>
      <span class="meta">${esc(CLASSES[p.class]?.label || p.class)} · ${esc(st.label)}</span></li>`;
  }).join('') : '<li class="quiet">Nothing before the Assembly.</li>'}</ul>

  <h2>Lay a measure</h2>
  <p id="msg" class="msg quiet"></p>
  <label for="ptitle">Title</label><input type="text" id="ptitle">
  <label for="pclass">Class</label><select id="pclass"></select>
  <label for="pcites">Provisions it is made under, one per line</label><textarea id="pcites" rows="3"></textarea>
  <label for="pauth">Pull request or commit it authorises, if it changes the code or the law (optional)</label><input type="text" id="pauth" placeholder="#12">
  <label for="pstat">Statute it replaces, by slug, if it amends one (optional)</label><input type="text" id="pstat" placeholder="statute-on-meetings">
  <label for="pbody">Text</label><textarea id="pbody" rows="8"></textarea>
  <div class="row"><button id="check">Check</button><a id="commit" class="button" hidden>Open on GitHub</a></div>
  <div class="out" id="preview" hidden></div>`, { on: 'assembly', narrow: true, script: IDENT + `
  const resolve = await getJSON('${u('/data/resolve.json')}');
  const existing = await getJSON('${u('/data/proposals.json')}');
  $('pclass').innerHTML = Object.entries(meta.classes).map(([k, v]) => '<option value="' + k + '">' + v.label + '</option>').join('');
  $('check').onclick = () => {
    try {
      const cites = $('pcites').value.split('\\n').map((c) => c.trim()).filter(Boolean);
      if (!cites.length) throw new Error('a measure that cites nothing is not received (art-08/§41/¶3)');
      const bad = cites.filter((c) => !resolve[c] && !resolve['const.' + c]);
      if (bad.length) throw new Error('does not resolve: ' + bad.join(', '));
      if (!$('ptitle').value.trim()) throw new Error('give it a title');
      const id = 'P-' + String(existing.length + 1).padStart(4, '0');
      const spec = meta.classes[$('pclass').value];
      const now = new Date(), end = new Date(now.getTime() + spec.window_days * 86400000);
      const md = ['---', 'id: ' + id, 'title: ' + $('ptitle').value.trim(),
        'sponsor: ' + (me || 'c-0001'), 'class: ' + $('pclass').value,
        ...($('pauth').value.trim() ? ['authorises: ' + $('pauth').value.trim()] : []),
        ...($('pstat').value.trim() ? ['amends_statute: ' + $('pstat').value.trim()] : []),
        'cites:',
        ...cites.map((c) => '  - ' + c),
        'opened: ' + now.toISOString().slice(0, 10), 'closes: ' + end.toISOString().slice(0, 10),
        '---', '', '## § 1', '', '¹ ' + $('pbody').value.trim(), ''].join('\\n');
      $('msg').className = 'msg'; $('msg').textContent = 'Received. ' + id + ', closing ' + end.toISOString().slice(0, 10) + '.';
      $('preview').hidden = false; $('preview').textContent = md;
      const s = ($('ptitle').value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'measure');
      $('commit').href = R.commitUrl(meta.repo, meta.branch, 'proposals/' + id + '-' + s + '.md', md, 'propose ' + id);
      $('commit').hidden = false;
    } catch (e) { problem('not received', e); $('commit').hidden = true; $('preview').hidden = true; }
  };` }));

for (const p of C.proposals) {
  const cl = closesOf(p);
  const st = statusOf(p);
  const open = st.open;
  const election = p.class === 'election';
  const cands = [].concat(p.candidates || []);
  fs.mkdirSync(path.join(OUT, 'data/ballots'), { recursive: true });
  fs.writeFileSync(path.join(OUT, `data/ballots/${p.id}.json`), JSON.stringify(ballotsFor(p.id), null, 2));

  write(`assembly/${p.id}`, page(p.title || p.id, `
    <p class="crumb"><a href="${u('/assembly/')}">Assembly</a> · ${esc(p.id)}</p>
    <h1>${esc(p.title || p.id)}<span class="sub">${esc(CLASSES[p.class]?.label || p.class)} · sponsored by ${esc(p.sponsor || '')} · ${open ? 'closes ' + (cl ? cl.toISOString().slice(0, 10) : '') : esc(st.label)}</span></h1>

    <p class="state" id="state">counting…</p>

    <article class="law">${p.sections.length ? sections(p.sections, null) : `<p>${link(p.body)}</p>`}</article>

    <h2>Made under</h2>
    <ul class="list">${[].concat(p.cites || []).map((c) => `<li>${link(String(c))}</li>`).join('') || '<li class="quiet">—</li>'}</ul>
    <div class="row"><button class="plain" data-copy="prop.${esc(p.id)}">copy citation</button>
      <a class="button" target="_blank" rel="noopener" href="https://github.com/${REPO}/edit/${BRANCH}/${esc(p.file || '')}">Edit the measure</a></div>

    ${open ? `<h2>${election ? 'Rank the candidates' : 'Vote'}</h2>
    <p id="msg" class="msg quiet"></p>
    ${election
      ? `<p class="quiet">Click them in order of preference — art-08/§46/¶1.</p>
         <div class="choices" id="cands">${cands.map((c) => `<button data-cand="${esc(c)}">${esc(c)}</button>`).join('')}</div>
         <p id="rank" class="quiet"></p>`
      : `<div class="choices">
           <button data-choice="yes">yes</button>
           <button data-choice="no">no</button>
           <button data-choice="abstain">abstain</button>
         </div>`}
    <div class="row"><button id="sign" disabled>Sign ballot</button><a id="commit" class="button" hidden>Open on GitHub</a></div>
    <div class="out" id="receipt" hidden></div>` : ''}

    <div id="closebox" hidden>
      <h2>Close and enact</h2>
      <p class="quiet">Counting, publication in the Journal, and the enactment record are written by the workflow, because they change the register — art-08/§45/¶1.</p>
      <div class="row"><a id="closebtn" class="button" target="_blank" rel="noopener">Run it on GitHub</a></div>
    </div>

    <h2>Ballots</h2>
    <table><thead><tr><th>Citizen</th><th>Choice</th><th>Cast</th></tr></thead><tbody id="rows"></tbody></table>`,
  { on: 'assembly', narrow: true, script: IDENT + `
  const isElection = ${JSON.stringify(election)};
  let choice = null, ranking = [];
  const refresh = () => { const b = $('sign'); if (b) b.disabled = !(priv && choice && (!Array.isArray(choice) || choice.length)); };

  if (isElection) {
    const paint = () => {
      for (const b of document.querySelectorAll('[data-cand]')) {
        const i = ranking.indexOf(b.dataset.cand);
        b.setAttribute('aria-pressed', String(i !== -1));
        b.textContent = (i !== -1 ? (i + 1) + '. ' : '') + b.dataset.cand;
      }
      $('rank').textContent = ranking.length ? 'Your ranking: ' + ranking.join(', ') : 'Nothing ranked yet.';
      choice = ranking.length ? ranking.slice() : null;
      refresh();
    };
    for (const b of document.querySelectorAll('[data-cand]')) b.onclick = () => {
      const i = ranking.indexOf(b.dataset.cand);
      if (i === -1) ranking.push(b.dataset.cand); else ranking.splice(i, 1);
      paint();
    };
    paint();
  } else {
    for (const b of document.querySelectorAll('[data-choice]')) b.onclick = () => {
      choice = b.dataset.choice;
      for (const x of document.querySelectorAll('[data-choice]')) x.setAttribute('aria-pressed', String(x === b));
      refresh();
    };
  }
  document.addEventListener('identity', refresh);
  refresh();

  if ($('sign')) $('sign').onclick = async () => {
    try {
      if (!priv) throw new Error('load a key first — see Your key');
      if (!me) throw new Error('this key is not on the register');
      if (!choice) throw new Error(isElection ? 'rank at least one candidate' : 'choose yes, no, or abstain');
      const { ballot, receipt } = await R.makeBallot(${JSON.stringify(p.id)}, choice, priv);
      $('receipt').hidden = false;
      $('receipt').textContent = 'Receipt ' + receipt + '\\n\\n' + JSON.stringify(ballot, null, 2);
      $('commit').href = R.commitUrl(meta.repo, meta.branch, 'ballots/${p.id}/' + me + '.json', JSON.stringify(ballot, null, 2), 'ballot ${p.id}');
      $('commit').hidden = false;
      $('msg').className = 'msg'; $('msg').textContent = 'Signed. Commit it on GitHub to cast it.';
    } catch (e) { problem('could not sign', e); }
  };

  try {
    const spec = meta.classes[${JSON.stringify(p.class)}];
    const closes = ${cl ? JSON.stringify(cl.toISOString()) : 'null'};
    const ballots = await getJSON('${u(`/data/ballots/${p.id}.json`)}');
    const early = (meta.parameters && meta.parameters.ballot && meta.parameters.ballot.early_close) || {};
    const t = await R.tally(${JSON.stringify(p.id)}, ballots, roll, spec, closes, early, ${election ? JSON.stringify(cands) : 'null'});
    const n = roll.filter((c) => c.status === 'active').length;

    $('state').textContent = isElection
      ? t.cast + ' of ' + n + ' cast, ' + t.quorumNeeded + ' needed — ' +
        (t.open ? 'open' + (t.winner ? ', leading: ' + t.winner : '')
          : t.carried ? 'elected ' + t.winner
          : t.winner ? 'no quorum' : 'no result')
      : t.yes + ' yes, ' + t.no + ' no, ' + t.abstain + ' abstain — ' + t.cast + ' of ' + n + ' cast, ' +
        t.quorumNeeded + ' needed — ' + (t.open ? 'open' : (t.closedEarly ? 'closed early, ' + t.closedEarly + ' — ' : '') + (t.carried ? 'carried' : 'not carried'));
    if (!t.open) $('state').classList.add(t.carried ? 'carried' : 'failed');

    if (!t.open) {
      $('closebox').hidden = false;
      $('closebtn').href = 'https://github.com/' + meta.repo + '/actions/workflows/close.yml';
    }
    // art-08/§46/¶2 — the rounds of elimination are published.
    if (isElection && t.rounds && t.rounds.length) {
      const box = document.createElement('div');
      box.innerHTML = '<h2>Rounds</h2><table><thead><tr><th>Round</th><th>Counts</th><th>Eliminated</th></tr></thead><tbody>' +
        t.rounds.map((r, i) => '<tr><td>' + (i + 1) + '</td><td>' +
          r.counts.map((c) => c[0] + ': ' + c[1]).join(' · ') + '</td><td class="q">' + (r.eliminated || '—') + '</td></tr>').join('') +
        '</tbody></table>';
      $('rows').closest('table').insertAdjacentElement('beforebegin', box);
    }

    $('rows').innerHTML = Object.entries(ballots).map(([id, b]) =>
      '<tr><td>' + id + '</td><td>' + (Array.isArray(b.choice) ? b.choice.join(', ') : b.choice) + '</td><td class="q">' + (b.at || '').slice(0, 10) + '</td></tr>').join('')
      || '<tr><td colspan="3" class="q">None yet.</td></tr>';
  } catch (e) { $('state').textContent = 'could not count: ' + e.message; $('state').classList.add('failed'); console.error(e); }
  ` }));
}

// ---- office -----------------------------------------------------------------

const ACTIONS = {
  'register.admit': ['Admit a citizenship', 'register/citizens/', 'art-03/§16/¶4'],
  'register.object': ['Object to an admission', 'journal/', 'art-03/§16/¶4'],
  'entity.register': ['Register an entity', 'register/entities/', 'art-04/§19/¶2'],
  'journal.publish': ['Publish an issue of the Journal', 'journal/', 'art-05/§25/¶2'],
  'checkpoint.sign': ['Sign a checkpoint', 'checkpoints/', 'art-02/§10/¶2'],
  'value.issue': ['Issue the unit', 'ledger/', 'art-09/§49/¶1'],
  'treasury.disburse': ['Disburse from the Treasury', 'ledger/', 'art-09/§53/¶3'],
  'audit.report': ['Report to the Assembly', 'journal/', 'art-06/§32/¶2'],
  'court.halt': ['Halt an act within its enactment window', 'judgments/', 'art-06/§31/¶3'],
  'court.void': ['Declare an act of no effect', 'judgments/', 'art-06/§31/¶3'],
  'court.judge': ['Give judgment, with reasons', 'judgments/', 'art-06/§31/¶5'],
};

// art-06/§31/¶4 — the Court holds no permission over the Treasury. Stated here
// so the office page cannot offer what the Constitution withholds.
const FORBIDDEN = { judge: ['value.issue', 'treasury.disburse'] };

write('office', page('Office', `
  <h1>Offices<span class="sub">Every office holds an enumerated set of permissions and no others — art-06/§28/¶3.</span></h1>
  <table class="wide"><thead><tr><th>Office</th><th>Holder</th><th>Until</th><th>May</th></tr></thead>
  <tbody>${offs.map((o) => `<tr>
    <td>${esc(titleOf(o))}</td><td>${esc(o.holder)}</td><td class="q">${esc(isoDate(o.term_ends))}</td>
    <td class="q">${(o.permissions || []).map((p) => esc((ACTIONS[p] || [p])[0])).join('<br>')}</td></tr>`).join('')}</tbody></table>

  <h2>What your key may do</h2>
  <p id="msg" class="msg quiet">No key loaded. See <a href="${u('/key/')}">Your key</a>.</p>
  <div id="powers"></div>

  <h2>Carried elections</h2>
  <p id="pend" class="quiet">—</p>
  <div id="pendbox" hidden>
    <p class="quiet">An election that carried but was never given effect leaves the register saying one thing and the Journal another — art-06/§29/¶1.</p>
    <table><thead><tr><th>Measure</th><th>Office</th><th>Elected</th></tr></thead><tbody id="pendrows"></tbody></table>
    <pre class="cmd">node tools/office.js install --all
git add register/offices.yml ledger/events.jsonl
git commit -m "give effect to the election" &amp;&amp; git push</pre>
  </div>

  <h2>Stand for office</h2>
  <p class="quiet">Every citizen may stand — art-07/§34/¶1. An election is a measure; the vote is by instant runoff — art-08/§46/¶1.</p>
  <label for="office">Office</label>
  <select id="office">${offs.map((o) => `<option value="${esc(o.id)}">${esc(titleOf(o))}</option>`).join('')}</select>
  <div class="row"><button id="standbtn" disabled>Prepare the election</button><a id="standcommit" class="button" hidden>Open on GitHub</a></div>
  <div class="out" id="standout" hidden></div>`, { on: 'office', script: IDENT + `
  const offices = await getJSON('${u('/data/offices.json')}');
  const existing = await getJSON('${u('/data/proposals.json')}');
  const elections = await getJSON('${u('/data/elections.json')}');
  const ACTIONS = ${JSON.stringify(ACTIONS)};

  // Which carried elections the register has not caught up with.
  const behind = elections.filter((e) => {
    if (!e.carried || !e.winner) return false;
    const o = offices.find((x) => x.id === e.office);
    return o && o.holder !== e.winner;
  });
  if (behind.length) {
    $('pendbox').hidden = false;
    $('pend').textContent = behind.length + ' carried election' + (behind.length === 1 ? '' : 's') + ' not yet given effect.';
    $('pendrows').innerHTML = behind.map((e) =>
      '<tr><td><a href="${u('/assembly/')}' + e.id + '/">' + e.id + '</a></td><td>' + e.office + '</td><td>' + e.winner + '</td></tr>').join('');
  } else {
    $('pend').textContent = 'Every carried election has taken effect.';
  }

  function render() {
    if (!me) { $('powers').innerHTML = ''; return; }
    const mine = offices.filter((o) => o.holder === me);
    $('msg').className = 'msg';
    if (!mine.length) {
      const roll = await getJSON('${u('/data/citizens.json')}');
      const live = new Set(roll.filter((c) => c.status === 'active').map((c) => c.id));
      const empty = offices.filter((o) => !live.has(o.holder));
      $('msg').textContent = me + ' holds no office.';
      $('powers').innerHTML = '<ul class="list">' + offices.map((o) =>
        '<li>' + (o.title || o.id) + '<span class="meta">' + o.holder +
        (live.has(o.holder) ? '' : ' — not an active citizenship') + '</span></li>').join('') + '</ul>' +
        (empty.length ? '<p class="note">' + empty.length + ' office' + (empty.length === 1 ? ' is' : 's are') +
          ' recorded to a citizenship that is not active, so ' + (empty.length === 1 ? 'it is' : 'they are') +
          ' vacant in fact — art-06/§29/¶4. The Assembly appoints until an election is held:</p>' +
          '<pre class="cmd">node tools/office.js vacant --fill ' + me + '\ngit add register/offices.yml ledger/events.jsonl\ngit commit -m "appoint to the vacant offices" &amp;&amp; git push</pre>'
        : '');
    }
    else {
      $('msg').textContent = me + ' holds ' + mine.map((o) => o.title || o.title_en || o.id).join(', ') + '.';
      const perms = [...new Set(mine.flatMap((o) => o.permissions || []))];
      $('powers').innerHTML = '<ul class="list">' + perms.map((p) => {
        const a = ACTIONS[p] || [p, '', ''];
        return '<li><a target="_blank" href="https://github.com/' + meta.repo + '/new/' + meta.branch + '?filename=' + a[1] + '">' + a[0] + '</a><span class="meta">' + a[2] + '</span></li>';
      }).join('') + '</ul>';
    }
    $('standbtn').disabled = false;
  }
  document.addEventListener('identity', render); render();

  $('standbtn').onclick = () => {
    try {
      if (!me) throw new Error('load a key that is on the register');
      const o = offices.find((x) => x.id === $('office').value);
      const id = 'P-' + String(existing.length + 1).padStart(4, '0');
      const spec = meta.classes.election;
      const now = new Date(), end = new Date(now.getTime() + spec.window_days * 86400000);
      const md = ['---', 'id: ' + id, 'title: Election — ' + (o.title || o.title_en || o.id), 'sponsor: ' + me,
        'class: election', 'office: ' + o.id, 'candidates: [' + me + ']',
        'cites:', '  - art-06/§29/¶1', '  - art-07/§34/¶1', '  - art-08/§46/¶1',
        'opened: ' + now.toISOString().slice(0, 10), 'closes: ' + end.toISOString().slice(0, 10),
        '---', '', '## § 1  The office', '', '¹ The office of ' + (o.title || o.title_en || o.id) + ' is filled under Article 6 § 29 ¹.', '',
        '² The office is held for one year from the declaration of the result.', '',
        '## § 2  Method', '', '¹ The vote is by the single transferable vote in its instant-runoff form — Article 8 § 46 ¹.', ''].join('\\n');
      $('standout').hidden = false; $('standout').textContent = md;
      $('standcommit').href = R.commitUrl(meta.repo, meta.branch, 'proposals/' + id + '-election-' + o.id + '.md', md, 'election ' + id);
      $('standcommit').hidden = false;
    } catch (e) { problem('could not prepare', e); }
  };` }));

// ---- journal, register, entities, ledger -----------------------------------

const statuteMeta = (st) => st.versions.en || Object.values(st.versions)[0] || {};

write('journal/law', page('Law', `
  <h1>Law in force<span class="sub">One corpus. The Constitution is the highest law and is listed with the rest — art-01/§3/¶1.</span></h1>
  ${true ? `
  <div class="row">
    <button class="plain" data-sort="title">title</button>
    <button class="plain" data-sort="enacted">date</button>
    <button class="plain" data-sort="class">class</button>
    <button class="plain" data-sort="id">identifier</button>
  </div>
  <table id="laws"><thead><tr><th>Statute</th><th>Class</th><th>Version</th><th>In force since</th><th>Cite as</th></tr></thead>
  <tbody>${[
    ...C.constitution.articles.map((a) => ({
      href: href(a.id), title: a.versions.en.title, cls: a.entrenched ? 'Constitution (entrenched)' : 'Constitution',
      version: '', when: '', cite: `const.${a.id}`, sortId: a.id,
    })),
    ...C.statutes.map((st) => {
      const m = statuteMeta(st);
      return { href: u(`/journal/law/${st.slug}/`), title: m.title || st.slug, cls: CLASSES[m.class]?.label || m.class || '',
        version: m.version || 1, when: isoDate(m.enacted), cite: `stat.${st.slug}`, sortId: st.slug };
    }),
  ].map((r) => `<tr data-title="${esc(r.title)}" data-enacted="${esc(r.when)}" data-class="${esc(r.cls)}" data-id="${esc(r.sortId)}">
      <td><a href="${r.href}">${esc(r.title)}</a></td>
      <td class="q">${esc(r.cls)}</td>
      <td class="q">${r.version}</td>
      <td class="q">${esc(r.when)}</td>
      <td class="q">${esc(r.cite)}</td></tr>`).join('')}</tbody></table>`
  : '<p class="quiet">Nothing has been enacted yet. A measure that carries becomes law on publication — art-08/§45/¶1.</p>'}`,
  { on: 'journal/law', script: `
  let dir = 1, last = null;
  for (const b of document.querySelectorAll('[data-sort]')) b.onclick = () => {
    const k = b.dataset.sort;
    dir = (k === last) ? -dir : 1; last = k;
    const body = document.querySelector('#laws tbody');
    [...body.rows].sort((a, x) => (a.dataset[k] || '').localeCompare(x.dataset[k] || '') * dir).forEach((r) => body.appendChild(r));
    for (const o of document.querySelectorAll('[data-sort]')) o.style.color = '';
    b.style.color = 'var(--ink)';
  };` }));

for (const st of C.statutes) {
  const m = statuteMeta(st);
  const secs = m.sections || [];
  const links = [].concat(m.cites || []);
  const back2 = back.get(`stat.${st.slug}`) || [];
  write(`journal/law/${st.slug}`, page(m.title || st.slug, `
    <p class="crumb"><a href="${u('/journal/law/')}">Law</a> · stat.${esc(st.slug)}</p>
    <h1>${esc(m.title || st.slug)}<span class="sub">${esc(CLASSES[m.class]?.label || m.class || '')}${m.version ? ' · version ' + m.version : ''}${m.enacted ? ' · in force since ' + esc(isoDate(m.enacted)) : ''}${m.measure ? ' · ' + esc(m.measure) : ''}</span></h1>
    <div class="row">
      <button class="plain" data-copy="stat.${esc(st.slug)}">copy citation</button>
      <a class="button" target="_blank" rel="noopener" href="https://github.com/${REPO}/edit/${BRANCH}/statutes/${esc(st.slug)}.md">Edit this statute</a>
    </div>
    <p class="note">Editing statute is an act of the Assembly. The gate refuses the change unless a measure of the right class has carried — art-08/§45/¶1.</p>
    <article class="law">${secs.length ? statuteSections(secs, st.slug) : ''}</article>
    ${links.length ? `<h2>Made under</h2><ul class="list">${links.map((c) => `<li>${link(String(c))}</li>`).join('')}</ul>` : ''}
    ${(m.history || []).length ? `<h2>Earlier versions</h2><ul class="list">${[].concat(m.history).map((h) => `<li class="quiet">${esc(String(h))}</li>`).join('')}</ul>` : ''}
    ${m.journal ? `<h2>Promulgated</h2><ul class="list"><li><a href="${u(`/journal/issues/${m.journal}/`)}">Journal ${m.journal}</a></li>${m.measure ? `<li><a href="${u(`/assembly/${m.measure}/`)}">${esc(m.measure)}</a></li>` : ''}</ul>` : ''}
    ${back2.length ? `<h2>Cited by</h2><ul class="list">${back2.map((l) => `<li><a href="${u(l.href)}">${esc(l.label)}</a><span class="meta">${esc(String(l.at || '').slice(0, 10))}</span></li>`).join('')}</ul>` : ''}`,
  { on: 'journal/law', narrow: true, script: `
    for (const b of document.querySelectorAll('[data-copy]')) b.onclick = () => {
      navigator.clipboard.writeText(b.dataset.copy + '  ' + location.href);
      b.textContent = 'copied'; setTimeout(() => b.textContent = 'copy citation', 1200);
    };` }));
}

function statuteSections(secs, slugId) {
  return secs.map((sec) => {
    const c = `stat.${slugId}/§${sec.num}`;
    return `<section class="sec" id="s${sec.num}">
      <h2><span class="n">§ ${sec.num}</span> ${esc(sec.heading)}
        <a class="anchor" href="#s${sec.num}" data-cite="${c}" title="copy citation">§</a></h2>
      ${sec.paragraphs.map((p) => para(p.num, p.text, `s${sec.num}p${p.num}`, `${c}/¶${p.num}`)).join('')}
    </section>`;
  }).join('');
}

// ---- value: accounts, instruments, exchange, contracts ---------------------

const holdingsOf = (a) => [...(V.holdings.get(a) || new Map())].filter(([, q]) => q > 0);
const UNIT_ = null;
const instrumentList = [...V.instruments.entries()];

write('treasury', page('Value', `
  <h1>Value<span class="sub">The ${esc(UNIT)} has no value outside the Republic and may not be sold, redeemed, or exchanged — art-09/§48/¶2.</span></h1>

  <h2>Your accounts</h2>
  <p id="whoacct" class="quiet">Load a key to see what you hold. See <a href="${u('/key/')}">Your key</a>.</p>
  <table id="myaccounts" hidden><thead><tr><th>Account</th><th>Kind</th><th>${esc(UNIT[0].toUpperCase() + UNIT.slice(1))}s</th><th>Instruments</th></tr></thead>
  <tbody></tbody></table>
  <p class="note">Only the accounts your key may act for are shown. The register itself is public; what you hold is not broadcast on a page anyone may open.</p>

  <h2>In circulation</h2>
  <table><tbody>
    <tr><td class="q">Issued in total</td><td>${V.issued}</td></tr>
    <tr><td class="q">Accounts</td><td>${ACCTS.size}</td></tr>
    <tr><td class="q">Held by the Treasury</td><td>${V.balances.get(TREASURY) || 0}</td></tr>
  </tbody></table>
  <p class="note">A transfer neither creates nor destroys value — art-02/§12/¶2. Every movement is a record in the ledger, which is public.</p>

  <h2>Instruments</h2>
  ${instrumentList.length ? `<table><thead><tr><th>Instrument</th><th>Issuer</th><th>Issued</th></tr></thead>
  <tbody>${instrumentList.map(([i, m]) => `<tr><td>${esc(i)}</td>
    <td><a href="${u(`/entities/${m.issuer}/`)}">${esc(m.issuer)}</a></td><td class="q">${m.issued}</td></tr>`).join('')}</tbody></table>`
  : '<p class="quiet">None issued. A company may issue a share in itself — art-09/§51/¶1.</p>'}

  <h2 id="issuehead" hidden>Issue</h2>
  <div id="issuebox" hidden>
    <p class="quiet">Only the Treasurer may issue, only under a resolution of the Assembly, and only in the amount it states — art-09/§49/¶1.</p>
    <label for="ires">Resolution that authorises it</label><select id="ires"></select>
    <label for="iamt">Amount</label><input type="text" id="iamt" inputmode="numeric">
    <label for="ito2">To</label><select id="ito2"></select>
    <div class="row"><button id="isign">Sign the issue</button><a id="icommit" class="button" hidden>Open on GitHub</a></div>
    <div class="out" id="iout" hidden></div>
  </div>

  <h2>Transfer</h2>
  <p id="msg" class="msg quiet"></p>
  <label for="tfrom">From</label><select id="tfrom"></select>
  <label for="tto">To</label><select id="tto"></select>
  <label for="twhat">What</label><select id="twhat"><option value="unit">${esc(UNIT)}s</option>${instrumentList.map(([i]) => `<option value="${esc(i)}">${esc(i)}</option>`).join('')}</select>
  <label for="tamt">Amount</label><input type="text" id="tamt" inputmode="numeric">
  <label for="tnote">Note (optional)</label><input type="text" id="tnote">
  <div class="row"><button id="tsign" disabled>Sign transfer</button><a id="tcommit" class="button" hidden>Open on GitHub</a></div>
  <div class="out" id="tout" hidden></div>
  <p class="note">A transfer is signed here and settled by the workflow, which checks the balance and records it — art-09/§50/¶2.</p>`,
{ on: 'treasury', script: IDENT + `
  const accts = await getJSON('${u('/data/accounts.json')}');
  const mine = () => accts.filter((a) => a.id === me || (a.organs || []).some((o) => (o.held_by || []).includes(me)) || (a.id === 'treasury' && a.officer === me));
  function showMine() {
    const rows = mine();
    const t = $('myaccounts');
    if (!rows.length) { t.hidden = true; $('whoacct').textContent = me ? me + ' holds no account.' : 'Load a key to see what you hold.'; return; }
    t.hidden = false;
    $('whoacct').textContent = '';
    t.querySelector('tbody').innerHTML = rows.map((a) =>
      '<tr><td>' + a.id + '</td><td class="q">' + a.kind + '</td><td>' + (a.balance || 0) + '</td><td class="q">' +
      ((a.holdings || []).map((h) => h.quantity + ' × ' + h.instrument).join('<br>') || '—') + '</td></tr>').join('');
  }
  // art-09/§49/¶1 — the issue form belongs to whoever holds value.issue.
  const offs2 = await getJSON('${u('/data/offices.json')}');
  const carried = await getJSON('${u('/data/carried.json')}');
  function issueBox() {
    const may = offs2.some((o) => o.holder === me && (o.permissions || []).includes('value.issue'));
    $('issuehead').hidden = !may; $('issuebox').hidden = !may;
    if (!may) return;
    $('ires').innerHTML = carried.length
      ? carried.map((m) => '<option value="' + m.id + '">' + m.id + ' — ' + m.title + '</option>').join('')
      : '<option value="">no measure has carried</option>';
    $('ito2').innerHTML = accts.map((a) => '<option' + (a.id === 'treasury' ? ' selected' : '') + '>' + a.id + '</option>').join('');
  }
  if ($('isign')) $('isign').onclick = async () => {
    try {
      if (!me) throw new Error('load a key that is on the register');
      const amount = Number($('iamt').value);
      if (!amount || amount <= 0) throw new Error('give an amount');
      const resolution = $('ires').value;
      if (!resolution) throw new Error('an issue must cite the resolution that authorises it — art-09/§49/¶1');
      const body = { kind: 'value-issue', amount, to: $('ito2').value, resolution, by: me,
        at: new Date().toISOString(),
        salt: [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('') };
      body.signature = await R.sign(R.canonical(body), priv, { namespace: 'republic' });
      $('iout').hidden = false; $('iout').textContent = JSON.stringify(body, null, 2);
      const name = body.at.replace(/[:.]/g, '-') + '-issue';
      $('icommit').href = R.commitUrl(meta.repo, meta.branch, 'transfers/' + name + '.json', JSON.stringify(body, null, 2), 'issue ' + amount + ' under ' + resolution);
      $('icommit').hidden = false;
      $('msg').className = 'msg'; $('msg').textContent = 'Signed. Commit it; the settle workflow records the issue.';
    } catch (e) { problem('could not sign', e); }
  };
  document.addEventListener('identity', issueBox);

  function fill() {
    issueBox();
    showMine();
    $('tfrom').innerHTML = mine().map((a) => '<option>' + a.id + '</option>').join('') || '<option value="">no account</option>';
    $('tto').innerHTML = accts.map((a) => '<option>' + a.id + '</option>').join('');
    $('tsign').disabled = !(priv && me && mine().length);
  }
  document.addEventListener('identity', fill); fill();

  $('tsign').onclick = async () => {
    try {
      if (!me) throw new Error('load a key that is on the register');
      const n = Number($('tamt').value);
      if (!n || n <= 0) throw new Error('give an amount');
      const what = $('twhat').value;
      const body = { kind: what === 'unit' ? 'transfer' : 'instrument-transfer',
        from: $('tfrom').value, to: $('tto').value, by: me,
        ...(what === 'unit' ? { amount: n } : { instrument: what, quantity: n }),
        ...($('tnote').value ? { note: $('tnote').value } : {}),
        at: new Date().toISOString(), salt: [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('') };
      if (body.from === body.to) throw new Error('from and to are the same account');
      body.signature = await R.sign(R.canonical(body), priv, { namespace: 'republic' });
      $('tout').hidden = false; $('tout').textContent = JSON.stringify(body, null, 2);
      const name = body.at.replace(/[:.]/g, '-') + '-' + body.from + '-' + body.to;
      $('tcommit').href = R.commitUrl(meta.repo, meta.branch, 'transfers/' + name + '.json', JSON.stringify(body, null, 2), 'transfer ' + body.from + ' to ' + body.to);
      $('tcommit').hidden = false;
      $('msg').className = 'msg'; $('msg').textContent = 'Signed. Commit it, then run the settle workflow.';
    } catch (e) { problem('could not sign', e); }
  };` }));

// Pending orders are files; they clear at the next auction. Publishing them is
// art-09/§52/¶3 — every order, every clearing, and every price is published.
const pendingOrders = (() => {
  const d = path.join(ROOT, 'orders');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
})();

const bookFor = (inst) => {
  const os = pendingOrders.filter((o) => o.instrument === inst);
  return {
    bids: os.filter((o) => o.side === 'buy').sort((a, b) => b.price - a.price),
    asks: os.filter((o) => o.side === 'sell').sort((a, b) => a.price - b.price),
  };
};

// The price the next auction would clear at, computed the same way settle does.
const indicative = (inst) => {
  const { bids, asks } = bookFor(inst);
  if (!bids.length || !asks.length) return null;
  let best = null;
  for (const p of [...new Set([...bids, ...asks].map((o) => o.price))].sort((a, b) => a - b)) {
    const demand = bids.filter((o) => o.price >= p).reduce((s, o) => s + o.quantity, 0);
    const supply = asks.filter((o) => o.price <= p).reduce((s, o) => s + o.quantity, 0);
    const volume = Math.min(demand, supply);
    if (!best || volume > best.volume) best = { price: p, volume };
  }
  return best && best.volume ? best : null;
};

const trades = events.filter((e) => e.kind === 'order.matched');

write('exchange', page('Exchange', `
  <h1>Exchange<span class="sub">Cleared by periodic auction at a uniform price, with no priority to the order of arrival — art-09/§52/¶2.</span></h1>

  ${instrumentList.length ? instrumentList.map(([inst, m]) => {
    const { bids, asks } = bookFor(inst);
    const ind = indicative(inst);
    const last = trades.filter((t) => t.payload.instrument === inst).slice(-1)[0];
    return `<h2>${esc(inst)}</h2>
    <table><tbody>
      <tr><td class="q">Issuer</td><td><a href="${u(`/entities/${m.issuer}/`)}">${esc(m.issuer)}</a></td></tr>
      <tr><td class="q">Issued</td><td>${m.issued}</td></tr>
      <tr><td class="q">Last price</td><td>${last ? last.payload.price + ' ' + esc(UNIT) : '—'}</td></tr>
      <tr><td class="q">Next auction would clear</td><td>${ind ? `${ind.volume} at ${ind.price} ${esc(UNIT)}` : 'nothing — no crossing orders'}</td></tr>
    </tbody></table>
    <table><thead><tr><th>Bids</th><th>Asks</th></tr></thead><tbody><tr>
      <td>${bids.length ? bids.map((o) => `${o.quantity} @ ${o.price} <span class="q">${esc(o.account)}</span>`).join('<br>') : '<span class="q">none</span>'}</td>
      <td>${asks.length ? asks.map((o) => `${o.quantity} @ ${o.price} <span class="q">${esc(o.account)}</span>`).join('<br>') : '<span class="q">none</span>'}</td>
    </tr></tbody></table>`;
  }).join('') : '<p class="quiet">No instrument has been issued, so there is nothing to trade. A company may issue a share in itself — art-09/§51/¶1.</p>'}

  ${instrumentList.length ? `
  <h2>Place an order</h2>
  <p id="msg" class="msg quiet"></p>
  <label for="oside">Side</label><select id="oside"><option value="buy">buy</option><option value="sell">sell</option></select>
  <label for="oinst">Instrument</label><select id="oinst">${instrumentList.map(([i]) => `<option>${esc(i)}</option>`).join('')}</select>
  <label for="oacct">Account</label><select id="oacct"></select>
  <label for="oqty">Quantity</label><input type="text" id="oqty" inputmode="numeric">
  <label for="oprice">Price in ${esc(UNIT)}s</label><input type="text" id="oprice" inputmode="numeric">
  <div class="row"><button id="osign" disabled>Sign order</button><a id="ocommit" class="button" hidden>Open on GitHub</a></div>
  <div class="out" id="oout" hidden></div>
  <p class="note">An order does not execute on arrival. It joins the book and clears at the next auction, at one price for everyone — art-09/§52/¶2.</p>` : ''}

  <h2>Trades</h2>
  <table><thead><tr><th>Instrument</th><th>Seller</th><th>Buyer</th><th>Quantity</th><th>Price</th><th>When</th></tr></thead>
  <tbody>${trades.slice().reverse().map((e) => `<tr>
    <td>${esc(e.payload.instrument)}</td><td class="q">${esc(e.payload.seller)}</td><td class="q">${esc(e.payload.buyer)}</td>
    <td>${e.payload.quantity}</td><td>${e.payload.price}</td><td class="q">${esc(e.at.slice(0, 10))}</td></tr>`).join('')
    || '<tr><td colspan="6" class="q">No trades yet.</td></tr>'}</tbody></table>`,
{ on: 'treasury', script: IDENT + `
  const accts = await getJSON('${u('/data/accounts.json')}');
  const mine = () => accts.filter((a) => a.id === me || (a.organs || []).some((o) => (o.held_by || []).includes(me)));
  function fill() {
    if (!$('oacct')) return;
    $('oacct').innerHTML = mine().map((a) => '<option>' + a.id + '</option>').join('') || '<option value="">no account</option>';
    $('osign').disabled = !(priv && me && mine().length);
  }
  document.addEventListener('identity', fill); fill();
  if ($('osign')) $('osign').onclick = async () => {
    try {
      if (!me) throw new Error('load a key that is on the register');
      const q = Number($('oqty').value), pr = Number($('oprice').value);
      if (!q || !pr) throw new Error('give a quantity and a price');
      const body = { kind: 'order', side: $('oside').value, instrument: $('oinst').value,
        quantity: q, price: pr, account: $('oacct').value, by: me, at: new Date().toISOString(),
        salt: [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('') };
      body.signature = await R.sign(R.canonical(body), priv, { namespace: 'republic' });
      $('oout').hidden = false; $('oout').textContent = JSON.stringify(body, null, 2);
      const name = body.at.replace(/[:.]/g, '-') + '-' + body.account + '-' + body.side;
      $('ocommit').href = R.commitUrl(meta.repo, meta.branch, 'orders/' + name + '.json', JSON.stringify(body, null, 2), 'order ' + body.side + ' ' + body.instrument);
      $('ocommit').hidden = false;
      $('msg').className = 'msg'; $('msg').textContent = 'Signed. Commit it; it clears at the next auction.';
    } catch (e) { problem('could not sign', e); }
  };` }));

write('contracts', page('Contracts', `
  <h1>Contracts<span class="sub">Drafted by one party, executed when every party has signed.</span></h1>
  <ul class="list">${CONTRACTS.length ? CONTRACTS.map((c) => {
    const signed = c.signatures.map((s) => s.by);
    const need = [].concat(c.parties || []);
    return `<li><a href="${u(`/contracts/${c.id}/`)}">${esc(c.title || c.id)}</a>
      <span class="meta">${need.map((x) => esc(x) + (signed.includes(x) ? ' ✓' : ' —')).join('  ')}</span></li>`;
  }).join('') : '<li class="quiet">None yet.</li>'}</ul>`, { on: 'treasury', narrow: true }));

for (const c of CONTRACTS) {
  const need = [].concat(c.parties || []);
  const signed = c.signatures.map((s) => s.by);
  write(`contracts/${c.id}`, page(c.title || c.id, `
    <p class="crumb"><a href="${u('/contracts/')}">Contracts</a> · ${esc(c.id)}</p>
    <h1>${esc(c.title || c.id)}<span class="sub">${c.executed ? 'executed ' + esc(isoDate(c.executed)) : 'awaiting signature'} · drafted ${esc(isoDate(c.drafted))}</span></h1>
    <h2>Parties</h2>
    <table><tbody>${need.map((x) => `<tr><td>${esc(x)}</td><td class="q">${signed.includes(x) ? 'signed' : 'not yet signed'}</td></tr>`).join('')}</tbody></table>
    <article class="law">${markdown(c.body)}</article>
    <h2>Sign</h2>
    <p id="msg" class="msg quiet"></p>
    <div class="row"><button id="csign" disabled>Sign this contract</button><a id="ccommit" class="button" hidden>Open on GitHub</a></div>
    <div class="out" id="cout" hidden></div>
    <p class="note">A signature covers the text as it now stands. An alteration afterwards voids every signature given — § 3 ³.</p>`,
  { on: 'treasury', narrow: true, script: IDENT + `
    const parties = ${JSON.stringify(need)};
    const text = await (await fetch('${u(`/data/contracts/${c.id}.txt`)}')).text();
    function ok() { $('csign').disabled = !(priv && me && parties.includes(me)); }
    document.addEventListener('identity', ok); ok();
    $('csign').onclick = async () => {
      try {
        if (!parties.includes(me)) throw new Error('you are not a party to this contract');
        const body = { kind: 'contract-signature', contract: ${JSON.stringify(c.id)}, party: me, by: me,
          document: await R.sha256(text), at: new Date().toISOString(),
          salt: [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('') };
        body.signature = await R.sign(R.canonical(body), priv, { namespace: 'republic' });
        $('cout').hidden = false; $('cout').textContent = JSON.stringify(body, null, 2);
        $('ccommit').href = R.commitUrl(meta.repo, meta.branch, 'contracts/${c.id}/' + me + '.json', JSON.stringify(body, null, 2), 'sign ${c.id}');
        $('ccommit').hidden = false;
        $('msg').className = 'msg'; $('msg').textContent = 'Signed. Commit it; the contract executes when every party has.';
      } catch (e) { problem('could not sign', e); }
    };` }));
}

const judges = offs.filter((o) => (o.permissions || []).includes('court.judge'));

write('journal/court', page('Court', `
  <h1>Court<span class="sub">Decides disputes under this Constitution, reviews acts for consistency with it, and construes the text — art-06/§31/¶2.</span></h1>

  <h2>The bench</h2>
  ${judges.length ? `<table><thead><tr><th>Judge</th><th>Until</th><th>May</th></tr></thead>
  <tbody>${judges.map((o) => `<tr><td>${esc(o.holder)}</td><td class="q">${esc(isoDate(o.term_ends))}</td>
    <td class="q">halt an act within its window · declare an act of no effect · give judgment</td></tr>`).join('')}</tbody></table>
  <p class="note">The Court may not transfer value and holds no permission over the Treasury — art-06/§31/¶4.</p>`
  : '<p class="quiet">No Judge is elected, so the Assembly exercises the Court\u2019s functions — art-06/§31/¶1.</p>'}

  <h2>Cases</h2>
  <ul class="list">${C.judgments.length ? C.judgments.slice().reverse().map((j) =>
    `<li><a href="${u(`/journal/court/${j.number}/`)}">${esc(j.title || 'Case ' + j.number)}</a>
      <span class="meta">${esc(j.holding || 'undecided')}</span></li>`).join('')
    : '<li class="quiet">No case has been brought.</li>'}</ul>

  <h2>Bring a case</h2>
  <p id="msg" class="msg quiet"></p>
  <label for="cagainst">The act complained of</label><input type="text" id="cagainst" placeholder="P-0004, or stat.some-statute">
  <label for="cseek">Seeking</label>
  <select id="cseek">
    <option value="construe">that a provision be construed — art-06/§31/¶2</option>
    <option value="halt">that the act be halted within its window — art-06/§31/¶3</option>
    <option value="void">that the act be declared of no effect — art-06/§31/¶3</option>
    <option value="remedy">a remedy under Article 7 — art-07/§25/¶2</option>
  </select>
  <label for="cconstrues">Provisions construed, comma separated</label><input type="text" id="cconstrues" placeholder="art-08/§41/¶3">
  <label for="cground">Ground</label><textarea id="cground" rows="5"></textarea>
  <div class="row"><button id="cfile" disabled>Prepare the application</button><a id="ccommit" class="button" hidden>Open on GitHub</a></div>
  <div class="out" id="cout" hidden></div>`,
{ on: 'journal/court', narrow: true, script: IDENT + `
  const resolve = await getJSON('${u('/data/resolve.json')}');
  const next = ${C.judgments.reduce((n, j) => Math.max(n, j.number || 0), 0) + 1};
  const ok = () => { $('cfile').disabled = !(priv && me); };
  document.addEventListener('identity', ok); ok();
  $('cfile').onclick = () => {
    try {
      if (!me) throw new Error('load a key that is on the register');
      const against = $('cagainst').value.trim();
      const ground = $('cground').value.trim();
      if (!against) throw new Error('name the act complained of');
      if (!ground) throw new Error('state the ground');
      const construes = $('cconstrues').value.split(',').map((s) => s.trim()).filter(Boolean);
      const bad = construes.filter((c) => !resolve[c] && !resolve['const.' + c]);
      if (bad.length) throw new Error('does not resolve: ' + bad.join(', '));
      const today = new Date().toISOString().slice(0, 10);
      const seeking = $('cseek').value;
      const md = ['---', 'number: ' + next, 'title: ' + me + ' v ' + against, 'against: ' + against,
        'applicant: ' + me, 'seeking: ' + seeking, 'filed: ' + today,
        'construes: [' + construes.join(', ') + ']', 'cites: [art-06/§31/¶2, art-07/§36/¶2]', '---', '',
        '## § 1  The application', '', '¹ ' + me + ' applies in respect of ' + against + '.', '',
        '## § 2  Ground', '', '¹ ' + ground, '',
        '## § 3  Answer', '', '¹ *To be completed by the respondent, or left blank.*', ''].join('\\n');
      $('cout').hidden = false; $('cout').textContent = md;
      const slug = String(next).padStart(4, '0') + '-' + against.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      $('ccommit').href = R.commitUrl(meta.repo, meta.branch, 'journal/judgments/' + slug + '.md', md, 'case ' + next);
      $('ccommit').hidden = false;
      $('msg').className = 'msg'; $('msg').textContent = 'Prepared. Commit it to bring the case.';
    } catch (e) { problem('could not file', e); }
  };` }));

for (const j of C.judgments) {
  write(`journal/court/${j.number}`, page(j.title || `Case ${j.number}`, `
    <p class="crumb"><a href="${u('/journal/court/')}">Court</a> · case ${j.number}</p>
    <h1>${esc(j.title || 'Case ' + j.number)}<span class="sub">${esc(j.holding ? 'decided ' + isoDate(j.decided) + ' — ' + j.holding : 'undecided')} · filed ${esc(isoDate(j.filed))}</span></h1>
    <table><tbody>
      <tr><td class="q">Applicant</td><td>${esc(j.applicant || '')}</td></tr>
      <tr><td class="q">Act complained of</td><td>${link(String(j.against || ''))}</td></tr>
      <tr><td class="q">Seeking</td><td>${esc(j.seeking || '')}</td></tr>
      ${j.bench ? `<tr><td class="q">Bench</td><td>${esc(j.bench)}</td></tr>` : ''}
    </tbody></table>
    <article class="law">${markdown(j.body)}</article>
    ${[].concat(j.construes || []).length ? `<h2>Provisions construed</h2><ul class="list">${[].concat(j.construes).map((c) => `<li>${link(String(c))}</li>`).join('')}</ul>` : ''}`,
  { on: 'journal/court', narrow: true }));
}

write('journal', page('Journal', `
  <h1>Journal<span class="sub">Everything the Republic has published. Publication is promulgation — art-05/§25/¶2.</span></h1>
  <table><tbody>
    <tr><td><a href="${u('/journal/constitution/')}">Constitution</a></td><td class="q">${C.constitution.articles.length} articles · the highest law</td></tr>
    <tr><td><a href="${u('/journal/law/')}">Law</a></td><td class="q">${C.statutes.length} statute${C.statutes.length === 1 ? '' : 's'} in force</td></tr>
    <tr><td><a href="${u('/journal/court/')}">Court</a></td><td class="q">${C.judgments.length} case${C.judgments.length === 1 ? '' : 's'}</td></tr>
    <tr><td><a href="${u('/journal/issues/')}">Issues</a></td><td class="q">${C.journal.length} issue${C.journal.length === 1 ? '' : 's'} of the Journal proper</td></tr>
  </tbody></table>
  <p class="note">On disk this is one directory: journal/constitution, journal/law, journal/court, journal/issues. The site follows the corpus rather than inventing a second arrangement.</p>`,
  { on: 'journal/issues', narrow: true }));

write('journal/issues', page('Journal', `
  <h1>Journal<span class="sub">Publication is promulgation — art-05/§25/¶2.</span></h1>
  <ul class="list">${C.journal.slice().reverse().map((j) =>
    `<li><a href="${u(`/journal/issues/${j.number}/`)}">No. ${j.number} · ${esc(issueTitle(j))}</a><span class="meta">${esc(j.date)}</span></li>`).join('')
    || '<li class="quiet">No issues yet.</li>'}</ul>`, { on: 'journal/issues', narrow: true }));

for (const j of C.journal) {
  const links = [].concat(j.cites || []);
  write(`journal/issues/${j.number}`, page(issueTitle(j), `
    <p class="crumb"><a href="${u('/journal/issues/')}">Journal</a> · No. ${j.number}</p>
    <h1>${esc(issueTitle(j))}<span class="sub">No. ${j.number} · ${esc(j.date)}${j.measure ? ' · ' + esc(j.measure) : ''}</span></h1>
    <article class="law">${markdown(j.body)}</article>
    ${(() => {
      if (!j.statute) return '';
      const st = C.statutes.find((x) => x.slug === j.statute);
      if (!st) return `<p class="note">The text in force is stat.${esc(j.statute)}, which is not in the corpus.</p>`;
      const m = st.versions.en || Object.values(st.versions)[0] || {};
      return `<h2>The text in force</h2>
        <p class="quiet">stat.${esc(j.statute)}${m.version ? ', version ' + m.version : ''} — the text as it now stands, kept once and shown here.
        <a href="${u(`/journal/law/${j.statute}/`)}">Open the statute</a>.</p>
        <article class="law">${statuteSections(m.sections || [], j.statute)}</article>`;
    })()}
    ${links.length ? `<h2>Made under</h2><ul class="list">${links.map((c) => `<li>${link(String(c))}</li>`).join('')}</ul>` : ''}
    ${j.measure ? `<h2>The measure</h2><ul class="list"><li><a href="${u(`/assembly/${j.measure}/`)}">${esc(j.measure)}</a>${j.elected ? ` <span class="meta">elected ${esc(j.elected)}</span>` : ''}</li></ul>` : ''}`,
  { on: 'journal/issues', narrow: true }));
}

write('register', page('Register', `
  <h1>Register</h1>
  <h2>Citizens</h2>
  <table><thead><tr><th>Citizenship</th><th>Status</th><th>Admitted</th></tr></thead>
  <tbody>${roll.map((c) => `<tr><td>${esc(c.id)}</td><td${c.status === 'active' ? '' : ' class="q"'}>${esc(c.status)}</td>
    <td class="q">${esc(isoDate(c.admitted))}</td></tr>`).join('')}</tbody></table>
  <p class="quiet">The register names no person; only identifiers appear — art-07/§37/¶2.</p>

  <h2>Form an entity</h2>
  <p id="emsg" class="msg quiet"></p>
  <label for="ename">Name</label><input type="text" id="ename">
  <label for="etype">Type</label><select id="etype"></select>
  <label for="epurpose">Purpose</label><textarea id="epurpose" rows="3"></textarea>
  <label for="eunder">Measure that establishes it, if its type requires one</label><input type="text" id="eunder" placeholder="P-0007">
  <div class="row"><button id="eform" disabled>Prepare</button><a id="ecommit" class="button" hidden>Open on GitHub</a></div>
  <div class="out" id="eout" hidden></div>

  <h2>Entities</h2>
  ${ents.length ? `<table><thead><tr><th>Entity</th><th>Type</th><th>Name</th></tr></thead>
  <tbody>${ents.map((e) => `<tr><td><a href="${u(`/entities/${e.id}/`)}">${esc(e.id)}</a></td>
    <td class="q">${esc(e.type)}</td><td>${esc(nameOf(e))}</td></tr>`).join('')}</tbody></table>`
    : '<p class="quiet">None yet. Any citizen may form one — art-04/§19/¶1.</p>'}

  <h2>Checkpoints</h2>
  <table><thead><tr><th>No.</th><th>Records</th><th>Root</th></tr></thead>
  <tbody>${checkpoints.slice().reverse().map((c) => `<tr><td>${c.number}</td><td class="q">${c.records}</td>
    <td class="q">${esc(c.root.slice(0, 20))}…</td></tr>`).join('') || '<tr><td colspan="3" class="q">None yet.</td></tr>'}</tbody></table>`,
  { on: 'register', narrow: true, script: IDENT + `
  const types = meta.parameters.entities.types;
  const existing = await getJSON('${u('/data/entities.json')}');
  $('etype').innerHTML = Object.entries(types).map(([k, t]) =>
    '<option value="' + k + '">' + t.label + (t.formation === 'law' ? ' — requires a carried measure' : ' — as of right') + '</option>').join('');
  const ok = () => { $('eform').disabled = !(priv && me); };
  document.addEventListener('identity', ok); ok();
  $('eform').onclick = () => {
    try {
      if (!me) throw new Error('load a key that is on the register');
      const name = $('ename').value.trim();
      if (!name) throw new Error('give it a name');
      const type = $('etype').value, rule = types[type];
      const under = $('eunder').value.trim();
      if (rule.formation === 'law' && !under)
        throw new Error('a ' + type + ' is formed only on a carried measure, and only the Registrar may enter it — art-04/§20/¶3');
      const id = 'e-' + String(existing.length + 1).padStart(4, '0');
      const today = new Date().toISOString().slice(0, 10);
      const yml = ['id: ' + id, 'type: ' + type, 'name: ' + name, 'formed: ' + today, 'formed_by: ' + me,
        'formed_under: ' + (rule.formation === 'law' ? 'art-04/§20/¶3' : 'art-04/§19/¶1'),
        ...(under ? ['established_by_measure: ' + under] : []),
        'charter: charters/' + id + '.md', 'organs:', '  - name: convenor', '    held_by: [' + me + ']',
        'members: [' + me + ']', 'status: active', ''].join('\\n');
      $('eout').hidden = false; $('eout').textContent = yml;
      $('ecommit').href = R.commitUrl(meta.repo, meta.branch, 'register/entities/' + id + '.yml', yml, 'form ' + id);
      $('ecommit').hidden = false;
      $('emsg').className = 'msg';
      $('emsg').textContent = rule.formation === 'law'
        ? 'Prepared under ' + under + '. Only the Registrar may commit it — art-04/§20/¶3.'
        : 'Prepared. No permission is required — art-04/§19/¶1. Commit it, then write the charter.';
    } catch (e) { problem('could not form', e); }
  };` }));

for (const e of ents) {
  const secs = e.charterBody ? parseCharter(e.charterBody) : [];
  const type = P.entities.types[e.type] || {};
  const mine = instrumentList.filter(([, m]) => m.issuer === e.id);
  const bal = V.balances.get(e.id) || 0;
  const holds = holdingsOf(e.id);

  fs.mkdirSync(path.join(OUT, 'data/charters'), { recursive: true });
  if (e.charterBody) fs.writeFileSync(path.join(OUT, `data/charters/${e.id}.md`), e.charterBody);

  write(`entities/${e.id}`, page(nameOf(e), `
    <p class="crumb"><a href="${u('/register/')}">Register</a> · ${esc(e.id)}</p>
    <h1>${esc(nameOf(e))}<span class="sub">${esc(type.label || e.type)} · formed ${esc(isoDate(e.formed))} under ${esc(e.formed_under || 'art-04/§19/¶1')}${e.status !== 'active' ? ' · ' + esc(e.status) : ''}</span></h1>

    <table><tbody>
      <tr><td class="q">Organs</td><td>${(e.organs || []).map((o) => `${esc(o.name)}: ${(o.held_by || []).join(', ')}`).join('<br>') || '—'}</td></tr>
      <tr><td class="q">Members</td><td>${(e.members || []).join(', ') || '—'}</td></tr>
      <tr><td class="q">Holds</td><td>${bal} ${esc(UNIT)}${holds.length ? '<br>' + holds.map(([i, q]) => `${q} × ${esc(i)}`).join('<br>') : ''}</td></tr>
      <tr><td class="q">May issue shares</td><td class="q">${type.may_issue_instruments ? 'yes — art-09/§51/¶1' : 'no — art-04/§20/¶3'}</td></tr>
    </tbody></table>

    ${secs.length ? `<h2>Charter</h2><article class="law">${sections(secs, null)}</article>` : `
    <h2>Charter</h2>
    <p class="quiet">${esc(e.id)} has no charter yet. Every entity has one — art-04/§21/¶1. An entity formed on the website starts without it, because one commit creates one file.</p>
    <div class="row"><a class="button" target="_blank" rel="noopener" href="${esc(
      `https://github.com/${REPO}/new/${BRANCH}?filename=${e.charter || `charters/${e.id}.md`}&value=${encodeURIComponent(defaultCharter({
        id: e.id, type: e.type, name: nameOf(e), organs: e.organs || [], today: isoDate(e.formed),
      }))}&message=${encodeURIComponent('charter of ' + e.id)}`
    )}">Create the charter</a></div>`}

    ${mine.length ? `<h2>Instruments</h2>
    <table><thead><tr><th>Instrument</th><th>Issued</th></tr></thead>
    <tbody>${mine.map(([i, m]) => `<tr><td>${esc(i)}</td><td class="q">${m.issued}</td></tr>`).join('')}</tbody></table>` : ''}

    <hr class="rule">
    <h2>Manage</h2>
    <p id="msg" class="msg quiet">Load a key that is an organ of ${esc(e.id)} to act for it.</p>
    <div id="console" hidden>

      ${type.may_issue_instruments ? `
      <h3>Issue a share</h3>
      <label for="icls">Class</label><input type="text" id="icls" value="ordinary">
      <label for="iqty">Quantity</label><input type="text" id="iqty" inputmode="numeric">
      <label for="ito">To</label><input type="text" id="ito" value="${esc(e.id)}">
      <div class="row"><button data-act="issue">Sign</button></div>` : ''}

      <h3>Transfer</h3>
      <label for="twhat">What</label><select id="twhat"><option value="unit">${esc(UNIT)}s</option>${holds.map(([i]) => `<option value="${esc(i)}">${esc(i)}</option>`).join('')}</select>
      <label for="tto">To</label><select id="tto">${[...ACCTS.keys()].filter((x) => x !== e.id).map((x) => `<option>${esc(x)}</option>`).join('')}</select>
      <label for="tamt">Amount</label><input type="text" id="tamt" inputmode="numeric">
      <div class="row"><button data-act="transfer">Sign</button></div>

      <h3>Trade</h3>
      <label for="oside">Side</label><select id="oside"><option value="sell">sell</option><option value="buy">buy</option></select>
      <label for="oinst">Instrument</label><select id="oinst">${instrumentList.map(([i]) => `<option>${esc(i)}</option>`).join('') || '<option value="">none issued</option>'}</select>
      <label for="oqty">Quantity</label><input type="text" id="oqty" inputmode="numeric">
      <label for="oprice">Price</label><input type="text" id="oprice" inputmode="numeric">
      <div class="row"><button data-act="order">Sign</button></div>

      <h3>Members</h3>
      <label for="mwho">Citizenships, comma separated</label><input type="text" id="mwho" placeholder="c-0007, c-0008">
      <div class="row"><button data-act="admit">Admit</button><button data-act="remove">Remove</button></div>

      <h3>Organs</h3>
      <p class="quiet">art-04/§21/¶2 — an organ holds only the authority the charter confers.</p>
      <label for="oset">role=citizen, separated by commas; several holders with /</label>
      <input type="text" id="oset" value="${esc((e.organs || []).map((o) => `${o.name}=${(o.held_by || []).join('/')}`).join(', '))}">
      <div class="row"><button data-act="organs">Sign</button></div>

      <h3>Charter</h3>
      <p class="quiet">art-04/§21/¶3 — a charter must not be inconsistent with the Constitution.</p>
      <textarea id="ctext" rows="14"></textarea>
      <div class="row"><button data-act="charter">Sign</button></div>

      <h3>Dissolve</h3>
      <p class="quiet">art-04/§23/¶2 — on dissolution its holdings pass as the charter provides, and failing that to the Treasury.</p>
      <div class="row"><button data-act="dissolve">Sign dissolution</button></div>

      <div class="out" id="out" hidden></div>
      <div class="row"><a id="commit" class="button" hidden>Open on GitHub</a></div>
    </div>`,
  { on: 'register', narrow: true, script: IDENT + `
    const ENTITY = ${JSON.stringify(e.id)};
    const organs = ${JSON.stringify(e.organs || [])};
    const isOrgan = () => organs.some((o) => (o.held_by || []).includes(me));
    function gate() {
      const ok = priv && me && isOrgan();
      $('console').hidden = !ok;
      $('msg').textContent = ok ? 'Acting for ' + ENTITY + ' as ' + me + '.'
        : me ? me + ' is not an organ of ' + ENTITY + ' — art-04/§21/¶2.'
        : 'Load a key that is an organ of ' + ENTITY + ' to act for it.';
      $('msg').className = 'msg' + (me && !isOrgan() ? ' bad' : '');
    }
    document.addEventListener('identity', gate); gate();

    try { $('ctext').value = await (await fetch('${u(`/data/charters/${e.id}.md`)}')).text(); }
    catch { $('ctext').value = ${JSON.stringify(defaultCharter({ id: e.id, type: e.type, name: nameOf(e), organs: e.organs || [], today: isoDate(e.formed) }))}; }

    const rand = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const num = (id) => { const v = Number($(id).value); if (!v || v <= 0) throw new Error('give a positive number'); return v; };

    async function offer(body, dir, note) {
      body.signature = await R.sign(R.canonical(body), priv, { namespace: 'republic' });
      $('out').hidden = false; $('out').textContent = JSON.stringify(body, null, 2);
      const name = body.at.replace(/[:.]/g, '-') + '-' + ENTITY + '-' + (body.kind || 'act').replace(/\\./g, '-');
      $('commit').href = R.commitUrl(meta.repo, meta.branch, dir + '/' + name + '.json', JSON.stringify(body, null, 2), note);
      $('commit').hidden = false;
      $('msg').className = 'msg'; $('msg').textContent = 'Signed. Commit it; the settle workflow applies it.';
    }

    for (const b of document.querySelectorAll('[data-act]')) b.onclick = async () => {
      try {
        if (!isOrgan()) throw new Error('you are not an organ of ' + ENTITY);
        const at = new Date().toISOString();
        const base = { entity: ENTITY, by: me, at, salt: rand(8) };
        switch (b.dataset.act) {
          case 'issue': {
            const cls = ($('icls').value || 'ordinary').trim();
            await offer({ kind: 'instrument-issue', instrument: ENTITY + ':' + cls, issuer: ENTITY, class: cls,
              quantity: num('iqty'), to: ($('ito').value || ENTITY).trim(), by: me, at, salt: rand(8) },
              'transfers', 'issue ' + ENTITY + ':' + cls);
            break;
          }
          case 'transfer': {
            const what = $('twhat').value, n = num('tamt');
            await offer({ kind: what === 'unit' ? 'transfer' : 'instrument-transfer', from: ENTITY, to: $('tto').value, by: me,
              ...(what === 'unit' ? { amount: n } : { instrument: what, quantity: n }), at, salt: rand(12) },
              'transfers', 'transfer from ' + ENTITY);
            break;
          }
          case 'order': {
            await offer({ kind: 'order', side: $('oside').value, instrument: $('oinst').value,
              quantity: num('oqty'), price: num('oprice'), account: ENTITY, by: me, at, salt: rand(8) },
              'orders', $('oside').value + ' ' + $('oinst').value);
            break;
          }
          case 'admit':
          case 'remove': {
            const who = $('mwho').value.split(',').map((x) => x.trim()).filter(Boolean);
            if (!who.length) throw new Error('name at least one citizenship');
            await offer({ kind: b.dataset.act === 'admit' ? 'member.admit' : 'member.remove', members: who, ...base },
              'entity-acts', b.dataset.act + ' ' + who.join(', '));
            break;
          }
          case 'organs': {
            const organsNew = $('oset').value.split(',').map((x) => {
              const [name, holders] = x.split('=');
              return { name: (name || '').trim(), held_by: (holders || '').split('/').map((h) => h.trim()).filter(Boolean) };
            }).filter((o) => o.name);
            if (!organsNew.length) throw new Error('give at least one organ');
            await offer({ kind: 'organ.set', organs: organsNew, ...base }, 'entity-acts', 'organs of ' + ENTITY);
            break;
          }
          case 'charter':
            await offer({ kind: 'charter.amend', text: $('ctext').value, ...base }, 'entity-acts', 'charter of ' + ENTITY);
            break;
          case 'dissolve':
            if (!confirm('Dissolve ' + ENTITY + '? Its holdings pass as the charter provides, and failing that to the Treasury.')) return;
            await offer({ kind: 'entity.dissolve', ...base }, 'entity-acts', 'dissolve ' + ENTITY);
            break;
        }
      } catch (err) { problem('could not sign', err); }
    };` }));
}

function parseCharter(body) {
  const out = []; let cur = null;
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    const h = line.match(/^##\s+§\s*(\d+)\s*(.*)$/);
    if (h) { cur = { num: Number(h[1]), heading: (h[2] || '').trim(), paragraphs: [] }; out.push(cur); continue; }
    const m = line.match(/^([¹²³⁴⁵⁶⁷⁸⁹])\s+/);
    if (m && cur) cur.paragraphs.push({ num: '¹²³⁴⁵⁶⁷⁸⁹'.indexOf(m[1]) + 1, text: line.slice(m[0].length).trim() });
    else if (cur && cur.paragraphs.length && line.trim()) cur.paragraphs[cur.paragraphs.length - 1].text += ' ' + line.trim();
  }
  return out;
}

write('ledger', page('Ledger', `
  <h1>Ledger<span class="sub">No record is altered; a correction is a new record — art-02/§9.</span></h1>
  <p class="state" id="v">verifying…</p>
  <table class="wide"><thead><tr><th>#</th><th>Act</th><th>Author</th><th>Under</th><th>When</th></tr></thead>
  <tbody>${events.slice().reverse().map((e) => `<tr id="r${e.seq}"><td class="q">${e.seq}</td>
    <td>${esc(e.kind)}</td><td class="q">${esc(e.author)}</td><td>${link(String(e.provision))}</td>
    <td class="q">${esc(e.at.slice(0, 10))}</td></tr>`).join('')}</tbody></table>`,
  { on: 'ledger', script: `
  import * as R from '${u('/republic.js')}';
  const v = document.getElementById('v');
  try {
    const r = await R.verifyRegister(await (await fetch('${u('/data/events.jsonl')}')).text());
    v.textContent = r.ok ? r.count + ' records verified in this browser — head ' + r.head.slice(0, 16)
      : r.problems.map((p) => 'record ' + p.seq + ' ' + p.error).join('; ');
    if (!r.ok) v.classList.add('failed');
  } catch (e) { v.textContent = 'could not verify: ' + e.message; v.classList.add('failed'); }` }));

// ---- data -------------------------------------------------------------------

const resolveIndex = {};
for (const [id, e] of C.entries) resolveIndex[id] = { href: BASE + e.href, label: e.label };

fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'data/resolve.json'), JSON.stringify(resolveIndex));
fs.writeFileSync(path.join(OUT, 'data/citizens.json'), JSON.stringify(roll.map((c) => ({ id: c.id, status: c.status, admitted: isoDate(c.admitted), keys: c.keys || [] })), null, 2));
fs.writeFileSync(path.join(OUT, 'data/offices.json'), JSON.stringify(offs, null, 2));
fs.writeFileSync(path.join(OUT, 'data/carried.json'), JSON.stringify(
  C.proposals.filter((p) => resultFor(p.id)?.outcome?.carried).map((p) => ({ id: p.id, title: p.title, class: p.class })), null, 2));
fs.writeFileSync(path.join(OUT, 'data/elections.json'), JSON.stringify(
  C.proposals.filter((p) => p.class === 'election').map((p) => {
    const r = resultFor(p.id);
    return { id: p.id, office: p.office, winner: r?.outcome?.winner ?? null, carried: !!r?.outcome?.carried };
  }), null, 2));
const treasurer = offs.find((o) => (o.permissions || []).includes('treasury.disburse'));
fs.writeFileSync(path.join(OUT, 'data/accounts.json'), JSON.stringify([...ACCTS.entries()].map(([id, m]) => ({
  id, kind: m.kind, organs: m.organs || [], ...(id === TREASURY && treasurer ? { officer: treasurer.holder } : {}),
  balance: V.balances.get(id) || 0,
  holdings: holdingsOf(id).map(([instrument, quantity]) => ({ instrument, quantity })),
})), null, 2));
fs.mkdirSync(path.join(OUT, 'data/contracts'), { recursive: true });
for (const c of CONTRACTS) fs.writeFileSync(path.join(OUT, `data/contracts/${c.id}.txt`), fs.readFileSync(path.join(ROOT, c.file), 'utf8'));
fs.writeFileSync(path.join(OUT, 'data/entities.json'), JSON.stringify(ents.map(({ charterBody, ...e }) => e), null, 2));
fs.writeFileSync(path.join(OUT, 'data/proposals.json'), JSON.stringify(C.proposals.map((p) => ({ id: p.id, title: p.title, class: p.class, closes: closesOf(p)?.toISOString() ?? null })), null, 2));
fs.writeFileSync(path.join(OUT, 'data/meta.json'), JSON.stringify({ repo: REPO, branch: BRANCH, base: BASE, classes: CLASSES, parameters: P }, null, 2));
fs.writeFileSync(path.join(OUT, 'data/events.jsonl'),
  fs.existsSync(path.join(ROOT, 'ledger/events.jsonl')) ? fs.readFileSync(path.join(ROOT, 'ledger/events.jsonl')) : '');

let n = 0;
(function count(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? count(path.join(d, f.name)) : f.name.endsWith('.html') && n++; })(OUT);
console.log(`Built ${n} pages · ${C.entries.size} citations · ${C.proposals.length} measures`);
