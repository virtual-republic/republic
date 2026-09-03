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
const REPO = process.env.GITHUB_REPOSITORY || 'virtual-republic/republic';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
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
    vote: 'Vote', propose: 'Propose', join: 'Join', articles: 'Articles',
    verifyHere: 'Verify in this browser', verifying: 'Verifying the register\u2026',
    identity: 'Your citizenship', newKey: 'Create a citizenship', haveKey: 'Load a key',
    openGitHub: 'Open on GitHub', download: 'Download key', forget: 'Forget key',
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

function page(lang, title, body, { active = '', wide = false, script = '', side = '' } = {}) {
  const t = T[lang];
  const other = lang === 'en' ? 'fr' : 'en';
  const nav = [
    ['', t.home], ['constitution', t.constitution], ['journal', t.journal],
    ['register', t.register], ['ledger', t.ledger], ['proposals', t.proposals],
    ['checkpoints', t.checkpoints],
  ];
  const acts = [['vote', t.vote], ['propose', t.propose], ['join', t.join]];
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
    ${acts.map(([slug, label]) => `<a class="act" href="${u(`/${lang}/${slug}/`)}"${active === slug ? ' class="on"' : ''}>${esc(label)}</a>`).join('')}
    <a class="lang" href="${u(`/${other}/`)}">${other.toUpperCase()}</a>
  </nav>
</header>
<main>${side ? `<div class="withside"><aside class="side">${side}</aside><div>${body}</div></div>` : body}</main>
${script ? `<script type="module">${script}</script>` : ''}
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

  const toc = (currentId) => `<h3>${esc(t.articles)}</h3><ol>` + constitution.articles.map((a) => {
    const v = a.versions[lang] || a.versions.en;
    return `<li><a href="${provHref(lang, a.id)}"${a.id === currentId ? ' class="on"' : ''}><span class="artno">${esc(a.id.replace('art-',''))}</span>${esc(v.title)}</a></li>`;
  }).join('') + '</ol>';

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
    }).join('')}</ol>`, { active: 'constitution', side: toc(null) }));

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
    write(provPath(lang, art.id), page(lang, `${art.id} · ${v.title}`, body, { active: 'constitution', side: toc(art.id) }));

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
          </section>`, { active: 'constitution', side: toc(art.id) }));
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
    <div class="verifybar" id="vbar"><span class="dot"></span><span id="vtext">${esc(t.verifying)}</span></div>
    <p class="note">art-02/§10/¶3 — ${lang === 'fr' ? 'vérifiable par toute personne, sans autorisation et sans compte.' : 'verifiable by any person, without permission and without an account.'}</p>
    <table class="grid"><thead><tr><th>${esc(t.number)}</th><th>${esc(t.at)}</th><th>${esc(t.records)}</th><th>${esc(t.root)}</th><th>signed</th></tr></thead>
    <tbody>${checkpoints.slice().reverse().map((c) => `<tr>
      <td>${c.number}</td><td><time>${esc(c.at.slice(0, 16).replace('T', ' '))}</time></td>
      <td>${c.records}</td><td class="hash"><code>${esc(c.root.slice(0, 24))}…</code></td>
      <td>${c.signature ? '✓' : '—'}</td></tr>`).join('')}</tbody></table>
    <pre class="cmd">git clone &lt;repository&gt;
