#!/usr/bin/env node
// Builds the public site from the repository (art-01/§5/¶2 — the repository is
// authoritative; this is a client). Output is static: no server, no database,
// nothing to run. Deploy dist/ anywhere that serves files.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { loadConstitution, provisionIndex } from './lib/constitution.js';
import { read, verifyChain, checkpointList } from './lib/events.js';
import { citizens, activeCitizens, entities, offices } from './lib/registers.js';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'dist');
// Project pages serve from https://<org>.github.io/<repo>/ — set BASE_PATH=/<repo>
// A custom domain or a <org>.github.io repo needs no BASE_PATH.
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');
const u = (p) => BASE + p;

const constitution = loadConstitution(ROOT);
const meta = constitution.meta;
const index = provisionIndex(constitution);
const events = read(ROOT);
const chain = verifyChain(ROOT);
const checkpoints = checkpointList(ROOT);
const roll = citizens(ROOT);
const active = activeCitizens(ROOT);
const ents = entities(ROOT);
const offs = offices(ROOT);

// --- chrome strings --------------------------------------------------------

const T = {
  en: {
    constitution: 'Constitution', journal: 'Journal', register: 'Register',
    ledger: 'Ledger', checkpoints: 'Checkpoints', proposals: 'Proposals',
    citizens: 'Citizens', entities: 'Entities', offices: 'Offices',
    article: 'Article', section: 'Section', provision: 'Provision',
    actsUnder: 'Acts taken under this provision', citedBy: 'Cited by',
    noActs: 'No act has yet been taken under this provision.',
    verified: 'The register verifies', notVerified: 'The register does not verify',
    records: 'records', head: 'head', preamble: 'Preamble',
    pending: 'Authentic version pending in this language.',
    home: 'The Republic', at: 'at', author: 'author', kind: 'act', under: 'under',
    holder: 'holder', since: 'since', type: 'type', status: 'status',
    formed: 'formed', admitted: 'admitted', permissions: 'permissions',
    root: 'root', number: 'no.', bothAuthentic: 'Both versions are authentic — art-01/§6/¶2',
    verifyHow: 'Clone the repository and run', notState: 'Not a state. Confers no legal status.',
  },
  fr: {
    constitution: 'Constitution', journal: 'Journal', register: 'Registre',
    ledger: 'Grand livre', checkpoints: 'Points de contrôle', proposals: 'Propositions',
    citizens: 'Citoyens', entities: 'Entités', offices: 'Charges',
    article: 'Article', section: 'Section', provision: 'Disposition',
    actsUnder: 'Actes pris en vertu de cette disposition', citedBy: 'Cité par',
    noActs: "Aucun acte n'a encore été pris en vertu de cette disposition.",
    verified: 'Le registre est vérifié', notVerified: "Le registre n'est pas vérifié",
    records: 'enregistrements', head: 'tête', preamble: 'Préambule',
    pending: 'Version authentique à venir dans cette langue.',
    home: 'La République', at: 'le', author: 'auteur', kind: 'acte', under: 'en vertu de',
    holder: 'titulaire', since: 'depuis', type: 'type', status: 'statut',
    formed: 'constituée', admitted: 'admis', permissions: 'permissions',
    root: 'racine', number: 'n°', bothAuthentic: 'Les deux versions font foi — art-01/§6/¶2',
    verifyHow: 'Clonez le dépôt et exécutez', notState: "N'est pas un État. Ne confère aucun statut juridique.",
  },
};

// --- backlinks: which acts cite which provision ----------------------------

const backlinks = new Map();
const link = (provision, entry) => {
  const key = provision;
  if (!backlinks.has(key)) backlinks.set(key, []);
  backlinks.get(key).push(entry);
  // A citation of a paragraph is also a citation of its section and article.
  const parts = key.split('/');
  if (parts.length === 3) link(`${parts[0]}/${parts[1]}`, entry);
  if (parts.length === 2) link(parts[0], entry);
};

