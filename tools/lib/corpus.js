// The citation system.
//
// Every addressable text in the Republic gets an identifier of the form
//
//     <corpus>.<document>[/§n][/¶n]
//
//     const.art-05/§48/¶1     a provision of the Constitution
//     stat.unit-of-account/§3 a section of an organic statute
//     jour.2026/1             an issue of the Journal
//     jdgt.2026/2             a judgment
//     prop.P-0002/§1          a measure's own text
//
// Bare constitutional citations (art-05/§48/¶1) are accepted everywhere and
// normalise to const.* — the ledger is full of them and art-02/§9 forbids
// rewriting it.
//
// One index serves the builder, the tools and the browser, so a citation
// resolves identically wherever it appears.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { loadConstitution, provisionIndex } from './constitution.js';

export const CORPORA = {
  const: { label: 'Constitution', dir: 'constitution' },
  stat: { label: 'Statute', dir: 'statutes' },
  jour: { label: 'Journal', dir: 'issues' },
  jdgt: { label: 'Judgment', dir: 'judgments' },
  prop: { label: 'Measure', dir: 'proposals' },
};

// One corpus root. Falls back to the old layout if migrate.js has not run.
export function where(root, kind) {
  const moved = { const: 'journal/constitution', stat: 'journal/statutes', jdgt: 'journal/judgments', jour: 'journal/issues' }[kind];
  if (moved && fs.existsSync(path.join(root, moved))) return moved;
  return { const: 'constitution', stat: 'statutes', jdgt: 'judgments', jour: 'journal' }[kind];
}

const SUPERS = '¹²³⁴⁵⁶⁷⁸⁹';

export function normalise(raw) {
  let c = String(raw).trim().replace(/\s+/g, '');
  c = c.replace(/§§/g, '§');
  // Bare constitutional citation, or the old art-NN form.
  if (/^art[-.]?\d/i.test(c)) c = 'const.' + c.replace(/^art[.]/i, 'art-').replace(/^art(\d)/i, 'art-$1');
  if (/^Article/i.test(c)) c = 'const.' + c.replace(/^Article/i, 'art-');
  return c;
}

export function corpusOf(id) {
  const m = String(id).match(/^([a-z]{3,5})\./);
  return m ? m[1] : null;
}

// js-yaml turns ISO dates into Date objects; everything here wants strings.
export const isoDate = (v) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);

function frontmatter(src) {
  if (!src.startsWith('---')) return [{}, src];
  const end = src.indexOf('\n---', 3);
  if (end === -1) return [{}, src];
  return [yaml.load(src.slice(4, end)) || {}, src.slice(end + 4)];
}

// A generic §/¶ parser, shared by statutes, judgments and measures.
export function parseSections(body) {
  const sections = [];
  let current = null;
  const PARA = new RegExp(`^([${SUPERS}])\\s+`);
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    const h = line.match(/^##\s+§\s*(\d+)\s*(.*)$/);
    if (h) { current = { num: Number(h[1]), heading: (h[2] || '').trim(), paragraphs: [] }; sections.push(current); continue; }
    const p = line.match(PARA);
    if (p && current) { current.paragraphs.push({ num: SUPERS.indexOf(p[1]) + 1, text: line.slice(p[0].length).trim() }); continue; }
    if (!line.trim()) continue;
    if (current && current.paragraphs.length) {
      current.paragraphs[current.paragraphs.length - 1].text += ' ' + line.trim();
    }
  }
  return sections;
}

function loadDocs(root, dir, ext = '.md') {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  const out = [];
  const walk = (d, rel = '') => {
    for (const f of fs.readdirSync(d).sort()) {
      const p = path.join(d, f);
      // Superseded texts are kept for the record, not for the code. The text in
      // force is the one at the top of statutes/ — art-11/§62/¶3.
      if (f === 'superseded') continue;
      if (fs.statSync(p).isDirectory()) walk(p, path.join(rel, f));
      else if (f.endsWith(ext)) out.push({ rel: path.join(rel, f), file: p, src: fs.readFileSync(p, 'utf8') });
    }
  };
  walk(full);
  return out;
}

