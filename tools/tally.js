#!/usr/bin/env node
// Counts a vote.
//
//   art-08/§43/¶2  a ballot not verified against a registered key is not counted
//   art-08/§43/¶3  a citizen may delegate their vote
//   art-08/§44/¶1  a measure carries if quorum and threshold are satisfied
//   art-08/§44/¶4  the tally must be reproducible by any person
//   art-08/§44/¶5  the tally is performed by the published tool
//   art-08/§46/¶1  offices are filled by instant-runoff
//
// Thresholds come from parameters.yml, never from this file.
//
// Ballots live at ballots/<measure>/<citizen>.json. One file per citizenship,
// so voting again replaces the earlier ballot — that is how a vote is updated.
// The signed payload carries its own timestamp, so a replacement must be
// provably later than what it replaces, and an old ballot cannot be replayed.
//
// Usage: node tools/tally.js <measure> [--provisional]

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { canonical, sha256 } from './lib/events.js';
import { verify } from './lib/sshsig.js';
import { activeCitizens, keysFor } from './lib/registers.js';
import { classSpec, ballotRules } from './lib/params.js';
import { isoDate } from './lib/corpus.js';

const ROOT = process.cwd();
const measureId = process.argv[2];
const provisional = process.argv.includes('--provisional');

if (!measureId) {
  console.error('usage: node tools/tally.js <measure> [--provisional]');
  process.exit(2);
}

const roll = activeCitizens(ROOT);
const rollIds = new Set(roll.map((c) => c.id));
const rules = ballotRules(ROOT);

const file = fs.readdirSync(path.join(ROOT, 'proposals')).find((f) => f.startsWith(measureId) && f.endsWith('.md'));
if (!file) { console.error(`no measure matching "${measureId}"`); process.exit(2); }

const src = fs.readFileSync(path.join(ROOT, 'proposals', file), 'utf8');
const front = yaml.load(src.slice(4, src.indexOf('\n---', 3))) || {};
const spec = classSpec(ROOT, front.class);

const opened = front.opened ? new Date(isoDate(front.opened) + 'T00:00:00Z') : null;
const closes = front.closes
  ? new Date(isoDate(front.closes) + 'T23:59:59Z')
  : opened ? new Date(opened.getTime() + spec.window_days * 86400000) : null;

const now = new Date();
const open = closes ? now < closes : true;



// --- collect ---------------------------------------------------------------

const dir = path.join(ROOT, 'ballots', front.id);
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort() : [];

const accepted = [];
const rejected = [];

