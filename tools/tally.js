#!/usr/bin/env node
// Counts a vote.
//
//   art-08/§43/¶2  a ballot not verified against a registered key is not counted
//   art-08/§43/¶3  a citizen may delegate their vote
//   art-08/§44/¶1  a measure carries if quorum and threshold are satisfied
//   art-08/§44/¶3  the tally must be reproducible by any person
//   art-08/§44/¶4  the tally is performed by the published tool
//   art-08/§46/¶1  offices are filled by instant-runoff
//
// Usage: node tools/tally.js <proposal-id>
//
// Ballots live in ballots/<proposal-id>/<citizen-id>.json and look like:
//   { "proposal": "P-0007", "choice": "yes", "salt": "...", "signature": "-----BEGIN..." }
// The signature covers the canonical form of {proposal, choice, salt}.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { canonical, sha256 } from './lib/events.js';
import { verify } from './lib/sshsig.js';
import { activeCitizens, keysFor } from './lib/registers.js';
import { loadMeta } from './lib/constitution.js';

const ROOT = process.cwd();
const proposalId = process.argv[2];
if (!proposalId) {
  console.error('usage: node tools/tally.js <proposal-id>');
  process.exit(2);
}

const meta = loadMeta(ROOT);
const roll = activeCitizens(ROOT);
const rollIds = new Set(roll.map((c) => c.id));

// Locate the measure.
const proposalFile = fs
  .readdirSync(path.join(ROOT, 'proposals'))
  .find((f) => f.startsWith(proposalId) || f.includes(proposalId));
if (!proposalFile) {
  console.error(`no proposal matching "${proposalId}"`);
  process.exit(2);
}
const src = fs.readFileSync(path.join(ROOT, 'proposals', proposalFile), 'utf8');
const front = yaml.load(src.slice(4, src.indexOf('\n---', 3))) || {};
const spec = meta.classes[front.class];

// --- collect ballots -------------------------------------------------------

const dir = path.join(ROOT, 'ballots', front.id);
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];

const accepted = [];
const rejected = [];

for (const f of files) {
  const ballot = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const citizenId = path.basename(f, '.json');

  if (!rollIds.has(citizenId)) {
    rejected.push({ citizenId, reason: 'not an active citizen' });
    continue;
  }
  if (ballot.proposal !== front.id) {
    rejected.push({ citizenId, reason: `ballot is for ${ballot.proposal}` });
    continue;
  }

  const message = canonical({ proposal: ballot.proposal, choice: ballot.choice, salt: ballot.salt });
  const result = verify(message, ballot.signature || '', keysFor(ROOT, citizenId), { namespace: 'republic' });
  if (!result.ok) {
    rejected.push({ citizenId, reason: result.error });
    continue;
  }

  accepted.push({
    citizenId,
    choice: ballot.choice,
    // art-08/§44/¶2 — the material by which a citizen may confirm their own ballot
    receipt: sha256(message).slice(0, 16),
  });
}

// --- delegation (art-08/§43/¶3) -------------------------------------------
// A citizen who has not voted, and who has delegated, lends their weight to
// their delegate. Chains are followed; cycles are broken and reported.

const votedDirectly = new Set(accepted.map((b) => b.citizenId));
const delegations = new Map();
for (const c of roll) {
  const to = c.delegate_to || (c.delegations && c.delegations[front.class]);
  if (to) delegations.set(c.id, to);
}

const weights = new Map(accepted.map((b) => [b.citizenId, 1]));
const delegated = [];

for (const c of roll) {
  if (votedDirectly.has(c.id) || !delegations.has(c.id)) continue;
  const seen = new Set([c.id]);
  let target = delegations.get(c.id);
  while (target && !votedDirectly.has(target) && delegations.has(target) && !seen.has(target)) {
    seen.add(target);
    target = delegations.get(target);
  }
  if (target && votedDirectly.has(target)) {
    weights.set(target, (weights.get(target) || 0) + 1);
    delegated.push({ from: c.id, to: target });
  }
}

const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0);

// --- count -----------------------------------------------------------------

const isElection = front.class === 'election';
let outcome;

