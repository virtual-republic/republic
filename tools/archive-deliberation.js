#!/usr/bin/env node
// Copies GitHub Discussions into the repository so the record of deliberation
// survives the platform (art-08/§42/¶2). Uses the gh CLI, already present on
// runners; run `gh auth login` locally.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = process.env.GITHUB_REPOSITORY || execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).toString().trim();
const [owner, name] = repo.split('/');

const query = `query($owner:String!,$name:String!){
  repository(owner:$owner,name:$name){
    discussions(first:50, orderBy:{field:UPDATED_AT,direction:DESC}){
      nodes{ number title createdAt url body author{login}
        comments(first:100){ nodes{ createdAt body author{login} } } } } } }`;

let data;
try {
  const out = execFileSync('gh', ['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${owner}`, '-F', `name=${name}`]).toString();
  data = JSON.parse(out).data.repository.discussions.nodes;
} catch (e) {
  console.error('could not read discussions:', e.message);
  process.exit(0);
}

let written = 0;
for (const d of data) {
  const m = d.title.match(/\b(P-\d{4})\b/);
  if (!m) continue;                       // only deliberation on measures is archived
  const id = m[1];
  const dir = path.join('proposals', id);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    `# Deliberation on ${id}`, '',
    `Archived from ${d.url} under art-08/§42/¶2.`, '',
    `## ${d.title}`, `*${d.author?.login ?? 'unknown'} — ${d.createdAt}*`, '', d.body.trim(), '',
  ];
  for (const c of d.comments.nodes) {
    lines.push('---', '', `*${c.author?.login ?? 'unknown'} — ${c.createdAt}*`, '', c.body.trim(), '');
  }
  fs.writeFileSync(path.join(dir, 'deliberation.md'), lines.join('\n'));
  written++;
}
console.log(`archived deliberation for ${written} measure(s)`);
