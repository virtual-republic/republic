// Parses the constitution into addressable provisions.
//
// Provision IDs look like:   art-02/§9/¶2
// They are stable across language versions. Article 1 § 6 ² requires that
// neither language be derived from the other, so both are parsed the same way
// and neither is treated as canonical.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

// One corpus root: journal/. A repository that has not run tools/migrate.js
// still works from the old layout.
export function constitutionDir(root) {
  const moved = path.join(root, 'journal/constitution');
  return fs.existsSync(moved) ? moved : path.join(root, 'constitution');
}

const PARA = /^([¹²³⁴⁵⁶⁷⁸⁹]|\(\d+\))\s+/;
const SUPER = { '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5, '⁶': 6, '⁷': 7, '⁸': 8, '⁹': 9 };

export function loadMeta(root) {
  return yaml.load(fs.readFileSync(path.join(constitutionDir(root), 'meta.yml'), 'utf8'));
}

function frontmatter(src) {
  if (!src.startsWith('---')) return [{}, src];
  const end = src.indexOf('\n---', 3);
  if (end === -1) return [{}, src];
  return [yaml.load(src.slice(4, end)) || {}, src.slice(end + 4)];
}

function parseArticle(src) {
  const [meta, body] = frontmatter(src);
  const sections = [];
  let current = null;
  let note = [];

  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    const heading = line.match(/^##\s+§\s*(\d+)\s+(.*)$/);
    if (heading) {
      current = { num: Number(heading[1]), heading: heading[2].trim(), paragraphs: [] };
      sections.push(current);
      continue;
    }
    const m = line.match(PARA);
    if (m && current) {
      const marker = m[1];
      const num = SUPER[marker] ?? Number(marker.replace(/[()]/g, ''));
      current.paragraphs.push({ num, text: line.slice(m[0].length).trim() });
      continue;
    }
    if (line.trim() === '') continue;
    if (current && current.paragraphs.length) {
      // continuation of the previous paragraph
      const last = current.paragraphs[current.paragraphs.length - 1];
      last.text += ' ' + line.trim();
    } else if (!current) {
      note.push(line);
    }
  }
  return { ...meta, note: note.join('\n').trim(), sections };
}

export function loadConstitution(root) {
  const meta = loadMeta(root);
  const langs = meta.languages.map((l) => l.code);
  const articles = [];

  for (const spec of meta.articles) {
    const versions = {};
    for (const lang of langs) {
      const file = path.join(constitutionDir(root), lang, `${spec.file}.md`);
      if (fs.existsSync(file)) {
        versions[lang] = parseArticle(fs.readFileSync(file, 'utf8'));
      }
    }
    articles.push({ ...spec, versions });
  }
  return { meta, langs, articles };
}

// Flat index: every addressable provision -> its text in each language.
export function provisionIndex(constitution) {
  const index = new Map();
  for (const art of constitution.articles) {
    index.set(art.id, { kind: 'article', article: art.id });
    for (const lang of Object.keys(art.versions)) {
      for (const sec of art.versions[lang].sections) {
        const secId = `${art.id}/§${sec.num}`;
        if (!index.has(secId)) index.set(secId, { kind: 'section', article: art.id, section: sec.num, text: {} });
        index.get(secId).text[lang] = sec.heading;
        for (const p of sec.paragraphs) {
          const pid = `${secId}/¶${p.num}`;
          if (!index.has(pid)) {
            index.set(pid, { kind: 'paragraph', article: art.id, section: sec.num, paragraph: p.num, text: {} });
          }
          index.get(pid).text[lang] = p.text;
        }
      }
    }
  }
  return index;
}

// Article 2 § 11: an act citing a provision that does not resolve is not received.
export function resolves(index, citation) {
  return index.has(normaliseCitation(citation));
}

export function normaliseCitation(c) {
  return String(c)
    .trim()
    .replace(/\s+/g, '')
    .replace(/§§/g, '§')
    .replace(/^art\./i, 'art-')
    .replace(/^Article\s*/i, 'art-');
}

export function entrenched(constitution, articleId) {
  const spec = constitution.articles.find((a) => a.id === articleId);
  return Boolean(spec && spec.entrenched);
}
