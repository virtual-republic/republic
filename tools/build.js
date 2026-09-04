#!/usr/bin/env node
// Builds the public site (art-01/§5/¶2 — the repository is authoritative; this
// is a client). Static output: no server, no database.
//
// One page tree, not one per language. Both authentic versions are embedded in
// every page and the reader chooses EN, FR, or both — art-01/§6/¶2 says neither
// derives from the other, so neither gets its own site.

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
  const f = e.charter && fs.existsSync(path.join(ROOT, e.charter)) ? fs.readFileSync(path.join(ROOT, e.charter), 'utf8') : null;
  if (!f) return e;
  const end = f.indexOf('\n---', 3);
  return { ...e, charterMeta: yaml.load(f.slice(4, end)) || {}, charterBody: f.slice(end + 4) };
});
const offs = offices(ROOT);
const NAME_EN = C.constitution.meta.republic.name_en;
const NAME_FR = C.constitution.meta.republic.name_fr;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const link = (text) => linkify(text, C.entries, { esc, base: BASE });
const SUP = '¹²³⁴⁵⁶⁷⁸⁹';

// Both languages, side by side in the markup, one shown at a time.
const bi = (en, fr) => `<span data-lang="en">${esc(en)}</span><span data-lang="fr">${esc(fr ?? en)}</span>`;