for (const e of events) link(e.provision, { type: 'record', label: e.kind, href: `/ledger/#r${e.seq}`, at: e.at, seq: e.seq });

const journalIssues = [];
const journalDir = path.join(ROOT, 'journal');
if (fs.existsSync(journalDir)) {
  for (const year of fs.readdirSync(journalDir).sort()) {
    const dir = path.join(journalDir, year);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const end = src.indexOf('\n---', 3);
      const front = yaml.load(src.slice(4, end)) || {};
      const issue = { ...front, year, slug: f.replace(/\.md$/, ''), body: src.slice(end + 4).trim() };
      journalIssues.push(issue);
      for (const c of [].concat(front.cites || [])) {
        link(c, { type: 'journal', label: `Journal ${front.number}`, href: `/journal/#j${front.number}`, at: front.date });
      }
    }
  }
}

const proposals = [];
const propDir = path.join(ROOT, 'proposals');
if (fs.existsSync(propDir)) {
  for (const f of fs.readdirSync(propDir).filter((x) => x.endsWith('.md') && x !== 'TEMPLATE.md').sort()) {
    const src = fs.readFileSync(path.join(propDir, f), 'utf8');
    const end = src.indexOf('\n---', 3);
    const front = yaml.load(src.slice(4, end)) || {};
    const resultFile = path.join(ROOT, 'ballots', front.id || '', '_result.json');
    const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : null;
    proposals.push({ ...front, body: src.slice(end + 4).trim(), result });
    for (const c of [].concat(front.cites || [])) {
      link(c, { type: 'proposal', label: front.id, href: `/proposals/#${front.id}`, at: front.opened });
    }
  }
}