cd republic &amp;&amp; npm install
npm run verify</pre>`, { active: 'checkpoints', script: `
    import * as R from '${u('/republic.js')}';
    const bar = document.getElementById('vbar'), text = document.getElementById('vtext');
    try {
      const events = await (await fetch('${u('/data/events.jsonl')}')).text();
      const r = await R.verifyRegister(events);
      const root = await R.merkleRoot(r.events.map((e) => e.hash));
      bar.classList.add(r.ok ? 'good' : 'bad');
      text.textContent = r.ok
        ? r.count + ' records verified in this browser \u00b7 head ' + r.head.slice(0, 16) + '\u2026 \u00b7 root ' + root.slice(0, 16) + '\u2026'
        : r.problems.length + ' problem(s): ' + r.problems.map((p) => 'record ' + p.seq + ' ' + p.error).join('; ');
    } catch (e) {
      bar.classList.add('bad');
      text.textContent = 'could not verify: ' + e.message;
    }` }));
}


// ---- client data + interactive pages -------------------------------------

fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'data/proposals.json'), JSON.stringify(
  proposals.map((p) => ({ id: p.id, title: p.title, class: p.class, cites: [].concat(p.cites || []), carried: p.result?.outcome?.carried ?? null })), null, 2));
fs.writeFileSync(path.join(OUT, 'data/citizens.json'), JSON.stringify(
  roll.map((c) => ({ id: c.id, status: c.status, admitted: c.admitted, keys: c.keys || [] })), null, 2));
fs.writeFileSync(path.join(OUT, 'data/meta.json'), JSON.stringify(
  { repo: REPO, branch: BRANCH, base: BASE, classes: meta.classes, electorate: active.length }, null, 2));
fs.copyFileSync(path.join(ROOT, 'site/republic.js'), path.join(OUT, 'republic.js'));
fs.copyFileSync(path.join(ROOT, 'ledger/events.jsonl'), path.join(OUT, 'data/events.jsonl'));

const IDENTITY = (lang) => `
<section class="panel" id="identity">
  <h2>${T[lang].identity}</h2>
  <div id="who" class="status">no citizenship loaded in this browser</div>
  <div class="row">
    <button id="gen">${T[lang].newKey}</button>
    <button id="load" class="ghost">${T[lang].haveKey}</button>
    <button id="forget" class="ghost">${T[lang].forget}</button>
  </div>
  <label for="pem" hidden>key</label>
  <textarea id="pem" hidden placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
  <div id="pub" class="out" hidden></div>
  <p class="identity">The key is generated here and stays in this browser. Nothing is sent anywhere.
  One person may hold several citizenships — art-02/&sect;13/&para;2.</p>
</section>`;

const IDENTITY_JS = `
import * as R from '${u('/republic.js')}';
const $ = (id) => document.getElementById(id);
const meta = await (await fetch('${u('/data/meta.json')}')).json();
let priv = null, pubLine = null, citizenId = null;

async function adopt(pemText, id) {
  priv = await R.importPrivateKey(pemText);
  pubLine = R.publicKeyLine(priv.raw, id || '');
  const roll = await (await fetch('${u('/data/citizens.json')}')).json();
  const match = roll.find((c) => (c.keys || []).some((k) => k.split(/\\s+/)[1] === pubLine.split(/\\s+/)[1]));
  citizenId = match ? match.id : (id || null);
  $('who').textContent = match
    ? 'signed in as ' + match.id + ' (on the register)'
    : 'key loaded, not yet on the register — use Join';
  $('who').className = 'status';
  $('pub').hidden = false;
  $('pub').textContent = pubLine;
  document.dispatchEvent(new CustomEvent('identity', { detail: { priv, pubLine, citizenId } }));
}

