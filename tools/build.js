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
const NAME = C.constitution.meta.republic.name || C.constitution.meta.republic.name_en || 'The Republic';
// The register is state and may still carry pre-rename field names.
const titleOf = (o) => o.title || o.title_en || o.id;
const nameOf = (e) => e.name || e.name_en || e.id;
const issueTitle = (j) => j.title || j.title_en || `Issue ${j.number}`;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const link = (t) => linkify(t, C.entries, { esc, base: BASE });
const slug = (bare) => bare.replace(/§/g, 's').replace(/¶/g, 'p').replace(/\//g, '-');
const href = (bare) => u(`/constitution/${slug(bare)}/`);

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
  if (r && r.open === false) return { open: false, label: r.outcome?.carried ? 'carried' : 'not carried', carried: !!r.outcome?.carried };
  if (r && r.outcome && r.outcome.open === false) return { open: false, label: r.outcome.carried ? 'carried' : 'not carried', carried: !!r.outcome.carried };
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
for (const j of C.journal) for (const c of [].concat(j.cites || [])) cite(String(c), { kind: 'journal', label: `Journal ${j.number}`, href: `/journal/${j.number}/`, at: j.date });
for (const p of C.proposals) for (const c of [].concat(p.cites || [])) cite(String(c), { kind: 'measure', label: p.id, href: `/assembly/${p.id}/`, at: isoDate(p.opened) });

// ------------------------------------------------------------------ page ---

const NAV = [['', 'Republic'], ['constitution', 'Constitution'], ['assembly', 'Assembly'],
             ['law', 'Law'], ['journal', 'Journal'], ['register', 'Register'], ['office', 'Office'], ['ledger', 'Ledger']];

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
  <nav>${NAV.map(([s, l]) => `<a href="${u('/' + s + (s ? '/' : ''))}"${on === s ? ' class="on"' : ''}>${esc(l)}</a>`).join('')}</nav>
  <span class="who"><a href="${u('/key/')}" id="whoami">sign in</a></span>
</header>
<main${narrow ? ' class="narrow"' : ''}>${body}</main>
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
    return `<li><a href="${u(`/law/${st.slug}/`)}">${esc(v.title || st.slug)}</a><span class="meta">${esc(isoDate(v.enacted))}</span></li>`;
  }).join('') : '<li class="quiet">Nothing enacted yet.</li>'}</ul>

  <h2>Journal</h2>
  <ul class="list">${C.journal.slice(-5).reverse().map((j) =>
    `<li><a href="${u('/journal/' + j.number + '/')}">${esc(issueTitle(j))}</a><span class="meta">${esc(j.date)}</span></li>`).join('')
    || '<li class="quiet">No issues yet.</li>'}</ul>

  <h2>State</h2>
  <table><tbody>
    <tr><td class="q">Citizens</td><td>${active.length}</td></tr>
    <tr><td class="q">Entities</td><td>${ents.length}</td></tr>
    <tr><td class="q">Records</td><td>${events.length}</td></tr>
    <tr><td class="q">Register</td><td>${chain.ok ? 'verifies' : 'DOES NOT VERIFY'}</td></tr>
  </tbody></table>`, { on: '', narrow: true }));

// ---- constitution ----------------------------------------------------------

write('constitution', page('Constitution', `
  <h1>Constitution</h1>
  <ol class="contents">${C.constitution.articles.map((a) => {
    const v = a.versions.en;
    return `<li><span class="n">${esc(a.id.replace('art-', ''))}</span><a href="${href(a.id)}">${esc(v.title)}</a>
      ${a.entrenched ? '<span class="meta">entrenched</span>' : ''}</li>`;
  }).join('')}</ol>`, { on: 'constitution', narrow: true }));

for (const art of C.constitution.articles) {
  const v = art.versions.en;
  write(`constitution/${slug(art.id)}`, page(v.title, `
    <p class="crumb"><a href="${u('/constitution/')}">Constitution</a> · ${esc(art.id)}</p>
    <article class="law">
      <h1>${esc(v.title)}${art.entrenched ? '<span class="sub">Entrenched — art-11/§61</span>' : ''}</h1>
      ${v.note ? `<div class="note">${v.note.split('\n\n').map((x) => `<p>${link(x.replace(/\*/g, ''))}</p>`).join('')}</div>` : ''}
      ${sections(v.sections, art.id)}
    </article>`, { on: 'constitution', narrow: true }));

  for (const sec of v.sections) {
    const targets = [{ bare: `${art.id}/§${sec.num}`, only: null }, ...sec.paragraphs.map((p) => ({ bare: `${art.id}/§${sec.num}/¶${p.num}`, only: p.num }))];
    for (const t of targets) {
      const id = 'const.' + t.bare;
      const links = back.get(id) || [];
      const ps = t.only ? sec.paragraphs.filter((p) => p.num === t.only) : sec.paragraphs;
      write(`constitution/${slug(t.bare)}`, page(t.bare, `
        <p class="crumb"><a href="${u('/constitution/')}">Constitution</a> ·
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
        'sponsor: ' + (me || 'c-0001'), 'class: ' + $('pclass').value, 'cites:',
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
    const t = await R.tally(${JSON.stringify(p.id)}, ballots, roll, spec, closes, early);
    const n = roll.filter((c) => c.status === 'active').length;

    $('state').textContent = isElection
      ? t.cast + ' of ' + n + ' ballots cast — ' + (t.open ? 'open' : 'closed; run the tally for the rounds')
      : t.yes + ' yes, ' + t.no + ' no, ' + t.abstain + ' abstain — ' + t.cast + ' of ' + n + ' cast, ' +
        t.quorumNeeded + ' needed — ' + (t.open ? 'open' : (t.closedEarly ? 'closed early, ' + t.closedEarly + ' — ' : '') + (t.carried ? 'carried' : 'not carried'));
    if (!t.open) $('state').classList.add(t.carried ? 'carried' : 'failed');

    if (!t.open) {
      $('closebox').hidden = false;
      $('closebtn').href = 'https://github.com/' + meta.repo + '/actions/workflows/close.yml';
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

  <h2>Stand for office</h2>
  <p class="quiet">Every citizen may stand — art-07/§34/¶1. An election is a measure; the vote is by instant runoff — art-08/§46/¶1.</p>
  <label for="office">Office</label>
  <select id="office">${offs.map((o) => `<option value="${esc(o.id)}">${esc(titleOf(o))}</option>`).join('')}</select>
  <div class="row"><button id="standbtn" disabled>Prepare the election</button><a id="standcommit" class="button" hidden>Open on GitHub</a></div>
  <div class="out" id="standout" hidden></div>`, { on: 'office', script: IDENT + `
  const offices = await getJSON('${u('/data/offices.json')}');
  const existing = await getJSON('${u('/data/proposals.json')}');
  const ACTIONS = ${JSON.stringify(ACTIONS)};

  function render() {
    if (!me) { $('powers').innerHTML = ''; return; }
    const mine = offices.filter((o) => o.holder === me);
    $('msg').className = 'msg';
    if (!mine.length) { $('msg').textContent = me + ' holds no office.'; $('powers').innerHTML = ''; }
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

write('law', page('Law', `
  <h1>Law in force<span class="sub">Statute is where rates, procedure and detail belong — art-01/§4/¶3.</span></h1>
  ${C.statutes.length ? `
  <div class="row">
    <button class="plain" data-sort="title">title</button>
    <button class="plain" data-sort="enacted">date</button>
    <button class="plain" data-sort="class">class</button>
    <button class="plain" data-sort="id">identifier</button>
  </div>
  <table id="laws"><thead><tr><th>Statute</th><th>Class</th><th>Enacted</th><th>Cite as</th></tr></thead>
  <tbody>${C.statutes.map((st) => {
    const m = statuteMeta(st);
    return `<tr data-title="${esc(m.title || st.slug)}" data-enacted="${esc(isoDate(m.enacted))}" data-class="${esc(m.class || '')}" data-id="${esc(st.slug)}">
      <td><a href="${u(`/law/${st.slug}/`)}">${esc(m.title || st.slug)}</a></td>
      <td class="q">${esc(CLASSES[m.class]?.label || m.class || '')}</td>
      <td class="q">${esc(isoDate(m.enacted))}</td>
      <td class="q">stat.${esc(st.slug)}</td></tr>`;
  }).join('')}</tbody></table>`
  : '<p class="quiet">Nothing has been enacted yet. A measure that carries becomes law on publication — art-08/§45/¶1.</p>'}`,
  { on: 'law', script: `
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
  write(`law/${st.slug}`, page(m.title || st.slug, `
    <p class="crumb"><a href="${u('/law/')}">Law</a> · stat.${esc(st.slug)}</p>
    <h1>${esc(m.title || st.slug)}<span class="sub">${esc(CLASSES[m.class]?.label || m.class || '')}${m.enacted ? ' · enacted ' + esc(isoDate(m.enacted)) : ''}${m.measure ? ' · ' + esc(m.measure) : ''}</span></h1>
    <div class="row">
      <button class="plain" data-copy="stat.${esc(st.slug)}">copy citation</button>
      <a class="button" target="_blank" rel="noopener" href="https://github.com/${REPO}/edit/${BRANCH}/statutes/${esc(st.slug)}.md">Edit this statute</a>
    </div>
    <p class="note">Editing statute is an act of the Assembly. The gate refuses the change unless a measure of the right class has carried — art-08/§45/¶1.</p>
    <article class="law">${secs.length ? statuteSections(secs, st.slug) : ''}</article>
    ${links.length ? `<h2>Made under</h2><ul class="list">${links.map((c) => `<li>${link(String(c))}</li>`).join('')}</ul>` : ''}
    ${m.journal ? `<h2>Promulgated</h2><ul class="list"><li><a href="${u(`/journal/${m.journal}/`)}">Journal ${m.journal}</a></li>${m.measure ? `<li><a href="${u(`/assembly/${m.measure}/`)}">${esc(m.measure)}</a></li>` : ''}</ul>` : ''}
    ${back2.length ? `<h2>Cited by</h2><ul class="list">${back2.map((l) => `<li><a href="${u(l.href)}">${esc(l.label)}</a><span class="meta">${esc(String(l.at || '').slice(0, 10))}</span></li>`).join('')}</ul>` : ''}`,
  { on: 'law', narrow: true, script: `
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

write('journal', page('Journal', `
  <h1>Journal<span class="sub">Publication is promulgation — art-05/§25/¶2.</span></h1>
  <ul class="list">${C.journal.slice().reverse().map((j) =>
    `<li><a href="${u(`/journal/${j.number}/`)}">No. ${j.number} · ${esc(issueTitle(j))}</a><span class="meta">${esc(j.date)}</span></li>`).join('')
    || '<li class="quiet">No issues yet.</li>'}</ul>`, { on: 'journal', narrow: true }));

for (const j of C.journal) {
  const links = [].concat(j.cites || []);
  write(`journal/${j.number}`, page(issueTitle(j), `
    <p class="crumb"><a href="${u('/journal/')}">Journal</a> · No. ${j.number}</p>
    <h1>${esc(issueTitle(j))}<span class="sub">No. ${j.number} · ${esc(j.date)}${j.measure ? ' · ' + esc(j.measure) : ''}</span></h1>
    <article class="law">${markdown(j.body)}</article>
    ${links.length ? `<h2>Made under</h2><ul class="list">${links.map((c) => `<li>${link(String(c))}</li>`).join('')}</ul>` : ''}
    ${j.measure ? `<h2>The measure</h2><ul class="list"><li><a href="${u(`/assembly/${j.measure}/`)}">${esc(j.measure)}</a></li></ul>` : ''}`,
  { on: 'journal', narrow: true }));
}

write('register', page('Register', `
  <h1>Register</h1>
  <h2>Citizens</h2>
  <table><thead><tr><th>Citizenship</th><th>Status</th><th>Admitted</th></tr></thead>
  <tbody>${roll.map((c) => `<tr><td>${esc(c.id)}</td><td${c.status === 'active' ? '' : ' class="q"'}>${esc(c.status)}</td>
    <td class="q">${esc(isoDate(c.admitted))}</td></tr>`).join('')}</tbody></table>
  <p class="quiet">The register names no person; only identifiers appear — art-07/§37/¶2.</p>

  <h2>Entities</h2>
  ${ents.length ? `<table><thead><tr><th>Entity</th><th>Type</th><th>Name</th></tr></thead>
  <tbody>${ents.map((e) => `<tr><td><a href="${u(`/entities/${e.id}/`)}">${esc(e.id)}</a></td>
    <td class="q">${esc(e.type)}</td><td>${esc(nameOf(e))}</td></tr>`).join('')}</tbody></table>`
    : '<p class="quiet">None yet. Any citizen may form one — art-04/§19/¶1.</p>'}

  <h2>Checkpoints</h2>
  <table><thead><tr><th>No.</th><th>Records</th><th>Root</th></tr></thead>
  <tbody>${checkpoints.slice().reverse().map((c) => `<tr><td>${c.number}</td><td class="q">${c.records}</td>
    <td class="q">${esc(c.root.slice(0, 20))}…</td></tr>`).join('') || '<tr><td colspan="3" class="q">None yet.</td></tr>'}</tbody></table>`,
  { on: 'register', narrow: true }));

for (const e of ents) {
  const secs = e.charterBody ? parseCharter(e.charterBody) : [];
  write(`entities/${e.id}`, page(nameOf(e), `
    <p class="crumb"><a href="${u('/register/')}">Register</a> · ${esc(e.id)}</p>
    <h1>${esc(nameOf(e))}<span class="sub">${esc(e.type)} · formed ${esc(isoDate(e.formed))} under art-04/§19/¶1</span></h1>
    <table><tbody>
      <tr><td class="q">Organs</td><td>${(e.organs || []).map((o) => `${esc(o.name)}: ${(o.held_by || []).join(', ')}`).join('<br>')}</td></tr>
      <tr><td class="q">Members</td><td>${(e.members || []).join(', ')}</td></tr>
    </tbody></table>
    ${secs.length ? `<h2>Charter</h2><article class="law">${sections(secs, null)}</article>` : ''}`,
  { on: 'register', narrow: true }));
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
fs.writeFileSync(path.join(OUT, 'data/entities.json'), JSON.stringify(ents.map(({ charterBody, ...e }) => e), null, 2));
fs.writeFileSync(path.join(OUT, 'data/proposals.json'), JSON.stringify(C.proposals.map((p) => ({ id: p.id, title: p.title, class: p.class, closes: closesOf(p)?.toISOString() ?? null })), null, 2));
fs.writeFileSync(path.join(OUT, 'data/meta.json'), JSON.stringify({ repo: REPO, branch: BRANCH, base: BASE, classes: CLASSES, parameters: P }, null, 2));
fs.writeFileSync(path.join(OUT, 'data/events.jsonl'),
  fs.existsSync(path.join(ROOT, 'ledger/events.jsonl')) ? fs.readFileSync(path.join(ROOT, 'ledger/events.jsonl')) : '');

let n = 0;
(function count(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? count(path.join(d, f.name)) : f.name.endsWith('.html') && n++; })(OUT);
console.log(`Built ${n} pages · ${C.entries.size} citations · ${C.proposals.length} measures`);