const provSlug = (bare) => bare.replace(/§/g, 's').replace(/¶/g, 'p').replace(/\//g, '-');
const provPath = (bare) => `constitution/${provSlug(bare)}`;
const provHref = (bare) => u(`/constitution/${provSlug(bare)}/`);

// ---------------------------------------------------------------- ballots ---

function ballotsFor(id) {
  const dir = path.join(ROOT, 'ballots', id);
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    out[path.basename(f, '.json')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  return out;
}

function resultFor(id) {
  const f = path.join(ROOT, 'ballots', id, '_result.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

function closesOf(p) {
  const spec = CLASSES[p.class];
  if (p.closes) return new Date(isoDate(p.closes) + 'T23:59:59Z');
  if (p.opened && spec) return new Date(new Date(isoDate(p.opened) + 'T00:00:00Z').getTime() + spec.window_days * 86400000);
  return null;
}

// ------------------------------------------------------------- backlinks ---

const backlinks = new Map();
const cite = (id, entry) => {
  const norm = id.startsWith('const.') || id.includes('.') ? id : 'const.' + id;
  if (!backlinks.has(norm)) backlinks.set(norm, []);
  backlinks.get(norm).push(entry);
  const parts = norm.split('/');
  if (parts.length === 3) cite(parts.slice(0, 2).join('/'), entry);
  if (parts.length === 2) cite(parts[0], entry);
};

for (const e of events) cite(e.provision, { type: 'record', label: e.kind, href: `/ledger/#r${e.seq}`, at: e.at });
for (const j of C.journal) for (const c of [].concat(j.cites || [])) cite(String(c), { type: 'journal', label: `Journal ${j.number}`, href: `/journal/#j${j.number}`, at: j.date });
for (const p of C.proposals) for (const c of [].concat(p.cites || [])) cite(String(c), { type: 'measure', label: p.id, href: `/assembly/${p.id}/`, at: isoDate(p.opened) });
for (const d of C.judgments) for (const c of [].concat(d.cites || [])) cite(String(c), { type: 'judgment', label: `Judgment ${d.number}`, href: `/judgments/#d${d.number}`, at: d.date });

// ------------------------------------------------------------------ page ---

const NAV = [
  ['', 'The Republic', 'La République'],
  ['constitution', 'Constitution', 'Constitution'],
  ['assembly', 'Assembly', 'Assemblée'],
  ['journal', 'Journal', 'Journal'],
  ['register', 'Register', 'Registre'],
  ['ledger', 'Ledger', 'Grand livre'],
  ['office', 'Office', 'Charge'],
];

function page(title, body, { active: on = '', side = '', script = '' } = {}) {
  return `<!doctype html>
<html lang="en" class="lang-en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${esc(NAME_EN)}</title>
<link rel="stylesheet" href="${u('/style.css')}">
<body>
<header class="masthead">
  <div class="wordmark">
    <a href="${u('/')}">${bi(NAME_EN, NAME_FR)}</a>
  </div>
  <nav>
    ${NAV.map(([slug, en, fr]) => `<a href="${u('/' + slug + (slug ? '/' : ''))}"${on === slug ? ' class="on"' : ''}>${bi(en, fr)}</a>`).join('')}
    <span class="langtoggle">
      <button data-setlang="en">EN</button><button data-setlang="fr">FR</button><button data-setlang="both">Both</button>
    </span>
  </nav>
</header>
<main>${side ? `<div class="withside"><aside class="side">${side}</aside><div class="content">${body}</div></div>` : `<div class="content">${body}</div>`}</main>
<footer>
  <div class="state ${chain.ok ? '' : 'bad'}">${chain.ok ? '✓' : '✗'} ${chain.count} records · head <code>${chain.head.slice(0, 16)}</code></div>
  <div>${bi('Not a state. Confers no legal status.', "N'est pas un État. Ne confère aucun statut juridique.")}</div>
</footer>
<script type="module">
const H = document.documentElement;
const set = (l) => {
  H.className = 'lang-' + l;
  H.lang = l === 'fr' ? 'fr' : 'en';
  try { localStorage.setItem('republic.lang', l); } catch {}
  for (const b of document.querySelectorAll('[data-setlang]')) b.setAttribute('aria-pressed', String(b.dataset.setlang === l));
};
for (const b of document.querySelectorAll('[data-setlang]')) b.onclick = () => set(b.dataset.setlang);
let saved = 'en';
try { saved = localStorage.getItem('republic.lang') || (navigator.language.startsWith('fr') ? 'fr' : 'en'); } catch {}
set(saved);

// Click any § or ¶ anchor to copy both the link and the citation.
for (const a of document.querySelectorAll('a.anchor')) {
  a.onclick = (e) => {
    e.preventDefault();
    const url = new URL(a.getAttribute('href'), location).href;
    navigator.clipboard.writeText(a.dataset.cite + '  ' + url);
    a.classList.add('copied');
    setTimeout(() => a.classList.remove('copied'), 1200);
    history.replaceState(null, '', a.getAttribute('href'));
  };
}
</script>
${script ? `<script type="module">${script}</script>` : ''}
</body></html>`;
}

function write(rel, html) {
  const f = path.join(OUT, rel, 'index.html');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, html);
}

// ------------------------------------------------------------- rendering ---

// The grid has exactly two children: the mark, and one span holding the text.
// Anything else — a citation link, for instance — becomes a stray grid item.
const para = (num, text, id, citeId) =>
  `<p class="para"${id ? ` id="${id}"` : ''}>` +
  (citeId
    ? `<a class="mark anchor" href="#${id}" data-cite="${citeId}">${SUP[num - 1] || num}</a>`
    : `<span class="mark">${SUP[num - 1] || num}</span>`) +
  `<span class="text">${link(text)}</span></p>`;

function renderSections(sections, lang, artId) {
  return sections.map((sec) => {
    const secCite = artId ? `${artId}/§${sec.num}` : null;
    return `<section class="sec" id="s${sec.num}" data-lang="${lang}">
      <h2><span class="sign">§</span>&nbsp;${sec.num} <span class="secttl">${esc(sec.heading)}</span>
        ${secCite ? `<a class="anchor" href="#s${sec.num}" data-cite="const.${secCite}" title="copy citation">§</a>` : ''}</h2>
      ${sec.paragraphs.map((p) => para(p.num, p.text, `s${sec.num}p${p.num}`, secCite ? `const.${secCite}/¶${p.num}` : null)).join('')}
    </section>`;
  }).join('');
}

// --------------------------------------------------------------- output ----

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.copyFileSync(path.join(ROOT, 'site/style.css'), path.join(OUT, 'style.css'));
fs.copyFileSync(path.join(ROOT, 'site/republic.js'), path.join(OUT, 'republic.js'));

// ---- home ------------------------------------------------------------------

write('', page('The Republic', `
  <section class="hero">
    <h1>${bi(NAME_EN, NAME_FR)}</h1>
    <p class="lede">${bi(
      'A voluntary civic association governed by a text its citizens wrote. Every act is recorded, published, and verifiable by anyone.',
      'Une association civique volontaire régie par un texte que ses citoyens ont écrit. Tout acte est consigné, publié et vérifiable par quiconque.')}</p>
    <dl class="figures">
      <div><dt>${bi('Citizens', 'Citoyens')}</dt><dd>${active.length}</dd></div>
      <div><dt>${bi('Entities', 'Entités')}</dt><dd>${ents.length}</dd></div>
      <div><dt>${bi('Measures', 'Mesures')}</dt><dd>${C.proposals.length}</dd></div>
      <div><dt>${bi('Records', 'Enregistrements')}</dt><dd>${events.length}</dd></div>
    </dl>
  </section>

  <div class="cols2">
    <section>
      <h2>${bi('Before the Assembly', "Devant l'Assemblée")}</h2>
      <ul class="plain">${C.proposals.length ? C.proposals.map((p) => {
        const cl = closesOf(p);
        const open = cl ? new Date() < cl : true;
        return `<li><a href="${u(`/assembly/${p.id}/`)}">${esc(p.id)} — ${esc(p.title || p.title_en || '')}</a>
          <span class="tag">${open ? bi('open', 'ouvert') : bi('closed', 'clos')}</span></li>`;
      }).join('') : `<li class="empty">${bi('nothing before the Assembly', "rien devant l'Assemblée")}</li>`}</ul>
    </section>
    <section>
      <h2>${bi('Journal', 'Journal')}</h2>
      <ul class="plain">${C.journal.slice(-6).reverse().map((j) =>
        `<li><a href="${u('/journal/#j' + j.number)}">${esc(j.title_en || '')}</a><time>${esc(j.date)}</time></li>`).join('')}</ul>
    </section>
  </div>`, { active: '' }));

// ---- constitution ----------------------------------------------------------

const toc = (currentId) => `<h3>${bi('Articles', 'Articles')}</h3><ol>` + C.constitution.articles.map((a) => {
  const v = a.versions.en || a.versions.fr;
  const vf = a.versions.fr || v;
  return `<li><a href="${provHref(a.id)}"${a.id === currentId ? ' class="on"' : ''}><span class="artno">${esc(a.id.replace('art-', ''))}</span>${bi(v.title, vf.title)}</a></li>`;
}).join('') + '</ol>';

write('constitution', page('Constitution', `
  <h1>${bi('Constitution', 'Constitution')}</h1>
  <p class="note">${bi('Both versions are authentic. Neither derives from the other — art-01/§6/¶2.',
    "Les deux versions font foi. Aucune ne dérive de l'autre — art-01/§6/¶2.")}</p>
  <ol class="toc">${C.constitution.articles.map((a) => {
    const v = a.versions.en || a.versions.fr, vf = a.versions.fr || v;
    return `<li><a href="${provHref(a.id)}"><span class="artno">${esc(a.id)}</span> ${bi(v.title, vf.title)}</a>
      ${a.entrenched ? `<span class="tag">${bi('entrenched', 'protégé')}</span>` : ''}</li>`;
  }).join('')}</ol>`, { active: 'constitution', side: toc(null) }));

for (const art of C.constitution.articles) {
  const langs = Object.keys(art.versions);
  const head = art.versions.en || art.versions.fr;
  const headFr = art.versions.fr || head;

  write(provPath(art.id), page(`${art.id} · ${head.title}`, `
    <article class="law">
      <header class="artheader">
        <span class="artno">${esc(art.id)}</span>
        <h1>${bi(head.title, headFr.title)}</h1>
        ${art.entrenched ? `<span class="tag">${bi('entrenched — art-11/§61', 'protégé — art-11/§61')}</span>` : ''}
      </header>
      ${langs.map((l) => art.versions[l].note
        ? `<div class="artnote" data-lang="${l}">${art.versions[l].note.split('\n\n').map((x) => `<p>${link(x.replace(/\*/g, ''))}</p>`).join('')}</div>`
        : '').join('')}
      ${langs.map((l) => renderSections(art.versions[l].sections, l, art.id)).join('')}
      ${langs.length === 1 ? `<p class="note" data-lang="fr">${bi('', 'Version française à venir.')}</p>` : ''}
    </article>`, { active: 'constitution', side: toc(art.id) }));

  // one page per section and paragraph
  const base = art.versions.en || art.versions.fr;
  for (const sec of base.sections) {
    const targets = [{ bare: `${art.id}/§${sec.num}`, only: null }, ...sec.paragraphs.map((p) => ({ bare: `${art.id}/§${sec.num}/¶${p.num}`, only: p.num }))];
    for (const tgt of targets) {
      const id = 'const.' + tgt.bare;
      const links = backlinks.get(id) || [];
      write(provPath(tgt.bare), page(tgt.bare, `
        <nav class="crumb"><a href="${u('/constitution/')}">${bi('Constitution', 'Constitution')}</a> ›
          <a href="${provHref(art.id)}">${esc(art.id)}</a> › <span>${esc(tgt.bare.split('/').slice(1).join(' '))}</span></nav>
        <h1 class="provid">${esc(id)}</h1>
        <div class="row">
          <button class="ghost" data-copy="${esc(id)}">${bi('copy citation', 'copier la citation')}</button>
        </div>
        <div class="parallel">
          ${langs.map((l) => {
            const s = art.versions[l].sections.find((x) => x.num === sec.num);
            if (!s) return '';
            const ps = tgt.only ? s.paragraphs.filter((p) => p.num === tgt.only) : s.paragraphs;
            return `<div class="col" data-lang="${l}">
              <div class="collang">${l.toUpperCase()}</div>
              <h3>${esc(s.heading)}</h3>
              ${ps.map((p) => para(p.num, p.text)).join('')}</div>`;
          }).join('')}
        </div>
        <section class="backlinks">
          <h2>${bi('Acts under this provision', 'Actes pris en vertu de cette disposition')} <span class="count">${links.length}</span></h2>
          ${links.length ? `<ul class="plain">${links.map((l) =>
            `<li><span class="badge ${l.type}">${esc(l.type)}</span><a href="${u(l.href)}">${esc(l.label)}</a><time>${esc(String(l.at || '').slice(0, 10))}</time></li>`).join('')}</ul>`
            : `<p class="empty">${bi('None yet.', 'Aucun pour le moment.')}</p>`}
        </section>`, { active: 'constitution', side: toc(art.id), script: `
        for (const b of document.querySelectorAll('[data-copy]')) b.onclick = () => {
          navigator.clipboard.writeText(b.dataset.copy + '  ' + location.href);
          b.textContent = '✓'; setTimeout(() => location.reload(), 900);
        };` }));
    }
  }
}

// ---- assembly --------------------------------------------------------------

const assemblyScript = (extra = '') => `
import * as R from '${u('/republic.js')}';
const $ = (id) => document.getElementById(id);

// A page stuck on "counting…" tells nobody anything. Report failures visibly.
function fail(where, err) {
  const msg = where + ': ' + (err && err.message ? err.message : err);
  const bar = $('tallybar'), text = $('tallytext'), who = $('who');
  if (bar) bar.classList.add('bad');
  if (text) text.textContent = msg;
  else if (who) { who.textContent = msg; who.className = 'status bad'; }
  console.error('[republic]', where, err);
}
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status + ' ' + r.statusText + ' for ' + url);
  return r.json();
}

let meta;
try { meta = await getJSON('${u('/data/meta.json')}'); }
catch (e) { fail('could not load meta.json', e); throw e; }
let priv = null, pubLine = null, citizenId = null, pemText = null;
function say(m, bad) { const w = $('who'); if (!w) return; w.textContent = m; w.className = 'status' + (bad ? ' bad' : ''); }
async function adopt(text) {
  priv = await R.importPrivateKey(text); pemText = text;
  pubLine = R.publicKeyLine(priv.raw, '');
  const rollData = await getJSON('${u('/data/citizens.json')}');
  const mine = pubLine.split(/\\s+/)[1];
  const m = rollData.find((c) => (c.keys || []).some((k) => k.split(/\\s+/)[1] === mine));
  citizenId = m ? m.id : null;
  say(m ? 'signed in as ' + m.id : 'key loaded — not on the register');
  if ($('keys')) { $('keys').hidden = false; $('privout').value = text.trim(); $('pub').textContent = pubLine; }
  document.dispatchEvent(new CustomEvent('identity'));
}
if ($('gen')) $('gen').onclick = async () => {
  const kp = await R.generateKey(''); R.vault.save(null, kp.privateKeyB64);
  await adopt(kp.privateKeyPem);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([kp.privateKeyPem], { type: 'application/x-pem-file' }));
  a.download = 'citizenship.pem'; a.click();
  say('citizenship created — the .pem has downloaded and is shown below. Save it.');
};
if ($('load')) $('load').onclick = () => { $('loader').hidden = !$('loader').hidden; };
if ($('pemfile')) $('pemfile').onchange = async (e) => { const f = e.target.files[0]; if (f) tryLoad(await f.text()); };
if ($('loadgo')) $('loadgo').onclick = () => tryLoad($('pem').value);
async function tryLoad(t) {
  try { await adopt(t); R.vault.save(null, t.replace(/-----[A-Z ]+-----/g, '').replace(/\\s+/g, '')); $('loader').hidden = true; }
  catch (e) { say(e.message, true); if ($('keys')) $('keys').hidden = true; }
}
if ($('forget')) $('forget').onclick = () => { R.vault.clear(); location.reload(); };
const held = R.vault.load();
if (held && held.key) { try { await adopt('-----BEGIN PRIVATE KEY-----\\n' + held.key + '\\n-----END PRIVATE KEY-----'); } catch {} }
if (!R.supported()) say('this browser has no Web Crypto', true);
${extra}`;

const IDENTITY = `
<section class="panel" id="identity">
  <h2>${bi('Your citizenship', 'Votre citoyenneté')}</h2>
  <div id="who" class="status">${bi('no citizenship loaded in this browser', 'aucune citoyenneté chargée')}</div>
  <div class="row">
    <button id="gen">${bi('Create', 'Créer')}</button>
    <button id="load" class="ghost">${bi('Load a key', 'Charger une clé')}</button>
    <button id="forget" class="ghost">${bi('Forget', 'Oublier')}</button>
  </div>
  <div id="keys" hidden>
    <label>${bi('Private key — this IS your citizenship. Save it. Never publish it.', 'Clé privée — c\\u2019est votre citoyenneté. Conservez-la. Ne la publiez jamais.')}</label>
    <textarea id="privout" readonly rows="4"></textarea>
    <label>${bi('Public key — the harmless half. It goes on the register.', 'Clé publique — la moitié inoffensive. Elle va au registre.')}</label>
    <div id="pub" class="out"></div>
  </div>
  <div id="loader" hidden>
    <label for="pemfile">${bi('choose your .pem file', 'choisissez votre fichier .pem')}</label>
    <input type="file" id="pemfile" accept=".pem,.txt">
    <label for="pem">${bi('or paste the whole file', 'ou collez le fichier entier')}</label>
    <textarea id="pem" rows="4" placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
    <div class="row"><button id="loadgo">${bi('Load', 'Charger')}</button></div>
  </div>
</section>`;

write('assembly', page('Assembly', `
  <h1>${bi('Assembly', 'Assemblée')}</h1>
  <p class="note">${bi('The Assembly is all citizens — art-06/§30/¶1.', "L'Assemblée est l'ensemble des citoyens — art-06/§30/¶1.")}</p>

  <section>
    <h2>${bi('Measures', 'Mesures')}</h2>
    <ul class="plain">${C.proposals.length ? C.proposals.map((p) => {
      const cl = closesOf(p), open = cl ? new Date() < cl : true;
      const r = resultFor(p.id);
      return `<li><a href="${u(`/assembly/${p.id}/`)}">${esc(p.id)} — ${esc(p.title || p.title_en || '')}</a>
        <span class="tag">${esc(CLASSES[p.class]?.label_en || p.class)}</span>
        <span class="tag${open ? '' : r?.outcome?.carried ? '' : ' warn'}">${open ? bi('open', 'ouvert') : r?.outcome?.carried ? bi('carried', 'adoptée') : bi('not carried', 'rejetée')}</span></li>`;
    }).join('') : `<li class="empty">${bi('nothing before the Assembly', "rien devant l'Assemblée")}</li>`}</ul>
  </section>

  ${IDENTITY}

  <section class="panel">
    <h2>${bi('Lay a measure', 'Déposer une mesure')}</h2>
    <label for="pid">${bi('identifier', 'identifiant')}</label><input type="text" id="pid">
    <label for="ptitle">${bi('title (English)', 'titre (anglais)')}</label><input type="text" id="ptitle">
    <label for="ptitlefr">${bi('title (French) — optional', 'titre (français) — facultatif')}</label><input type="text" id="ptitlefr">
    <label for="pclass">${bi('class', 'classe')}</label><select id="pclass"></select>
    <label for="pcites">${bi('cites — one per line, e.g. const.art-09/§48/¶1', 'cite — un par ligne')}</label>
    <textarea id="pcites" rows="3"></textarea>
    <label for="pbody">${bi('text (English)', 'texte (anglais)')}</label><textarea id="pbody" rows="8"></textarea>
    <label for="pbodyfr">${bi('text (French) — optional', 'texte (français) — facultatif')}</label><textarea id="pbodyfr" rows="6"></textarea>
    <div class="row">
      <button id="check">${bi('check citations', 'vérifier les citations')}</button>
      <a id="pcommit" class="btn" hidden>${bi('Open on GitHub', 'Ouvrir sur GitHub')}</a>
    </div>
    <div id="pstatus" class="status"></div>
    <div id="preview" class="out" hidden></div>
  </section>`, { active: 'assembly', script: assemblyScript(`
  const resolve = await (await fetch('${u('/data/resolve.json')}')).json();
  const existing = await (await fetch('${u('/data/proposals.json')}')).json();
  $('pid').value = 'P-' + String(existing.length + 1).padStart(4, '0');
  $('pclass').innerHTML = Object.entries(meta.classes).map(([k, v]) => '<option value="' + k + '">' + v.label_en + '</option>').join('');
  $('check').onclick = () => {
    const cites = $('pcites').value.split('\\n').map((c) => c.trim()).filter(Boolean);
    const bad = cites.filter((c) => !resolve[c] && !resolve['const.' + c]);
    if (!cites.length) return reject('cites nothing — not received (art-08/§41/¶3)');
    if (bad.length) return reject('does not resolve: ' + bad.join(', '));
    const spec = meta.classes[$('pclass').value];
    const today = new Date(), close = new Date(today.getTime() + spec.window_days * 86400000);
    const lines = ['---', 'id: ' + $('pid').value, 'title: ' + $('ptitle').value];
    if ($('ptitlefr').value) lines.push('title_fr: ' + $('ptitlefr').value);
    lines.push('sponsor: ' + (citizenId || 'c-0001'), 'class: ' + $('pclass').value, 'cites:',
      ...cites.map((c) => '  - ' + c),
      'opened: ' + today.toISOString().slice(0, 10),
      'closes: ' + close.toISOString().slice(0, 10), '---', '', '## § 1', '', '¹ ' + $('pbody').value.trim(), '');
    if ($('pbodyfr').value) lines.push('<!-- fr -->', '', '¹ ' + $('pbodyfr').value.trim(), '');
    const md = lines.join('\\n');
    $('pstatus').className = 'status'; $('pstatus').textContent = 'all citations resolve — received';
    $('preview').hidden = false; $('preview').textContent = md;
    const slug = ($('ptitle').value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'measure');
    $('pcommit').href = R.commitUrl(meta.repo, meta.branch, 'proposals/' + $('pid').value + '-' + slug + '.md', md, 'propose: ' + $('pid').value);
    $('pcommit').hidden = false;
  };
  function reject(m) { $('pstatus').className = 'status bad'; $('pstatus').textContent = m; $('pcommit').hidden = true; $('preview').hidden = true; }
  `) }));

// ---- one page per measure --------------------------------------------------

for (const p of C.proposals) {
  const cl = closesOf(p);
  const open = cl ? new Date() < cl : true;
  const spec = CLASSES[p.class] || {};
  const links = [].concat(p.cites || []);
  fs.mkdirSync(path.join(OUT, 'data/ballots'), { recursive: true });
  fs.writeFileSync(path.join(OUT, `data/ballots/${p.id}.json`), JSON.stringify(ballotsFor(p.id), null, 2));

  write(`assembly/${p.id}`, page(p.id, `
    <nav class="crumb"><a href="${u('/assembly/')}">${bi('Assembly', 'Assemblée')}</a> › <span>${esc(p.id)}</span></nav>
    <header class="artheader">
      <span class="artno">${esc(p.id)}</span>
      <h1>${bi(p.title || p.title_en || '', p.title_fr || p.title || '')}</h1>
      <span class="tag">${esc(spec.label_en || p.class)}</span>
    </header>

    <div class="verifybar" id="tallybar"><span class="dot"></span><span id="tallytext">counting…</span></div>

    <section>
      <h2>${bi('Text', 'Texte')}</h2>
      ${p.sections.length ? renderSections(p.sections, 'en', null) : `<p class="para"><span class="mark"></span><span class="text">${link(p.body)}</span></p>`}
    </section>

    <section>
      <h2>${bi('Cites', 'Cite')}</h2>
      <ul class="plain">${links.map((c) => `<li>${link(String(c))}</li>`).join('') || `<li class="empty">—</li>`}</ul>
    </section>

    ${IDENTITY}

    <section class="panel" id="closepanel" hidden>
      <h2>${bi('Close and enact', 'Clore et promulguer')}</h2>
      <p id="closewhy" class="status"></p>
      <p class="note">${bi('Closing counts the ballots, publishes the Journal issue if the measure carried, records the enactment, and opens a pull request. It runs on GitHub because it writes to the register — art-08/§43/¶5, art-08/§45/¶1.',
        'La clôture compte les bulletins, publie le Journal si la mesure est adoptée, consigne la promulgation et ouvre une pull request — art-08/§43/¶5, art-08/§45/¶1.')}</p>
      <div class="row">
        <a id="closebtn" class="btn" target="_blank" rel="noopener">${bi('Close and enact on GitHub', 'Clore sur GitHub')}</a>
      </div>
      <p class="note">${bi('On the page that opens: press Run workflow, type this measure\u2019s identifier, and run it.',
        'Sur la page qui s\u2019ouvre : cliquez sur Run workflow, saisissez l\u2019identifiant de la mesure, puis lancez-la.')}</p>
    </section>

    <section class="panel">
      <h2>${open ? bi('Vote', 'Voter') : bi('Voting closed', 'Vote clos')}</h2>
      ${open ? `
      <div class="choices">
        <button data-choice="yes">${bi('yes', 'oui')}</button>
        <button data-choice="no">${bi('no', 'non')}</button>
        <button data-choice="abstain">${bi('abstain', 'abstention')}</button>
      </div>
      <div class="row">
        <button id="sign" disabled>${bi('Sign ballot', 'Signer le bulletin')}</button>
        <a id="commit" class="btn" hidden>${bi('Open on GitHub', 'Ouvrir sur GitHub')}</a>
      </div>
      <p class="note">${bi('One ballot per citizenship. Voting again replaces your earlier ballot — art-08/§43.',
        'Un bulletin par citoyenneté. Voter de nouveau remplace votre bulletin — art-08/§43.')}</p>
      <div id="result" class="out" hidden></div>` : `<p class="empty">${bi('This measure is closed.', 'Cette mesure est close.')}</p>`}
    </section>

    <section>
      <h2>${bi('Ballots', 'Bulletins')}</h2>
      <table class="grid"><thead><tr><th>citizen</th><th>${bi('choice', 'choix')}</th><th>${bi('cast', 'déposé')}</th></tr></thead>
      <tbody id="ballotrows"></tbody></table>
    </section>`, { active: 'assembly', script: assemblyScript(`
    // --- voting, wired first and independently -----------------------------
    // Counting and voting are separate concerns. A failure in one must not
    // disable the other.
    let choice = null;
    function refreshSign() {
      const b = $('sign');
      if (b) b.disabled = !(choice && priv);
    }
    for (const b of document.querySelectorAll('.choices button')) {
      b.onclick = () => {
        choice = b.dataset.choice;
        for (const x of document.querySelectorAll('.choices button')) x.setAttribute('aria-pressed', String(x === b));
        refreshSign();
      };
    }
    document.addEventListener('identity', refreshSign);
    refreshSign();

    if ($('sign')) $('sign').onclick = async () => {
      try {
        if (!priv) throw new Error('load a key first');
        if (!choice) throw new Error('choose yes, no, or abstain first');
        const { ballot, receipt } = await R.makeBallot(${JSON.stringify(p.id)}, choice, priv);
        $('result').hidden = false;
        $('result').textContent = 'receipt ' + receipt + '\\n\\n' + JSON.stringify(ballot, null, 2);
        $('commit').href = R.commitUrl(meta.repo, meta.branch,
          'ballots/${p.id}/' + (citizenId || 'unregistered') + '.json', JSON.stringify(ballot, null, 2),
          'ballot: ${p.id}');
        $('commit').hidden = false;
      } catch (e) { fail('could not sign', e); }
    };

    // --- counting ----------------------------------------------------------
    try {
      const spec = meta.classes[${JSON.stringify(p.class)}];
      if (!spec) throw new Error('unknown class ' + ${JSON.stringify(p.class)});
      const closes = ${cl ? JSON.stringify(cl.toISOString()) : 'null'};
      const rollData = await getJSON('${u('/data/citizens.json')}');
      const ballots = await getJSON('${u(`/data/ballots/${p.id}.json`)}');
      const earlyRules = (meta.parameters && meta.parameters.ballot && meta.parameters.ballot.early_close) || {};

      const t = await R.tally(${JSON.stringify(p.id)}, ballots, rollData, spec, closes, earlyRules);
      const bar = $('tallybar');
      if (!t.open) bar.classList.add(t.carried ? 'good' : 'bad');
      const electorate = rollData.filter((c) => c.status === 'active').length;
      $('tallytext').textContent =
        t.yes + ' yes \u00b7 ' + t.no + ' no \u00b7 ' + t.abstain + ' abstain \u2014 ' +
        t.cast + '/' + electorate + ' cast, quorum ' + t.quorumNeeded + (t.quorumMet ? ' met' : ' NOT met') +
        ' \u00b7 ' + (t.share * 100).toFixed(0) + '% of ' + (t.threshold * 100).toFixed(0) + '% needed \u00b7 ' +
        (t.open ? 'open until ' + (closes || '').slice(0, 10)
          : (t.closedEarly ? 'closed early \u2014 ' + t.closedEarly + ' \u2014 ' : '') + (t.carried ? 'CARRIED' : 'NOT CARRIED'));

      if (!t.open) {
        $('closepanel').hidden = false;
        $('closewhy').textContent = (t.closedEarly ? 'Closed early \u2014 ' + t.closedEarly + '. ' : 'The voting period has ended. ')
          + (t.carried ? 'The measure carries.' : 'The measure fails.');
        $('closebtn').href = 'https://github.com/' + meta.repo + '/actions/workflows/close.yml';
      }

      $('ballotrows').innerHTML = Object.entries(ballots).map(([id, b]) =>
        '<tr><td><code>' + id + '</code></td><td>' + b.choice + '</td><td>' + (b.at || '').slice(0, 16).replace('T', ' ') + '</td></tr>').join('')
        || '<tr><td colspan="3" class="empty">none yet</td></tr>';
    } catch (e) { fail('could not count', e); }`) }));
}

// ---- journal, register, ledger, office, checkpoints ------------------------

write('journal', page('Journal', `
  <h1>${bi('Journal', 'Journal')}</h1>
  <p class="note">${bi('Publication is promulgation — art-05/§25/¶2.', 'La publication vaut promulgation — art-05/§25/¶2.')}</p>
  ${C.journal.slice().reverse().map((j) => `<article class="issue" id="j${j.number}">
    <header><span class="num">No. ${j.number}</span><time>${esc(j.date)}</time></header>
    <h2>${bi(j.title_en || '', j.title_fr || j.title_en || '')}</h2>
    ${j.body.split('\n\n').map((x) => `<p>${link(x.replace(/\n/g, ' '))}</p>`).join('')}
    ${j.cites ? `<p class="under">${[].concat(j.cites).map((c) => link(String(c))).join(', ')}</p>` : ''}
  </article>`).join('')}`, { active: 'journal' }));

write('register', page('Register', `
  <h1>${bi('Register', 'Registre')}</h1>
  <section>
    <h2>${bi('Offices', 'Charges')}</h2>
    <table class="grid"><thead><tr><th>${bi('office', 'charge')}</th><th>${bi('holder', 'titulaire')}</th><th>${bi('since', 'depuis')}</th><th>${bi('permissions', 'permissions')}</th></tr></thead>
    <tbody>${offs.map((o) => `<tr><td>${bi(o.title_en, o.title_fr)}</td><td><code>${esc(o.holder)}</code></td>
      <td>${esc(isoDate(o.since))}</td><td class="perms">${(o.permissions || []).map((x) => `<code>${esc(x)}</code>`).join(' ')}</td></tr>`).join('')}</tbody></table>
  </section>
  <section>
    <h2>${bi('Citizens', 'Citoyens')} <span class="count">${active.length}</span></h2>
    <table class="grid"><thead><tr><th>id</th><th>${bi('status', 'statut')}</th><th>${bi('admitted', 'admis')}</th><th>${bi('under', 'en vertu de')}</th></tr></thead>
    <tbody>${roll.map((c) => `<tr><td><code>${esc(c.id)}</code></td><td>${esc(c.status)}</td>
      <td>${esc(isoDate(c.admitted))}</td><td>${link(String(c.admitted_under || ''))}</td></tr>`).join('')}</tbody></table>
    <p class="note">${bi('The register names no person; only identifiers appear — art-07/§37/¶2.',
      'Le registre ne nomme personne ; seuls les identifiants figurent — art-07/§37/¶2.')}</p>
  </section>
  <section>
    <h2>${bi('Entities', 'Entités')} <span class="count">${ents.length}</span></h2>
    <table class="grid"><thead><tr><th>id</th><th>${bi('type', 'type')}</th><th>${bi('name', 'nom')}</th><th>${bi('formed', 'constituée')}</th></tr></thead>
    <tbody>${ents.map((e) => `<tr><td><a href="${u(`/entities/${e.id}/`)}"><code>${esc(e.id)}</code></a></td><td>${esc(e.type)}</td>
      <td>${bi(e.name_en, e.name_fr)}</td><td>${esc(isoDate(e.formed))}</td></tr>`).join('') || `<tr><td colspan="4" class="empty">—</td></tr>`}</tbody></table>
  </section>`, { active: 'register' }));

write('ledger', page('Ledger', `
  <h1>${bi('Ledger', 'Grand livre')}</h1>
  <div class="verifybar" id="vbar"><span class="dot"></span><span id="vtext">${bi('verifying…', 'vérification…')}</span></div>
  <table class="ledger"><thead><tr><th>#</th><th>${bi('at', 'le')}</th><th>${bi('act', 'acte')}</th><th>${bi('author', 'auteur')}</th><th>${bi('under', 'en vertu de')}</th><th>hash</th></tr></thead>
  <tbody>${events.slice().reverse().map((e) => `<tr id="r${e.seq}">
    <td class="seq">${e.seq}</td><td><time>${esc(e.at.slice(0, 16).replace('T', ' '))}</time></td>
    <td class="kind">${esc(e.kind)}</td><td><code>${esc(e.author)}</code></td>
    <td>${link(String(e.provision))}</td><td class="hash"><code>${esc(e.hash.slice(0, 12))}</code></td></tr>`).join('')}</tbody></table>`,
  { active: 'ledger', script: `
  import * as R from '${u('/republic.js')}';
  const bar = document.getElementById('vbar'), text = document.getElementById('vtext');
  try {
    const r = await R.verifyRegister(await (await fetch('${u('/data/events.jsonl')}')).text());
    bar.classList.add(r.ok ? 'good' : 'bad');
    text.textContent = r.ok ? r.count + ' records verified in this browser · head ' + r.head.slice(0, 16) + '…'
      : r.problems.map((p) => 'record ' + p.seq + ' ' + p.error).join('; ');
  } catch (e) { bar.classList.add('bad'); text.textContent = 'could not verify: ' + e.message; }` }));

write('office', page('Office', `
  <h1>${bi('Office', 'Charge')}</h1>
  <p class="note">${bi('Actions shown are those your key\\u2019s office permits — art-06/§28/¶3. This page recognises you locally; the real check is the signature on the resulting act.',
    'Les actions affichées sont celles que permet la charge de votre clé — art-06/§28/¶3.')}</p>
  ${IDENTITY}
  <section class="panel" id="powers">
    <h2>${bi('Your offices', 'Vos charges')}</h2>
    <div id="offices" class="status">${bi('load a key to see what it may do', 'chargez une clé')}</div>
    <div id="actions"></div>
  </section>`, { active: 'office', script: assemblyScript(`
  const offices = await (await fetch('${u('/data/offices.json')}')).json();
  const ACTIONS = {
    'journal.publish': ['Publish a Journal issue', 'journal/'],
    'checkpoint.sign': ['Sign a checkpoint', 'checkpoints/'],
    'value.issue': ['Issue value', 'ledger/'],
    'treasury.disburse': ['Disburse from the Treasury', 'ledger/'],
    'register.admit': ['Admit a citizenship', 'register/citizens/'],
    'register.object': ['Object to an admission', 'register/citizens/'],
    'entity.register': ['Register an entity', 'register/entities/'],
    'audit.report': ['Publish an audit report', 'journal/'],
  };
  function render() {
    const mine = offices.filter((o) => o.holder === citizenId);
    if (!citizenId) { $('offices').textContent = 'load a key to see what it may do'; $('actions').innerHTML = ''; return; }
    if (!mine.length) { $('offices').textContent = citizenId + ' holds no office'; $('actions').innerHTML = ''; return; }
    $('offices').textContent = citizenId + ' holds: ' + mine.map((o) => o.title_en).join(', ');
    const perms = [...new Set(mine.flatMap((o) => o.permissions || []))];
    $('actions').innerHTML = perms.map((p) => {
      const a = ACTIONS[p];
      return '<div class="permrow"><code>' + p + '</code><span>' + (a ? a[0] : '') + '</span>' +
        (a ? '<a class="btn ghost" target="_blank" href="https://github.com/' + meta.repo + '/new/' + meta.branch + '?filename=' + a[1] + '">open</a>' : '') + '</div>';
    }).join('');
  }
  document.addEventListener('identity', render); render();
  `) }));

write('checkpoints', page('Checkpoints', `
  <h1>${bi('Checkpoints', 'Points de contrôle')}</h1>
  <p class="note">${bi('A checkpoint proves nobody has rewritten history. Each records how many records existed, the Merkle root over them, and the previous checkpoint — art-02/§10.',
    "Un point de contrôle prouve que nul n'a réécrit l'histoire — art-02/§10.")}</p>
  <table class="grid"><thead><tr><th>no.</th><th>${bi('at', 'le')}</th><th>${bi('records', 'enregistrements')}</th><th>${bi('root', 'racine')}</th><th>${bi('signed', 'signé')}</th></tr></thead>
  <tbody>${checkpoints.slice().reverse().map((c) => `<tr><td>${c.number}</td>
    <td><time>${esc(c.at.slice(0, 16).replace('T', ' '))}</time></td><td>${c.records}</td>
    <td class="hash"><code>${esc(c.root.slice(0, 24))}…</code></td><td>${c.signature ? '✓' : '—'}</td></tr>`).join('') || `<tr><td colspan="5" class="empty">—</td></tr>`}</tbody></table>
  <pre class="cmd">git clone &lt;repository&gt;
npm install &amp;&amp; npm run verify</pre>`, { active: '' }));

// ---- entities --------------------------------------------------------------

for (const e of ents) {
  const sections = e.charterBody ? parseCharter(e.charterBody) : [];
  write(`entities/${e.id}`, page(e.name_en || e.id, `
    <nav class="crumb"><a href="${u('/register/')}">${bi('Register', 'Registre')}</a> › <span>${esc(e.id)}</span></nav>
    <header class="artheader">
      <span class="artno">${esc(e.id)}</span>
      <h1>${bi(e.name_en, e.name_fr)}</h1>
      <span class="tag">${esc(e.type)}</span>
    </header>
    <section>
      <h2>${bi('Register entry', 'Inscription au registre')}</h2>
      <table class="grid"><tbody>
        <tr><td>${bi('formed', 'constituée')}</td><td>${esc(isoDate(e.formed))} ${link(String(e.formed_under || ''))}</td></tr>
        <tr><td>${bi('formed by', 'constituée par')}</td><td><code>${esc(e.formed_by || '')}</code></td></tr>
        <tr><td>${bi('organs', 'organes')}</td><td>${(e.organs || []).map((o) => `${esc(o.name)} — ${(o.held_by || []).map((h) => `<code>${esc(h)}</code>`).join(' ')}`).join('<br>')}</td></tr>
        <tr><td>${bi('members', 'membres')}</td><td>${(e.members || []).map((m) => `<code>${esc(m)}</code>`).join(' ')}</td></tr>
        <tr><td>${bi('status', 'statut')}</td><td>${esc(e.status || '')}</td></tr>
      </tbody></table>
    </section>
    ${sections.length ? `<section class="law">
      <h2>${bi('Charter', 'Statuts')}</h2>
      ${renderSections(sections, 'en', null)}
      <p class="note">${bi('A charter is subordinate to the Constitution — art-04/§21/¶3.', 'Les statuts sont subordonnés à la Constitution — art-04/§21/¶3.')}</p>
    </section>` : ''}`, { active: 'register' }));
}

function parseCharter(body) {
  const out = [];
  let cur = null;
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    const h = line.match(/^##\s+§\s*(\d+)\s*(.*)$/);
    if (h) { cur = { num: Number(h[1]), heading: (h[2] || '').trim(), paragraphs: [] }; out.push(cur); continue; }
    const m = line.match(/^([¹²³⁴⁵⁶⁷⁸⁹])\s+/);
    if (m && cur) { cur.paragraphs.push({ num: '¹²³⁴⁵⁶⁷⁸⁹'.indexOf(m[1]) + 1, text: line.slice(m[0].length).trim() }); }
    else if (cur && cur.paragraphs.length && line.trim()) cur.paragraphs[cur.paragraphs.length - 1].text += ' ' + line.trim();
  }
  return out;
}

// ---- data ------------------------------------------------------------------

const resolveIndex = {};
for (const [id, e] of C.entries) resolveIndex[id] = { href: BASE + e.href, label: e.label, corpus: e.corpus };

fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'data/resolve.json'), JSON.stringify(resolveIndex));
fs.writeFileSync(path.join(OUT, 'data/citizens.json'), JSON.stringify(roll.map((c) => ({ id: c.id, status: c.status, admitted: isoDate(c.admitted), keys: c.keys || [] })), null, 2));
fs.writeFileSync(path.join(OUT, 'data/offices.json'), JSON.stringify(offs, null, 2));
fs.writeFileSync(path.join(OUT, 'data/entities.json'), JSON.stringify(ents.map((e) => ({ id: e.id, type: e.type, name_en: e.name_en, name_fr: e.name_fr, organs: e.organs, members: e.members, status: e.status })), null, 2));
fs.writeFileSync(path.join(OUT, 'data/proposals.json'), JSON.stringify(C.proposals.map((p) => ({ id: p.id, title: p.title || p.title_en, class: p.class, closes: closesOf(p)?.toISOString() ?? null })), null, 2));
fs.writeFileSync(path.join(OUT, 'data/meta.json'), JSON.stringify({ repo: REPO, branch: BRANCH, base: BASE, classes: CLASSES, parameters: P }, null, 2));
fs.copyFileSync(path.join(ROOT, 'ledger/events.jsonl'), path.join(OUT, 'data/events.jsonl'));

let n = 0;
(function count(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? count(path.join(d, f.name)) : f.name.endsWith('.html') && n++; })(OUT);
console.log(`Built ${n} pages`);
console.log(`  citations resolvable: ${C.entries.size}`);
console.log(`  measures: ${C.proposals.length}`);