if (isElection) {
  outcome = instantRunoff(accepted, weights, front.candidates || []);
} else {
  const tallies = {};
  for (const b of accepted) {
    tallies[b.choice] = (tallies[b.choice] || 0) + (weights.get(b.citizenId) || 1);
  }
  const yes = tallies.yes || 0;
  const no = tallies.no || 0;
  const abstain = tallies.abstain || 0;
  const decisive = yes + no;
  const quorumNeeded = Math.ceil(spec.quorum * roll.length);
  const quorumMet = totalWeight >= quorumNeeded;
  const share = decisive ? yes / decisive : 0;
  const thresholdMet = share >= spec.threshold;

  outcome = {
    yes, no, abstain,
    cast: totalWeight,
    electorate: roll.length,
    quorumNeeded,
    quorumMet,
    share,
    thresholdMet,
    carried: quorumMet && thresholdMet,
  };
}

// --- report ----------------------------------------------------------------

console.log(`${front.id} — ${front.title}`);
console.log(`class: ${front.class} (${spec.label_en})\n`);

console.log(`Ballots accepted: ${accepted.length}`);
if (delegated.length) console.log(`Delegated weight: ${delegated.length} (${delegated.map((d) => `${d.from}→${d.to}`).join(', ')})`);
if (rejected.length) {
  console.log(`Ballots not counted: ${rejected.length}`);
  for (const r of rejected) console.log(`  ✗ ${r.citizenId}: ${r.reason} (art-08/§43/¶2)`);
}
console.log('');

if (isElection) {
  outcome.rounds.forEach((round, i) => {
    console.log(`Round ${i + 1}:`);
    for (const [c, v] of round.counts) console.log(`    ${String(v).padStart(4)}  ${c}`);
    if (round.eliminated) console.log(`    eliminated: ${round.eliminated}`);
  });
  console.log(`\nElected: ${outcome.winner ?? 'no result'}`);
} else {
  console.log(`  yes      ${outcome.yes}`);
  console.log(`  no       ${outcome.no}`);
  console.log(`  abstain  ${outcome.abstain}`);
  console.log('');
  console.log(`  quorum    ${outcome.cast}/${outcome.electorate} cast, ${outcome.quorumNeeded} needed — ${outcome.quorumMet ? 'met' : 'NOT MET'}`);
  console.log(`  threshold ${(outcome.share * 100).toFixed(2)}% of decisive votes, ${(spec.threshold * 100).toFixed(2)}% needed — ${outcome.thresholdMet ? 'met' : 'NOT MET'}`);
  console.log('');
  console.log(outcome.carried ? '  CARRIED (art-08/§44/¶1)' : '  NOT CARRIED (art-08/§44/¶1)');
}

console.log('\nReceipts — each citizen may confirm their own (art-08/§44/¶2):');
for (const b of accepted) console.log(`  ${b.citizenId}  ${b.receipt}`);

const out = { proposal: front.id, class: front.class, at: new Date().toISOString(), accepted, rejected, delegated, outcome };
fs.mkdirSync(path.join(ROOT, 'ballots', front.id), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'ballots', front.id, '_result.json'), JSON.stringify(out, null, 2));
console.log(`\nWritten to ballots/${front.id}/_result.json`);

process.exit(isElection ? 0 : outcome.carried ? 0 : 1);

// --- instant runoff (art-08/§46) ------------------------------------------

function instantRunoff(ballots, weights, candidates) {
  const active = new Set(candidates.length ? candidates : ballots.flatMap((b) => b.choice));
  const rounds = [];

  while (active.size > 1) {
    const counts = new Map([...active].map((c) => [c, 0]));
    let total = 0;
    for (const b of ballots) {
      const ranking = Array.isArray(b.choice) ? b.choice : [b.choice];
      const top = ranking.find((c) => active.has(c));
      if (top) {
        const w = weights.get(b.citizenId) || 1;
        counts.set(top, counts.get(top) + w);
        total += w;
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted[0][1] > total / 2) {
      rounds.push({ counts: sorted, eliminated: null });
      return { rounds, winner: sorted[0][0] };
    }
    const last = sorted[sorted.length - 1][0];
    rounds.push({ counts: sorted, eliminated: last });
    active.delete(last);
  }
  const winner = [...active][0] ?? null;
  return { rounds, winner };
}