// --- tiny helpers ----------------------------------------------------------

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const provSlug = (id) => id.replace(/\u00a7/g, 's').replace(/\u00b6/g, 'p').replace(/\//g, '-');
// The URL carries the base prefix; the output path must never carry it,
// or the pages land one directory too deep and every link 404s.
const provHref = (lang, id) => u(`/${lang}/constitution/${provSlug(id)}/`);
const provPath = (lang, id) => `${lang}/constitution/${provSlug(id)}`;

// Turn "art-02/§9/¶1" inside prose into a link.
const CITE_RE = /\b(art-\d{2})(?:\/(§\d+))?(?:\/(¶\d+))?/g;
// Prose form: "Article 7 § 38 \u00b2" in English, "l'article 3 \u00a7 16 \u2075" in French.
const PROSE_RE = /\b[Aa]rticles?\s+(\d{1,2})(?:\s*\u00a7+\s*(\d{1,3}))?(?:\s*([\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079]))?/g;
const SUPERS = '\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079';

const linkify = (lang, text) => {
  let out = esc(text).replace(CITE_RE, (m, a, s, p) => {
    const id = [a, s, p].filter(Boolean).join('/');
    return index.has(id) ? `<a class="cite" href="${provHref(lang, id)}">${m}</a>` : m;
  });
  out = out.replace(PROSE_RE, (m, art, sec, para) => {
    const parts = ['art-' + String(art).padStart(2, '0')];
    if (sec) parts.push('\u00a7' + sec);
    if (para) parts.push('\u00b6' + (SUPERS.indexOf(para) + 1));
    const id = parts.join('/');
    return index.has(id) ? `<a class="cite" href="${provHref(lang, id)}">${m}</a>` : m;
  });
  return out;
};

function page(lang, title, body, { active = '', wide = false } = {}) {
  const t = T[lang];
  const other = lang === 'en' ? 'fr' : 'en';
  const nav = [
    ['', t.home], ['constitution', t.constitution], ['journal', t.journal],
    ['register', t.register], ['ledger', t.ledger], ['proposals', t.proposals],
    ['checkpoints', t.checkpoints],
  ];
  return `<!doctype html>
<html lang="${lang}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${esc(lang === 'en' ? meta.republic.name_en : meta.republic.name_fr)}</title>
<link rel="stylesheet" href="${u('/style.css')}">
<body class="${wide ? 'wide' : ''}">
<header class="masthead">
  <div class="wordmark">
    <a href="${u(`/${lang}/`)}">${esc(lang === 'en' ? meta.republic.name_en : meta.republic.name_fr)}</a>
    <span class="motto">${esc(lang === 'en' ? meta.republic.motto_en : meta.republic.motto_fr)}</span>
  </div>
  <nav>
    ${nav.map(([slug, label]) => `<a href="${u(`/${lang}/${slug}${slug ? '/' : ''}`)}"${active === slug ? ' class="on"' : ''}>${esc(label)}</a>`).join('')}
    <a class="lang" href="${u(`/${other}/`)}">${other.toUpperCase()}</a>
  </nav>
</header>
<main>${body}</main>
<footer>
  <div class="state ${chain.ok ? 'good' : 'bad'}">
    ${chain.ok ? '✓ ' + esc(t.verified) : '✗ ' + esc(t.notVerified)} ·
    ${chain.count} ${esc(t.records)} · ${esc(t.head)} <code>${chain.head.slice(0, 16)}</code>
  </div>
  <div class="disclaimer">${esc(t.notState)} · ${esc(t.verifyHow)} <code>npm run verify</code></div>
</footer>
</body></html>`;
}

function write(rel, html) {
  const file = path.join(OUT, rel, 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

// --- pages -----------------------------------------------------------------

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'site/style.css'), path.join(OUT, 'style.css'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${BASE}/en/">`);

for (const lang of constitution.langs) {
  const t = T[lang];
  const name = lang === 'en' ? meta.republic.name_en : meta.republic.name_fr;

  // home
  const recent = events.slice(-8).reverse();
  write(`${lang}`, page(lang, t.home, `
    <section class="hero">
      <h1>${esc(name)}</h1>
      <p class="lede">${esc(constitution.articles[0].versions[lang]?.sections?.length ? '' : '')}${
        (constitution.articles[0].versions[lang] || constitution.articles[0].versions.en).note
          .split('\n\n')[0].replace(/\n/g, ' ')
      }</p>
      <dl class="figures">
        <div><dt>${esc(t.citizens)}</dt><dd>${active.length}</dd></div>
        <div><dt>${esc(t.entities)}</dt><dd>${ents.length}</dd></div>
        <div><dt>${esc(t.offices)}</dt><dd>${offs.length}</dd></div>
        <div><dt>${esc(t.records)}</dt><dd>${events.length}</dd></div>
      </dl>
    </section>
    <section>
      <h2>${esc(t.journal)}</h2>
      <ul class="plain">${journalIssues.slice(-5).reverse().map((j) =>
        `<li><span class="num">${esc(t.number)} ${j.number}</span> <a href="${u(`/${lang}/journal/#j${j.number}`)}">${esc(lang === 'fr' ? j.title_fr || j.title_en : j.title_en)}</a> <time>${esc(j.date)}</time></li>`
      ).join('')}</ul>
    </section>
    <section>
      <h2>${esc(t.ledger)}</h2>
      <table class="ledger">
        <tbody>${recent.map((e) => `<tr>
          <td class="seq">${e.seq}</td>
          <td class="kind">${esc(e.kind)}</td>
          <td class="who">${esc(e.author)}</td>
          <td class="prov">${linkify(lang, e.provision)}</td>
        </tr>`).join('')}</tbody>
      </table>
      <p><a class="more" href="${u(`/${lang}/ledger/`)}">${esc(t.ledger)} →</a></p>
    </section>`, { active: '' }));

  // constitution index
  write(`${lang}/constitution`, page(lang, t.constitution, `
    <h1>${esc(t.constitution)}</h1>
    <p class="note">${esc(t.bothAuthentic)}</p>
    <ol class="toc">${constitution.articles.map((a) => {
      const v = a.versions[lang] || a.versions.en;
      const missing = !a.versions[lang];
      return `<li${missing ? ' class="missing"' : ''}>
        <a href="${provHref(lang, a.id)}"><span class="artno">${esc(a.id)}</span> ${esc(v.title)}</a>
        ${a.entrenched ? '<span class="tag">entrenched</span>' : ''}
        ${missing ? `<span class="tag warn">${esc(t.pending)}</span>` : ''}
      </li>`;
    }).join('')}</ol>`, { active: 'constitution' }));

  // article and provision pages
  for (const art of constitution.articles) {
    const v = art.versions[lang] || art.versions.en;
    const missing = !art.versions[lang];
    const body = `
      <article class="law">
        <header class="artheader">
          <span class="artno">${esc(art.id)}</span>
          <h1>${esc(v.title)}</h1>
          ${art.entrenched ? '<span class="tag">entrenched — art-11/§61</span>' : ''}
          ${missing ? `<p class="tag warn">${esc(t.pending)}</p>` : ''}
        </header>
        ${v.note ? `<div class="artnote">${v.note.split('\n\n').map((p) => `<p>${linkify(lang, p.replace(/\*/g, ''))}</p>`).join('')}</div>` : ''}
        ${v.sections.map((sec) => `
          <section class="sec" id="s${sec.num}">
            <h2><span class="sign">§</span> ${sec.num} <span class="secttl">${esc(sec.heading)}</span>
              <a class="perma" href="${provHref(lang, `${art.id}/§${sec.num}`)}">¶</a></h2>
            ${sec.paragraphs.map((p) => `<p class="para" id="s${sec.num}p${p.num}">
              <a class="mark" href="${provHref(lang, `${art.id}/§${sec.num}/¶${p.num}`)}">${'¹²³⁴⁵⁶⁷⁸⁹'[p.num - 1] || p.num}</a>
              ${linkify(lang, p.text)}</p>`).join('')}
          </section>`).join('')}
      </article>`;
    write(provPath(lang, art.id), page(lang, `${art.id} · ${v.title}`, body, { active: 'constitution' }));

    for (const sec of v.sections) {
      for (const target of [{ id: `${art.id}/§${sec.num}`, label: `§ ${sec.num} ${sec.heading}`, paras: sec.paragraphs },
                            ...sec.paragraphs.map((p) => ({ id: `${art.id}/§${sec.num}/¶${p.num}`, label: `§ ${sec.num} ¶ ${p.num}`, paras: [p] }))]) {
        const links = backlinks.get(target.id) || [];
        const both = constitution.langs.map((l) => {
          const av = art.versions[l];
          if (!av) return null;
          const s = av.sections.find((x) => x.num === sec.num);
          if (!s) return null;
          const paras = target.paras.length === 1
            ? s.paragraphs.filter((p) => p.num === target.paras[0].num)
            : s.paragraphs;
          return { lang: l, heading: s.heading, paras };
        }).filter(Boolean);

        write(provPath(lang, target.id), page(lang, target.id, `
          <nav class="crumb"><a href="${u(`/${lang}/constitution/`)}">${esc(t.constitution)}</a> ›
            <a href="${provHref(lang, art.id)}">${esc(art.id)}</a> › <span>${esc(target.label)}</span></nav>
          <h1 class="provid">${esc(target.id)}</h1>
          <div class="parallel">
            ${both.map((b) => `<div class="col">
              <div class="collang">${esc(b.lang.toUpperCase())}</div>
              <h3>${esc(b.heading)}</h3>
              ${b.paras.map((p) => `<p class="para"><span class="mark">${'¹²³⁴⁵⁶⁷⁸⁹'[p.num - 1] || p.num}</span> ${linkify(lang, p.text)}</p>`).join('')}
            </div>`).join('')}
          </div>
          <p class="note">${esc(t.bothAuthentic)}</p>
          <section class="backlinks">
            <h2>${esc(t.actsUnder)} <span class="count">${links.length}</span></h2>
            ${links.length ? `<ul class="plain">${links.map((l) => `<li><span class="badge ${l.type}">${esc(l.type)}</span>
              <a href="${u(`/${lang}${l.href}`)}">${esc(l.label)}</a> <time>${esc(String(l.at || '').slice(0, 10))}</time></li>`).join('')}</ul>`
              : `<p class="empty">${esc(t.noActs)}</p>`}
          </section>`, { active: 'constitution' }));
      }
    }
  }

  // journal
  write(`${lang}/journal`, page(lang, t.journal, `
    <h1>${esc(t.journal)}</h1>
    ${journalIssues.slice().reverse().map((j) => `<article class="issue" id="j${j.number}">
      <header><span class="num">${esc(t.number)} ${j.number}</span><time>${esc(j.date)}</time></header>
      <h2>${esc(lang === 'fr' ? j.title_fr || j.title_en : j.title_en)}</h2>
      ${j.body.split('\n\n').map((p) => `<p>${linkify(lang, p.replace(/\n/g, ' '))}</p>`).join('')}
      ${j.cites ? `<p class="under">${esc(t.under)} ${[].concat(j.cites).map((c) => linkify(lang, c)).join(', ')}</p>` : ''}
    </article>`).join('')}`, { active: 'journal' }));

  // register
  write(`${lang}/register`, page(lang, t.register, `
    <h1>${esc(t.register)}</h1>
    <section>
      <h2>${esc(t.offices)}</h2>
      <table class="grid"><thead><tr><th>${esc(t.offices)}</th><th>${esc(t.holder)}</th><th>${esc(t.since)}</th><th>${esc(t.permissions)}</th></tr></thead>
      <tbody>${offs.map((o) => `<tr>
        <td>${esc(lang === 'fr' ? o.title_fr : o.title_en)}</td>
        <td><code>${esc(o.holder)}</code></td>
        <td>${esc(o.since)}</td>
        <td class="perms">${(o.permissions || []).map((p) => `<code>${esc(p)}</code>`).join(' ')}</td></tr>`).join('')}</tbody></table>
    </section>
    <section>
      <h2>${esc(t.citizens)} <span class="count">${active.length}</span></h2>
      <table class="grid"><thead><tr><th>id</th><th>${esc(t.status)}</th><th>${esc(t.admitted)}</th><th>${esc(t.under)}</th></tr></thead>
      <tbody>${roll.map((c) => `<tr>
        <td><code>${esc(c.id)}</code></td><td>${esc(c.status)}</td><td>${esc(c.admitted)}</td>
        <td>${linkify(lang, c.admitted_under || '')}</td></tr>`).join('')}</tbody></table>
      <p class="note">art-07/§37/¶2 — ${lang === 'fr' ? 'le registre ne désigne une personne que par son identifiant.' : 'the register names no person; only identifiers appear here.'}</p>
    </section>
    <section>
      <h2>${esc(t.entities)} <span class="count">${ents.length}</span></h2>
      <table class="grid"><thead><tr><th>id</th><th>${esc(t.type)}</th><th>name</th><th>${esc(t.formed)}</th><th>${esc(t.under)}</th></tr></thead>
      <tbody>${ents.map((e) => `<tr>
        <td><code>${esc(e.id)}</code></td><td>${esc(e.type)}</td>
        <td>${esc(lang === 'fr' ? e.name_fr || e.name_en : e.name_en)}</td>
        <td>${esc(e.formed)}</td><td>${linkify(lang, e.formed_under || '')}</td></tr>`).join('')}</tbody></table>
    </section>`, { active: 'register' }));

  // ledger
  write(`${lang}/ledger`, page(lang, t.ledger, `
    <h1>${esc(t.ledger)}</h1>
    <p class="note">art-02/§9 — ${lang === 'fr' ? 'aucun enregistrement n’est modifié ; une rectification est un nouvel enregistrement.' : 'no record is altered; a correction is a new record.'}</p>
    <table class="ledger full"><thead><tr><th>#</th><th>${esc(t.at)}</th><th>${esc(t.kind)}</th><th>${esc(t.author)}</th><th>${esc(t.under)}</th><th>payload</th><th>hash</th></tr></thead>
    <tbody>${events.slice().reverse().map((e) => `<tr id="r${e.seq}">
      <td class="seq">${e.seq}</td>
      <td><time>${esc(e.at.slice(0, 16).replace('T', ' '))}</time></td>
      <td class="kind">${esc(e.kind)}</td>
      <td class="who"><code>${esc(e.author)}</code></td>
      <td class="prov">${linkify(lang, e.provision)}</td>
      <td class="payload"><code>${esc(JSON.stringify(e.payload))}</code></td>
      <td class="hash"><code>${esc(e.hash.slice(0, 12))}</code></td>
    </tr>`).join('')}</tbody></table>`, { active: 'ledger', wide: true }));

  // proposals
  write(`${lang}/proposals`, page(lang, t.proposals, `
    <h1>${esc(t.proposals)}</h1>
    ${proposals.map((p) => `<article class="issue" id="${esc(p.id)}">
      <header><span class="num">${esc(p.id)}</span><span class="tag">${esc(meta.classes[p.class]?.[`label_${lang}`] || p.class)}</span></header>
      <h2>${esc(p.title)}</h2>
      <p class="under">${esc(t.under)} ${[].concat(p.cites || []).map((c) => linkify(lang, c)).join(', ')}</p>
      ${p.body.split('\n\n').map((b) => `<p>${linkify(lang, b.replace(/\n/g, ' ').replace(/^#+\s*/, ''))}</p>`).join('')}
      ${p.result ? `<div class="result ${p.result.outcome?.carried ? 'carried' : 'failed'}">
        <strong>${p.result.outcome?.carried ? 'CARRIED' : 'NOT CARRIED'}</strong> —
        ${p.result.outcome?.yes} yes · ${p.result.outcome?.no} no ·
        ${p.result.accepted?.length} ballots · quorum ${p.result.outcome?.quorumMet ? 'met' : 'not met'}
      </div>` : ''}
    </article>`).join('')}`, { active: 'proposals' }));

  // checkpoints
  write(`${lang}/checkpoints`, page(lang, t.checkpoints, `
    <h1>${esc(t.checkpoints)}</h1>
    <p class="note">art-02/§10/¶3 — ${lang === 'fr' ? 'vérifiable par toute personne, sans autorisation et sans compte.' : 'verifiable by any person, without permission and without an account.'}</p>
    <table class="grid"><thead><tr><th>${esc(t.number)}</th><th>${esc(t.at)}</th><th>${esc(t.records)}</th><th>${esc(t.root)}</th><th>signed</th></tr></thead>
    <tbody>${checkpoints.slice().reverse().map((c) => `<tr>
      <td>${c.number}</td><td><time>${esc(c.at.slice(0, 16).replace('T', ' '))}</time></td>
      <td>${c.records}</td><td class="hash"><code>${esc(c.root.slice(0, 24))}…</code></td>
      <td>${c.signature ? '✓' : '—'}</td></tr>`).join('')}</tbody></table>
    <pre class="cmd">git clone &lt;repository&gt;
cd republic &amp;&amp; npm install
npm run verify</pre>`, { active: 'checkpoints' }));
}

const count = countFiles(OUT);
console.log(`Built ${count} pages into dist/`);
console.log(`  languages: ${constitution.langs.join(', ')}`);
console.log(`  provisions addressable: ${index.size}`);
console.log(`  backlinked provisions: ${backlinks.size}`);

function countFiles(dir) {
  let n = 0;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) n += countFiles(path.join(dir, f.name));
    else if (f.name.endsWith('.html')) n++;
  }
  return n;
}