$('gen').onclick = async () => {
  const kp = await R.generateKey('');
  R.vault.save(null, kp.privateKeyB64);
  const blob = new Blob([kp.privateKeyPem], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'citizenship-key.pem'; a.click();
  await adopt(kp.privateKeyPem, '');
};
$('load').onclick = () => { $('pem').hidden = !$('pem').hidden; $('pem').focus(); };
$('pem').onchange = async () => { try { R.vault.save(null, $('pem').value); await adopt($('pem').value, ''); } catch (e) { $('who').textContent = 'that key could not be read'; $('who').className = 'status bad'; } };
$('forget').onclick = () => { R.vault.clear(); location.reload(); };

const held = R.vault.load();
if (held) { try { await adopt('-----BEGIN PRIVATE KEY-----\\n' + held.key + '\\n-----END PRIVATE KEY-----', held.id); } catch {} }
if (!R.supported()) { $('who').textContent = 'this browser has no Web Crypto'; $('who').className = 'status bad'; }
`;

for (const lang of constitution.langs) {
  const t = T[lang];

  // ---- vote -------------------------------------------------------------
  write(`${lang}/vote`, page(lang, t.vote, `
    <h1>${esc(t.vote)}</h1>
    <p class="note">art-08/&sect;43/&para;2 — a ballot not verified against a registered key is not counted.
    Your ballot is signed in this browser and committed by you on GitHub. Nothing passes through a server.</p>
    ${IDENTITY(lang)}
    <section class="panel">
      <h2>${esc(t.vote)}</h2>
      <label for="measure">measure</label>
      <select id="measure"></select>
      <label>choice</label>
      <div class="choices">
        <button data-choice="yes" aria-pressed="false">yes</button>
        <button data-choice="no" aria-pressed="false">no</button>
        <button data-choice="abstain" aria-pressed="false">abstain</button>
      </div>
      <div class="row">
        <button id="sign" disabled>sign ballot</button>
        <a id="commit" class="btn" hidden>${esc(t.openGitHub)}</a>
      </div>
      <div id="result" class="out" hidden></div>
    </section>`, { active: 'vote', script: IDENTITY_JS + `
    const proposals = await (await fetch('${u('/data/proposals.json')}')).json();
    const sel = $('measure');
    sel.innerHTML = proposals.map((p) => '<option value="' + p.id + '">' + p.id + ' — ' + p.title + '</option>').join('')
      || '<option value="">no measures before the Assembly</option>';
    let choice = null;
    for (const b of document.querySelectorAll('.choices button')) {
      b.onclick = () => {
        choice = b.dataset.choice;
        for (const x of document.querySelectorAll('.choices button')) x.setAttribute('aria-pressed', String(x === b));
        $('sign').disabled = !(choice && priv);
      };
    }
    document.addEventListener('identity', () => { $('sign').disabled = !(choice && priv); });
    $('sign').onclick = async () => {
      const { ballot, receipt } = await R.makeBallot(sel.value, choice, priv);
      $('result').hidden = false;
      $('result').textContent = 'receipt ' + receipt + '\\n\\n' + JSON.stringify(ballot, null, 2);
      const link = $('commit');
      link.href = R.commitUrl(meta.repo, meta.branch,
        'ballots/' + sel.value + '/' + (citizenId || 'unregistered') + '.json',
        JSON.stringify(ballot, null, 2),
        'ballot: ' + sel.value + ' (art-08/\\u00a743)');
      link.hidden = false;
    };` }));

  // ---- propose ----------------------------------------------------------
  write(`${lang}/propose`, page(lang, t.propose, `
    <h1>${esc(t.propose)}</h1>
    <p class="note">art-08/&sect;41/&para;3 — a proposal that does not cite a resolvable provision is not received.
    Citations are checked here before you commit, and again by the workflow afterwards.</p>
    <section class="panel">
      <label for="pid">identifier</label><input type="text" id="pid" value="P-0002">
      <label for="ptitle">title</label><input type="text" id="ptitle" placeholder="Organic Statute on \\u2026">
      <label for="pclass">class</label><select id="pclass"></select>
      <label for="pcites">cites — one provision per line, e.g. art-09/&sect;48/&para;1</label>
      <textarea id="pcites" style="min-height:5rem"></textarea>
      <label for="pbody">text</label><textarea id="pbody" style="min-height:12rem"></textarea>
      <div class="row">
        <button id="check">check citations</button>
        <a id="pcommit" class="btn" hidden>${esc(t.openGitHub)}</a>
      </div>
      <div id="pstatus" class="status"></div>
      <div id="preview" class="out" hidden></div>
    </section>`, { active: 'propose', script: `
    import * as R from '${u('/republic.js')}';
    const $ = (id) => document.getElementById(id);
    const meta = await (await fetch('${u('/data/meta.json')}')).json();
    const index = await (await fetch('${u('/data/provisions.json')}')).json();
    $('pclass').innerHTML = Object.entries(meta.classes)
      .map(([k, v]) => '<option value="' + k + '">' + (v.label_${lang} || k) + '</option>').join('');
    $('check').onclick = () => {
      const cites = $('pcites').value.split('\\n').map((c) => c.trim()).filter(Boolean);
      const bad = cites.filter((c) => !index.includes(c));
      if (!cites.length) { $('pstatus').className = 'status bad'; $('pstatus').textContent = 'cites nothing — not received (art-08/\\u00a741/\\u00b63)'; $('pcommit').hidden = true; return; }
      if (bad.length) { $('pstatus').className = 'status bad'; $('pstatus').textContent = 'does not resolve: ' + bad.join(', '); $('pcommit').hidden = true; return; }
      const md = ['---', 'id: ' + $('pid').value, 'title: ' + $('ptitle').value,
        'sponsor: ' + (R.vault.load()?.id || 'c-0001'), 'class: ' + $('pclass').value, 'cites:',
        ...cites.map((c) => '  - ' + c), 'opened: ' + new Date().toISOString().slice(0, 10), '---', '',
        '## Text', '', $('pbody').value, ''].join('\\n');
      $('pstatus').className = 'status'; $('pstatus').textContent = 'all citations resolve — received';
      $('preview').hidden = false; $('preview').textContent = md;
      const link = $('pcommit');
      link.href = R.commitUrl(meta.repo, meta.branch,
        'proposals/' + $('pid').value + '-' + ($('ptitle').value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'measure') + '.md',
        md, 'propose: ' + $('pid').value + ' (art-08/\\u00a741)');
      link.hidden = false;
    };` }));

  // ---- join -------------------------------------------------------------
  write(`${lang}/join`, page(lang, t.join, `
    <h1>${esc(t.join)}</h1>
    <p class="note">art-03/&sect;16/&para;3 — admission takes effect on the recording of the application.
    No support, sponsorship, or seconding is required. You may hold more than one citizenship (art-02/&sect;13/&para;2).</p>
    ${IDENTITY(lang)}
    <section class="panel">
      <h2>${esc(t.join)}</h2>
      <label for="newid">identifier</label><input type="text" id="newid" placeholder="c-0002">
      <p class="identity">No name, no email, nothing personal goes on the register — art-07/&sect;37/&para;2.</p>
      <div class="row">
        <button id="apply" disabled>prepare application</button>
        <a id="jcommit" class="btn" hidden>${esc(t.openGitHub)}</a>
      </div>
      <div id="jout" class="out" hidden></div>
    </section>`, { active: 'join', script: IDENTITY_JS + `
    const roll = await (await fetch('${u('/data/citizens.json')}')).json();
    const next = 'c-' + String(roll.length + 1).padStart(4, '0');
    $('newid').value = next;
    document.addEventListener('identity', () => { $('apply').disabled = !priv; });
    $('apply').disabled = !priv;
    $('apply').onclick = () => {
      const id = $('newid').value.trim();
      const line = R.publicKeyLine(priv.raw, id);
      const yml = ['id: ' + id, 'status: active', 'admitted: ' + new Date().toISOString().slice(0, 10),
        'admitted_under: art-03/\\u00a716/\\u00b63', 'keys:', '  - ' + line, ''].join('\\n');
      $('jout').hidden = false; $('jout').textContent = yml;
      const link = $('jcommit');
      link.href = R.commitUrl(meta.repo, meta.branch, 'register/citizens/' + id + '.yml', yml,
        'admit ' + id + ' (art-03/\\u00a716)');
      link.hidden = false;
    };` }));
}

// provision index for the client-side citation check
fs.writeFileSync(path.join(OUT, 'data/provisions.json'), JSON.stringify([...index.keys()], null, 2));


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