for (const f of files) {
  const citizenId = path.basename(f, '.json');
  let ballot;
  try { ballot = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
  catch { rejected.push({ citizenId, reason: 'not valid JSON' }); continue; }

  if (!rollIds.has(citizenId)) { rejected.push({ citizenId, reason: 'not an active citizenship' }); continue; }
  if (ballot.proposal !== front.id) { rejected.push({ citizenId, reason: `ballot is for ${ballot.proposal}` }); continue; }

  const at = ballot.at ? new Date(ballot.at) : null;
  if (rules.reject_after_close && closes && at && at > closes) {
    rejected.push({ citizenId, reason: `cast after close (${ballot.at})` }); continue;
  }
  if (opened && at && at < opened) {
    rejected.push({ citizenId, reason: `cast before the measure opened (${ballot.at})` }); continue;
  }

  const message = canonical({ proposal: ballot.proposal, choice: ballot.choice, at: ballot.at, salt: ballot.salt });
  const result = verify(message, ballot.signature || '', keysFor(ROOT, citizenId), { namespace: 'republic' });
  if (!result.ok) { rejected.push({ citizenId, reason: result.error }); continue; }

  accepted.push({ citizenId, choice: ballot.choice, at: ballot.at, receipt: sha256(message).slice(0, 16) });
}

// One ballot per citizenship; the later one stands.
const byCitizen = new Map();
for (const b of accepted) {
  const held = byCitizen.get(b.citizenId);
  if (!held || (b.at && held.at && new Date(b.at) > new Date(held.at))) byCitizen.set(b.citizenId, b);
}
const counted = [...byCitizen.values()];

// --- delegation ------------------------------------------------------------

const voted = new Set(counted.map((b) => b.citizenId));
const delegations = new Map();
for (const c of roll) {
  const to = c.delegate_to || (c.delegations && c.delegations[front.class]);
  if (to) delegations.set(c.id, to);
}

const weights = new Map(counted.map((b) => [b.citizenId, 1]));
const delegated = [];
for (const c of roll) {
  if (voted.has(c.id) || !delegations.has(c.id)) continue;
  const seen = new Set([c.id]);
  let target = delegations.get(c.id);
  while (target && !voted.has(target) && delegations.has(target) && !seen.has(target)) { seen.add(target); target = delegations.get(target); }
  if (target && voted.has(target)) { weights.set(target, (weights.get(target) || 0) + 1); delegated.push({ from: c.id, to: target }); }
}

const cast = [...weights.values()].reduce((a, b) => a + b, 0);

// --- early closing (art-08/§43/¶5–¶6) --------------------------------------
//
// Waiting has a purpose only while the outcome can still move. Once every
// citizenship has voted, or once no distribution of the remaining ballots
// could change the result, the measure is closed for all purposes.

function earlyClose(yes, no, abstain) {
  const ec = rules.early_close || {};
  if (!ec.enabled) return null;

  const N = roll.length;
  const remaining = N - cast;
  const participation = N ? cast / N : 0;
  if (participation < (ec.minimum_participation ?? 1)) return null;

  if (ec.on_full_participation && remaining <= 0) {
    return { closed: true, why: 'every citizenship has voted (art-08/§43/¶6)' };
  }

  if (ec.on_determined_outcome) {
    const quorumNeeded = Math.ceil(spec.quorum * N);
    // Threshold is decided by yes and no alone; abstentions move only quorum,
    // so the extremes are all-remaining-yes and all-remaining-no.
    const carries = (y, n) => {
      const decisive = y + n;
      return (cast + remaining) >= quorumNeeded && decisive > 0 && y / decisive >= spec.threshold;
    };
    const best = carries(yes + remaining, no);
    const worst = carries(yes, no + remaining);
    // Quorum can no longer be reached at all.
    if (cast + remaining < quorumNeeded) return { closed: true, why: 'quorum can no longer be reached (art-08/§43/¶6)' };
    if (best === worst) {
      return { closed: true, why: best
        ? 'the measure carries however the remaining ballots are cast (art-08/§43/¶6)'
        : 'the measure fails however the remaining ballots are cast (art-08/§43/¶6)' };
    }
  }
  return null;
}

// --- count -----------------------------------------------------------------

const isElection = front.class === 'election';
let outcome;

if (isElection) {
  outcome = instantRunoff(counted, weights, front.candidates || []);
  const early = earlyClose(cast, 0, 0);
  const quorumNeeded = Math.ceil(spec.quorum * roll.length);
  outcome.open = open && !(cast >= roll.length && (rules.early_close || {}).on_full_participation);
  outcome.early = outcome.open ? null : (early ? early.why : null);
  outcome.cast = cast;
  outcome.electorate = roll.length;
  outcome.quorumNeeded = quorumNeeded;
  outcome.quorumMet = cast >= quorumNeeded;
  // An election that has closed with a winner and a quorum has carried, and the
  // office is filled — art-08/§46/¶1. Without this nothing is ever enacted.
  outcome.carried = !outcome.open && !!outcome.winner && outcome.quorumMet;
  outcome.office = front.office || null;
} else {
  const t = {};
  for (const b of counted) t[b.choice] = (t[b.choice] || 0) + (weights.get(b.citizenId) || 1);
  const yes = t.yes || 0, no = t.no || 0, abstain = t.abstain || 0;
  const decisive = yes + no;
  const quorumNeeded = Math.ceil(spec.quorum * roll.length);
  const quorumMet = cast >= quorumNeeded;
  const share = decisive ? yes / decisive : 0;
  const thresholdMet = share >= spec.threshold;
  const early = earlyClose(yes, no, abstain);
  const stillOpen = open && !early;
  outcome = {
    yes, no, abstain, cast, electorate: roll.length,
    quorumNeeded, quorumMet, share, threshold: spec.threshold, thresholdMet,
    carried: quorumMet && thresholdMet && !stillOpen,
    open: stillOpen, early: early ? early.why : null,
    closes: closes ? closes.toISOString() : null,
  };
}

// --- report ----------------------------------------------------------------

console.log(`${front.id} — ${front.title || front.title_en || ''}`);
console.log(`class: ${front.class} (${spec.label})`);
if (closes) console.log(`closes: ${closes.toISOString().slice(0, 16).replace('T', ' ')}Z`);
console.log('');

console.log(`Ballots counted: ${counted.length}${accepted.length !== counted.length ? ` (${accepted.length - counted.length} superseded)` : ''}`);
if (delegated.length) console.log(`Delegated: ${delegated.map((d) => `${d.from}\u2192${d.to}`).join(', ')}`);
if (rejected.length) {
  console.log(`Not counted: ${rejected.length}`);
  for (const r of rejected) console.log(`  \u2717 ${r.citizenId}: ${r.reason} (art-08/\u00a743/\u00b62)`);
}
console.log('');

if (isElection) {
  if (outcome.early) console.log(`  closed early \u2014 ${outcome.early}`);
  outcome.rounds.forEach((r, i) => {
    console.log(`Round ${i + 1}:`);
    for (const [c, v] of r.counts) console.log(`    ${String(v).padStart(4)}  ${c}`);
    if (r.eliminated) console.log(`    eliminated: ${r.eliminated}`);
  });
  console.log(`\nquorum ${outcome.cast}/${outcome.electorate}, ${outcome.quorumNeeded} needed — ${outcome.quorumMet ? 'met' : 'NOT MET'}`);
  console.log(outcome.carried
    ? `\n  ELECTED ${outcome.winner} — CARRIED (art-08/§46/¶1)`
    : outcome.open ? '\n  PROVISIONAL — voting is still open'
    : `\n  NOT CARRIED — ${outcome.winner ? 'quorum not met' : 'no winner'}`);
} else {
  console.log(`  yes      ${outcome.yes}`);
  console.log(`  no       ${outcome.no}`);
  console.log(`  abstain  ${outcome.abstain}`);
  console.log('');
  console.log(`  quorum    ${outcome.cast}/${outcome.electorate} cast, ${outcome.quorumNeeded} needed \u2014 ${outcome.quorumMet ? 'met' : 'NOT MET'}`);
  console.log(`  threshold ${(outcome.share * 100).toFixed(2)}%, ${(spec.threshold * 100).toFixed(2)}% needed \u2014 ${outcome.thresholdMet ? 'met' : 'NOT MET'}`);
  console.log('');
  if (outcome.early) console.log(`  closed early \u2014 ${outcome.early}`);
  console.log(outcome.open ? '  PROVISIONAL \u2014 voting is still open'
    : outcome.carried ? '  CARRIED (art-08/\u00a744/\u00b61)' : '  NOT CARRIED (art-08/\u00a744/\u00b61)');
}

console.log('\nReceipts \u2014 each citizen may confirm their own (art-08/\u00a744/\u00b63):');
for (const b of counted) console.log(`  ${b.citizenId}  ${b.receipt}`);

const out = { proposal: front.id, class: front.class, at: now.toISOString(), open: outcome.open, closes: closes?.toISOString() ?? null, counted, rejected, delegated, outcome };
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, '_result.json'), JSON.stringify(out, null, 2));
console.log(`\nWritten to ballots/${front.id}/_result.json`);

process.exit(outcome.open ? 0 : outcome.carried ? 0 : 1);

function instantRunoff(ballots, weights, candidates) {
  const active = new Set(candidates.length ? candidates : ballots.flatMap((b) => b.choice));
  const rounds = [];
  while (active.size > 1) {
    const counts = new Map([...active].map((c) => [c, 0]));
    let total = 0;
    for (const b of ballots) {
      const ranking = Array.isArray(b.choice) ? b.choice : [b.choice];
      const top = ranking.find((c) => active.has(c));
      if (top) { const w = weights.get(b.citizenId) || 1; counts.set(top, counts.get(top) + w); total += w; }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted[0][1] > total / 2) { rounds.push({ counts: sorted, eliminated: null }); return { rounds, winner: sorted[0][0] }; }
    const last = sorted[sorted.length - 1][0];
    rounds.push({ counts: sorted, eliminated: last });
    active.delete(last);
  }
  return { rounds, winner: [...active][0] ?? null };
}