// Build the whole resolver index.
export function buildCorpus(root) {
  const entries = new Map();   // id -> { id, corpus, href, label, text: {lang: string} }
  const add = (id, e) => { if (!entries.has(id)) entries.set(id, { id, text: {}, ...e }); return entries.get(id); };

  // ---- Constitution -------------------------------------------------------
  const constitution = loadConstitution(root);
  const provisions = provisionIndex(constitution);
  for (const [bare, p] of provisions) {
    const id = 'const.' + bare;
    const slug = bare.replace(/§/g, 's').replace(/¶/g, 'p').replace(/\//g, '-');
    const e = add(id, {
      corpus: 'const',
      href: `/journal/constitution/${slug}/`,
      label: bare,
      kind: p.kind,
      document: p.article,
    });
    if (p.text) Object.assign(e.text, p.text);
  }

  // ---- Statutes -----------------------------------------------------------
  const statutes = [];
  for (const d of loadDocs(root, where(root, 'stat'))) {
    const [meta, body] = frontmatter(d.src);
    const slug = meta.id || path.basename(d.rel, '.md');
    const lang = meta.lang || (d.rel.startsWith('fr/') ? 'fr' : 'en');
    let doc = statutes.find((s) => s.slug === slug);
    if (!doc) { doc = { slug, versions: {} }; statutes.push(doc); }
    doc.versions[lang] = { ...meta, sections: parseSections(body) };

    add(`stat.${slug}`, { corpus: 'stat', href: `/journal/law/${slug}/`, label: meta.title || slug, kind: 'document', document: slug });
    for (const sec of doc.versions[lang].sections) {
      const sid = `stat.${slug}/§${sec.num}`;
      add(sid, { corpus: 'stat', href: `/journal/law/${slug}/#s${sec.num}`, label: `${slug} § ${sec.num}`, kind: 'section', document: slug }).text[lang] = sec.heading;
      for (const p of sec.paragraphs) {
        add(`${sid}/¶${p.num}`, { corpus: 'stat', href: `/journal/law/${slug}/#s${sec.num}p${p.num}`, label: `${slug} § ${sec.num} ¶ ${p.num}`, kind: 'paragraph', document: slug }).text[lang] = p.text;
      }
    }
  }

  // ---- Journal ------------------------------------------------------------
  const journal = [];
  for (const d of loadDocs(root, where(root, 'jour'))) {
    const [meta, body] = frontmatter(d.src);
    const year = isoDate(meta.date).slice(0, 4) || path.dirname(d.rel);
    const issue = { ...meta, date: isoDate(meta.date), year, body: body.trim(), id: `jour.${year}/${meta.number}` };
    journal.push(issue);
    add(issue.id, { corpus: 'jour', href: `/journal/issues/${meta.number}/`, label: `Journal ${meta.number}`, kind: 'issue', document: `${year}/${meta.number}` });
  }
  journal.sort((a, b) => (a.number || 0) - (b.number || 0));

  // ---- Judgments ----------------------------------------------------------
  const judgments = [];
  for (const d of loadDocs(root, where(root, 'jdgt'))) {
    const [meta, body] = frontmatter(d.src);
    const year = isoDate(meta.date).slice(0, 4);
    const j = { ...meta, year, body: body.trim(), id: `jdgt.${year}/${meta.number}` };
    judgments.push(j);
    add(j.id, { corpus: 'jdgt', href: `/journal/court/${meta.number}/`, label: `Judgment ${meta.number}`, kind: 'judgment', document: `${year}/${meta.number}` });
  }

  // ---- Measures -----------------------------------------------------------
  const proposals = [];
  for (const d of loadDocs(root, 'proposals')) {
    if (path.basename(d.rel) === 'TEMPLATE.md') continue;
    if (path.basename(d.rel) === 'deliberation.md') continue;
    const [meta, body] = frontmatter(d.src);
    if (!meta.id) continue;
    const p = { ...meta, body: body.trim(), sections: parseSections(body), file: d.rel };
    proposals.push(p);
    add(`prop.${meta.id}`, { corpus: 'prop', href: `/assembly/${meta.id}/`, label: meta.id, kind: 'measure', document: meta.id });
    for (const sec of p.sections) {
      add(`prop.${meta.id}/§${sec.num}`, { corpus: 'prop', href: `/assembly/${meta.id}/#s${sec.num}`, label: `${meta.id} § ${sec.num}`, kind: 'section', document: meta.id });
    }
  }

  return { constitution, provisions, statutes, journal, judgments, proposals, entries };
}

// ---- linkifying prose ------------------------------------------------------

// Explicit identifiers, with or without the corpus prefix.
const ID_RE = /\b(?:(const|stat|jour|jdgt|prop)\.)?([a-zA-Z0-9-]{2,40})(?:\/(§\d+))?(?:\/(¶\d+))?/g;
// Prose form: "Article 7 § 38 ²" / "l'article 3 § 16 ⁵"
const PROSE_RE = new RegExp(`\\b[Aa]rticles?\\s+(\\d{1,2})(?:\\s*§+\\s*(\\d{1,3}))?(?:\\s*([${SUPERS}]))?`, 'g');

export function linkify(text, entries, { esc = (s) => s, base = '' } = {}) {
  let out = esc(text);

  out = out.replace(ID_RE, (m, corpus, doc, sec, para) => {
    if (!corpus && !/^art-\d/.test(doc)) return m;          // don't touch ordinary words
    const id = normalise(`${corpus ? corpus + '.' : ''}${doc}${sec ? '/' + sec : ''}${para ? '/' + para : ''}`);
    const hit = entries.get(id);
    return hit ? `<a class="cite" href="${base}${hit.href}" data-cite="${id}">${m}</a>` : m;
  });

  out = out.replace(PROSE_RE, (m, art, sec, para) => {
    const parts = ['const.art-' + String(art).padStart(2, '0')];
    if (sec) parts.push('§' + sec);
    if (para) parts.push('¶' + (SUPERS.indexOf(para) + 1));
    const id = parts.join('/');
    const hit = entries.get(id);
    return hit ? `<a class="cite" href="${base}${hit.href}" data-cite="${id}">${m}</a>` : m;
  });

  return out;
}

export function resolves(entries, citation) {
  return entries.has(normalise(citation));
}
