# THE REPUBLIC PROTOCOL

### An open protocol and template for interoperable, git-based, blockchain-free decentralized autonomous organizations

*Version 0.1 · This document describes both what is implemented and what is specified. Sections marked **[spec]** define behaviour for interoperability that is not yet built; everything else is running code.*

---

# PART I — THE PROTOCOL

## 1. What this is

A DAO is usually assumed to require a blockchain. It does not. "DAO" names a set of properties — rules that execute themselves, governance by members rather than owners, records anyone can verify, participation open within the rules — and only one of those properties needs consensus machinery: the guarantee that no operator *could* defect, even if they wanted to.

The Republic Protocol trades that one property for something cheaper and, for most organizations, more useful: **decentralization by forkability**. If the complete state of an organization is public, cryptographically verifiable, and reconstructible by anyone from published data, then an operator who defects loses the organization rather than capturing it. The discipline is exit, not consensus.

This is how the most capture-resistant institutions in software already work. Debian, the Linux kernel, Wikipedia, the IETF, and the Rust RFC process are all rule-governed, transparent, and resistant to takeover, and none of them run on a chain.

The substrate is **git**, which is already:

- an append-only hash-linked structure — every commit contains the hash of its parent;
- a Merkle DAG, the same data structure a blockchain uses to make history tamper-evident;
- cryptographically authored, through signed commits;
- fully replicated, since every clone holds the complete history;
- forkable as a first-class operation.

What git lacks, relative to a blockchain, is consensus over which history is canonical. An organization with an acknowledged constitution does not need to solve Byzantine agreement among strangers. It needs an auditable record and a credible exit.

**Git is the ledger. The forge is the node. The CI workflow is the contract. Merge rights are the multisig. A fork is secession.**

Total running cost: a domain name, or nothing.

## 2. Principles

### 2.1 Interoperability

Organizations built on this protocol are not islands. Because every one of them stores its state as plain text in a git repository, with identical formats and identical verification tools, they can perform operations no conventional organization can:

**Recognition.** One organization records another as existing and legitimate. Concretely: an entry in `recognitions.yml` naming the other's repository URL, the public keys of its offices, and the Merkle root of a checkpoint at the moment of recognition. Because checkpoints are verifiable by anyone, recognition is not a matter of trust — it is a claim that can be checked. **[spec]**

**Federation.** A federation is itself a republic whose members are organizations rather than natural persons. Member organizations delegate enumerated competences upward; the federation's register lists member repositories instead of citizen keys; a federal measure is carried by weighted votes cast by each member's designated office. Nothing new is required — an entity under Article 4 can hold a key, and a key can sign a ballot. **[spec]**

**Merging.** Two organizations combine by union. Citizen identifiers are namespaced on collision (`a:c-0001`, `b:c-0001`), the registers concatenate, and a merge record is appended to both ledgers citing both prior heads — exactly as a git merge commit references two parents. **No history is rewritten**, which matters: Article 2 § 9 forbids alteration, and a merge that rewrote either party's past would be a merger only in name. **[spec]**

**Splitting.** Already implemented, as Article 10. Any citizen may declare a division; the departing organization takes a complete copy of the register as it stood; both successors descend from a shared checkpoint; neither is the continuation of the other. Writing this down in advance is what makes a schism an act of the constitution rather than a failure of it.

**Portable identity.** A citizen's credential is an Ed25519 keypair, not an account. The same key may appear on any number of registers, because Article 2 § 13 permits plural citizenship. There is no identity provider, no registry, and nothing to be locked into.

### 2.2 Transparency, verifiability, and no unilateral action

Three mechanisms, layered.

**Every act cites a provision.** The `provision` field is mandatory on every record, every measure, and every issue of the Journal. A citation that does not resolve means the act is not received. Inverting this index gives every provision a page listing every act ever taken under it — something no conventional polity has, at the cost of a foreign key.

**Every record is chained.** Each carries the hash of the one preceding it, so altering any past record changes every hash after it. Periodic signed checkpoints publish the Merkle root over the whole register, so a checkpoint from last week makes last week's history unforgeable today.

**Verification requires nothing.** The verifier uses only the standard library of a common runtime. No account, no permission, no network. Any member who runs it is a monitor; an organization where three members independently verify the log is meaningfully more trustworthy than one running on a chain nobody reads.

**No unilateral action** is enforced structurally rather than promised. Governed paths — the constitution, the tools, the parameters, the offices — cannot be changed without a measure of the appropriate class having been cited and carried. The gate that checks this is itself a governed path, so it cannot be quietly disabled. Branch protection with an empty bypass list is what makes it bind; without that, the merge button is the constitution.

The guarantee on offer is **detection, not prevention**. That is less than a blockchain promises and roughly what a blockchain delivers.

### 2.3 Open source, and the UI as one client among many

The repository is authoritative. The website is a client.

This is stated in the constitution itself (Article 1 § 5 ²) rather than left as an implementation note, because it determines what happens when the website dies, or is captured, or simply becomes unfashionable: nothing. The organization persists in the repository, and anyone can build another interface.

To make that real rather than aspirational, every build emits a machine-readable projection of the whole state:

| File | Contents |
|---|---|
| `data/resolve.json` | every citable identifier → URL, label, corpus |
| `data/citizens.json` | the roll: identifiers, status, public keys |
| `data/offices.json` | offices, holders, permissions |
| `data/proposals.json` | measures, classes, closing times |
| `data/ballots/<id>.json` | every signed ballot for a measure |
| `data/events.jsonl` | the complete register |
| `data/meta.json` | repository, branch, parameters, classes |

A competing client — a mobile app, a terminal tool, a Discord bot, a spreadsheet — needs no cooperation from the incumbent. It reads the same files and, if it implements the specification in Part III, produces byte-identical signatures and identical tallies.

The verification tools are published under CC0 because the constitution requires it (Article 5 § 26 ¹). An organization that could withhold the means of checking it would not be transparent; it would be trusted.

## 3. What this is for

**An online community.** Membership by key, decisions by measure, moderation policy as statute, a public record of every action taken and the rule it was taken under. Answers the perennial complaint that community governance is whatever the admin says it is.

**A company or cooperative.** Members hold shares as entity instruments; the board is an office with enumerated permissions; the treasury moves only under carried appropriations. Particularly apt for worker cooperatives, where one-member-one-vote and transparent governance are the point rather than a compliance burden.

**A standards body or open-source project.** Substantially what the IETF and Rust already do, with the procedure made mechanical: proposals cite the provisions they act under, votes are signed and counted by a published tool, and the record survives a change of hosting.

**A club, society, or student organization.** The full apparatus — elections, offices, minutes, a treasury — at a cost of zero and a maintenance burden of a git repository.

**A government, or a model of one.** As a simulation, a teaching instrument, or a micronation, this runs a complete constitutional order end to end. As a design study, it is a working answer to how a polity might operate if its records were verifiable by its citizens rather than asserted to them.

**A federation of any of the above.** The interoperability primitives in § 2.1 are what distinguish this from a governance app: organizations that share a protocol can recognize, federate, merge, and split without a coordinating authority.

## 4. What this deliberately is not

It is not trustless. The forge host can censor or lose the repository, the CI runner is trusted to count honestly, and whoever holds merge rights could bypass the workflow. Each is mitigated — mirror to a second host, publish every ballot so a dishonest tally is provable, keep the ruleset's bypass list empty and publish checkpoints so an out-of-procedure merge is visible — but mitigated is not eliminated.

It is not anonymous. Pull requests are authored by named forge accounts, so the mapping from pseudonymous identifier to person is public unless submissions are routed through a bot.

It holds no money. The unit of account exists only inside the organization, cannot be bought, sold, or redeemed, and is not an investment. Convertibility is precisely what converts a civic project into a regulated one.

---

# PART II — USER MANUAL

Everything below assumes an organization deployed from this template. Paths are relative to the repository root.

## 5. Joining

Citizenship is a keypair on the register. No account, no email, no password.

### From the website

Open `/assembly/` or `/office/` and use the citizenship panel.

1. **Create.** A key is generated in your browser by Web Crypto and never transmitted. The `.pem` downloads and is also shown on screen. **Save it — it is your citizenship.** The public half, shown beneath it, is the harmless part that goes on the register.
2. **Prepare the application.** The panel builds your register entry.
3. **Open on GitHub.** You land in the forge's own commit screen with the file filled in. Commit it.

### From the terminal

```bash
node tools/keygen.js c-0002          # or use an existing ~/.ssh/id_ed25519
node tools/join.js path/to/key.pem   # reads the public half, writes the register entry
```

`join.js` picks the next free identifier, writes `register/citizens/c-0002.yml`, appends the admission record, and copies the key into `private/` where the other tools look for it.

### What lands on the register

```yaml
id: c-0002
status: active
admitted: 2026-09-03
admitted_under: art-03/§16/¶3
keys:
  - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... c-0002
```

No name, no email, nothing personal. That is required by Article 7 § 37 ², and the test suite fails the build if anything identifying appears.

### Admission takes effect on recording

No sponsor, no seconding, no waiting period. The Registrar may object within seven days on grounds fixed by statute, and the Assembly then decides. **One person may hold several citizenships** (Article 2 § 13 ²) — each is a distinct civic person with its own key and its own vote. The protocol makes no claim that its citizenships correspond one-to-one with human beings, and says so in the text.

### Multiple keys

Register a second key against the same citizenship, kept somewhere else. If you lose the first, the second recovers you (Article 3 § 17 ³). Without one, recovery falls to the Registrar.

## 6. Proposing

### Laying a measure

From `/assembly/`, fill in the form: identifier, title (English and optionally French), class, the provisions it cites, and the text. Press **check citations** — every citation is resolved against the live index before you commit. A measure citing something that does not resolve **is not received** (Article 8 § 41 ³), and the form refuses it in the browser exactly as the workflow refuses it afterwards.

From the terminal:

```bash
cp proposals/TEMPLATE.md proposals/P-0002-my-measure.md
node tools/validate.js proposals/P-0002-my-measure.md
```

### Choosing the class

The class determines quorum, threshold, voting window, and whether two readings are required. It must match what the measure actually changes, and the gate enforces the match.

| Class | Quorum | Threshold | Window | For |
|---|---|---|---|---|
| `parameter` | 20% | 50% | 7 d | a value in `parameters.yml` |
| `policy` | 20% | 50% | 7 d | prose statute that no tool executes |
| `ordinary` | 20% | 50% | 7 d | offices, permissions, ordinary business |
| `organic` | 33% | 66.67% | 14 d | the tools, the workflows |
| `amendment` | 50% | 66.67% | 21 d | the Constitution — **two readings, 30 days apart** |
| `entrenched` | 60% | 75% | 30 d | Articles 2, 7, 11 — **two readings** |
| `election` | 33% | instant-runoff | 7 d | filling an office |

All of these live in `parameters.yml` and are themselves changeable by a `parameter` measure.

### Three kinds of change

The distinction matters more than it looks:

- **Parameter** — one value moves. A quorum, a threshold, an issuance cap. A genuine change in what the organization does, with no code change and a one-line diff.
- **Code** — the tools or workflows change. Organic tier, because the tools *are* the procedure: anyone able to edit the tally could redefine what "carried" means.
- **Policy** — prose in `statutes/` that nothing executes. Ordinary tier.

### Deliberation

Measures are discussed in forge Discussions titled with the identifier. The record is archived into `proposals/<id>/deliberation.md` on a schedule, so it survives the platform (Article 8 § 42 ²).

## 7. Voting

### Casting a ballot

Open the measure's page at `/assembly/P-0002/`. Load your key, choose yes, no, or abstain, press **sign ballot**, then **open on GitHub** and commit. The ballot is signed in your browser; nothing passes through a server.

Or:

```bash
node tools/sign.js P-0002 yes c-0002
```

A ballot looks like this:

```json
{
  "proposal": "P-0002",
  "choice": "yes",
  "at": "2026-09-03T14:22:11.004Z",
  "salt": "9f3c…",
  "signature": "-----BEGIN SSH SIGNATURE-----…"
}
```

The signature covers `{proposal, choice, at, salt}` in canonical form, so none of those can be edited without invalidating it.

### One ballot per citizenship, and changing your mind

The path is `ballots/<measure>/<citizen>.json`. One file, one citizenship — the filesystem enforces it. **Voting again replaces your earlier ballot**, which is how a vote is updated. Because the timestamp sits inside the signed payload, a replacement is provably later, and an old ballot cannot be replayed to undo a change of mind.

### Your receipt

Signing returns a receipt: the first 16 hex characters of the hash of your signed message. Every published tally lists receipts, so you can confirm your own ballot was counted without anyone having to be trusted.

### Delegation

Add `delegate_to: c-0003` to your register entry, or `delegations: {organic: c-0004}` to delegate only on one class. A delegate's weight is used only if you have not voted yourself; direct votes always override. Chains are followed and cycles are broken and reported. Delegated weight is recorded openly (Article 8 § 43 ⁴).

### Live counts

Each measure's page counts the published ballots **in your browser**, using the same arithmetic as the server-side tool: signatures checked, supersessions applied, quorum and threshold shown against their targets, time remaining. A count taken while voting is open is marked provisional.

### Votes are public

The repository is public, so ballots are visible. This is a choice, defensible for a small organization — Swiss communal assemblies vote by show of hands — but it is a choice, not an oversight.

## 8. Elections and holding office

### Standing

Every citizen may stand (Article 7 § 34 ¹). An election is a measure of class `election` listing the candidates:

```yaml
id: P-0007
title: Election — Registrar
class: election
candidates: [c-0001, c-0004, c-0009]
cites: [art-06/§29/¶1, art-08/§46/¶1]
opened: 2026-09-01
closes: 2026-09-08
```

### Ranked ballots

Voters rank rather than pick:

```bash
node tools/sign.js P-0007 c-0004,c-0001,c-0009 c-0002
```

The tally runs instant-runoff (Article 8 § 46 ¹) and publishes the round-by-round elimination table, so the count is reconstructible from the published ballots.

### Terms and recall

Offices are held for one year. A citizen may hold more than one — necessary in a small organization and permanent since Article 6 § 29 ² was amended. An office-holder is recalled by the same procedure that elected them. On vacancy the Assembly appoints until an election is held.

## 9. Closing a vote

A measure closes at `closes` in its front matter, or at `opened` plus the window for its class.

- Before that moment, `tally.js` marks any count **PROVISIONAL** and exits without enacting anything.
- Ballots timestamped after the close are **refused by name** in the output, with the timestamp shown.
- After the close, the count is final.

To close and count:

```bash
node tools/tally.js P-0002        # counts; exits non-zero if not carried
node tools/enact.js P-0002        # publishes the Journal issue, if carried
```

Or run the **Tally** workflow from the forge, which does both and opens a pull request with the result.

### Enactment publishes itself

When a measure carries, `enact.js` writes the next issue of the Journal citing Article 8 § 45 ¹, records the vote figures, reproduces the text as enacted, and appends a `measure.enacted` record to the register. Publication is promulgation: an act not published has no effect (Article 5 § 25 ²). Automating it means promulgation is never simply forgotten.

## 10. Offices and what each may do

Every office holds an enumerated permission set and nothing else. The set is published in `register/offices.yml` and re-approved annually, lapsing if it is not (Article 6 § 32 ³). Open `/office/` with your key loaded to see what yours permits.

### Registrar

`register.admit` · `register.object` · `entity.register`

Keeps the roll. Objects to an admission within seven days on statutory grounds, referring it to the Assembly. Registers entities. **May not** refuse admission on any ground listed in Article 3 § 16 ⁵, and every refusal must be reasoned and is appealable.

### Keeper of the Journal

`journal.publish` · `checkpoint.sign`

Publishes issues of the Journal, which is what gives an act effect. Signs the weekly checkpoint attesting the state of the register. Holds the only key whose signature the verifier checks against `register/keepers.txt` — the most consequential key in the organization, and the one that should be kept offline.

### Treasurer

`value.issue` · `treasury.disburse`

Issues the unit, only under a resolution of the Assembly and only in the amount that resolution states (Article 9 § 49 ¹). Disburses from the Treasury only under a carried appropriation citing Article 9 § 53 ³. Every issue and every disbursement is a published record.

### Auditor

`audit.report`

Reports to the Assembly at least twice a year, published. In practice: runs `npm run verify` and `npm test` independently, confirms the tallies reproduce from the published ballots, and checks that no office holds permissions the register does not grant — `npm run sync:offices` reports exactly that drift.

### Judges

The Court decides disputes, reviews acts for consistency with the Constitution, and construes the two authentic language versions where they differ. It may **halt** an act within its enactment window and declare an act of no effect. It holds **no permission over the Treasury** and cannot move value — least authority, written into the office rather than assumed.

Where no Judge is elected, the Assembly exercises the Court's functions.

## 11. Forming an entity

Every citizen may form an entity, as of right, with no permission required (Article 4 § 19 ¹). Types are association, commune, company, foundation, and organ of the Republic; statute may add more. An entity has a published charter, organs held by citizens, and may hold accounts, issue instruments, hold property, and appear before the Court. It may not be a citizen, vote, or hold an office of the Republic.

## 12. Verifying

```bash
git clone <repository> && cd <repo>
npm install
npm run verify
```

This checks that every record links correctly to its predecessor, that no hash disagrees with its content, that every published checkpoint's Merkle root matches the register, that the Keeper's signatures are valid, and that inclusion proofs work. It needs no account, no permission, and no network. Anyone who runs it regularly is a monitor.

The ledger page performs the same check in your browser as the page loads.

## 13. Leaving, and dividing

**Leaving.** A signed record, at any time, taking a complete copy of the register with you (Article 7 § 39). No provision may impede a departure or condition it on anything, and that guarantee cannot be amended (Article 11 § 61 ³).

**Dividing.** Any citizen may declare a division (Article 10 § 54 ¹). The declaring citizens take the register as it stands at the moment of declaration; both organizations succeed to that history; neither is the continuation of the other; holdings are mirrored; offices are filled afresh in the departing organization; judgments given before the division bind both. Two organizations descended from a common division may reunite by a measure carried in each.

Because the whole state is a git repository, exit is not a right granted — it is a `git clone`.

---

# PART III — TECHNICAL SPECIFICATION

## 14. Repository layout

```
constitution/{en,fr}/NN-name.md   both authentic versions
statutes/                         organic and ordinary statutes
parameters.yml                    every tunable value
register/citizens/*.yml           the roll — identifiers and public keys only
register/entities/*.yml           entities and charters
register/offices.yml              offices, holders, permission sets
register/keepers.txt              public keys whose checkpoint signatures count
ledger/events.jsonl               the register: append-only, hash-chained
journal/YYYY/NNNN-*.md            the Journal — publication is promulgation
checkpoints/NNNNNN.json           signed Merkle roots
proposals/P-NNNN-*.md             measures
ballots/P-NNNN/<citizen>.json     signed ballots
judgments/                        Court decisions
tools/                            the published tools (CC0)
site/                             stylesheet and browser module
private/                          keys and personal data — never committed
```

## 15. The register

### Record format

```json
{
  "seq": 12,
  "at": "2026-09-03T12:00:00.000Z",
  "author": "c-0001",
  "entity": null,
  "kind": "value.issued",
  "provision": "art-09/§49/¶1",
  "payload": { "amount": 50000, "unit": "obol", "to": "treasury" },
  "prev": "8f3c…",
  "hash": "a91b…"
}
```

`hash = SHA256(prev || canonical(body))`, where `body` is every field except `hash`.

### Canonical serialization

Two implementations must agree byte for byte or the chain will not verify across clients. The rule: `undefined` fields are dropped, object keys are sorted lexicographically, arrays keep their order, and scalars serialize as `JSON.stringify` produces them. No whitespace.

```js
function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
```

### Enforced invariants

Article 2 is short, absolute, and mechanically checked. `tools/test.js` asserts each by the provision that states it:

| Provision | Invariant | Enforcement |
|---|---|---|
| art-02/§8/¶1 | exactly one author per record | rejected at append |
| art-02/§9/¶1 | records are never altered | hash chain |
| art-02/§10/¶1 | each record carries the previous hash | verifier |
| art-02/§11/¶1 | every act cites a resolvable provision | append + gate |
| art-02/§12/¶2 | transfers neither create nor destroy value | test replays the ledger |
| art-02/§13/¶3 | each citizenship holds a unique key | test scans the roll |
| art-07/§37/¶2 | no personal data in the register | test greps every entry |

An act violating an invariant does not fail; it does not occur.

## 16. Checkpoints

```json
{
  "number": 7,
  "at": "2026-09-06T00:00:00.000Z",
  "records": 143,
  "root": "4314bc0f…",
  "head": "644f410a…",
  "previous": "1c9de77b…",
  "signature": "-----BEGIN SSH SIGNATURE-----…"
}
```

The Merkle tree uses domain separation to prevent second-preimage attacks: leaves are `SHA256(0x00 || hash)`, interior nodes `SHA256(0x01 || left || right)`, and an odd node is duplicated. The signature covers the canonical form of the checkpoint minus the signature field, in namespace `republic-checkpoint`.

Consistency is chained: each checkpoint's `previous` must equal the prior checkpoint's `root`, so the sequence cannot be forked without detection.

Optional external anchoring: OpenTimestamps produces a Bitcoin-anchored receipt for a checkpoint at no cost and with no wallet, giving third-party evidence that a given state existed at a given time.

## 17. Identity and signatures

Ed25519 throughout. Credentials are SSH public keys; signatures are **SSHSIG**, the format `ssh-keygen -Y sign` produces, so the protocol interoperates with standard tooling in both directions.

The signed blob:

```
"SSHSIG" || string(namespace) || string("") || string(hash_alg) || string(H(message))
```

Namespaces separate contexts and are checked: `republic` for ballots and records, `republic-checkpoint` for checkpoints. A signature made in one namespace will not verify in another.

Three implementations exist and agree:

- `tools/lib/sshsig.js` — pure Node, standard library only. No `ssh-keygen` required.
- `site/republic.js` — pure browser, Web Crypto. Ed25519 is available in Chrome 137+, Firefox 129+, Safari 17+.
- `ssh-keygen -Y sign` / `-Y verify` — the reference implementation.

**Verified interoperability:** a ballot signed in the browser verifies unchanged in the Node tally; a chain built by Node verifies in the browser.

## 18. Citation system

Every addressable text has an identifier:

```
<corpus>.<document>[/§n][/¶n]

const.art-05/§48/¶1      a provision of the Constitution
stat.unit-of-account/§3  a section of a statute
jour.2026/1              an issue of the Journal
jdgt.2026/2              a judgment
prop.P-0002/§1           a measure's own text
```

Bare constitutional citations (`art-05/§48/¶1`) normalise to `const.*` and remain valid everywhere — the register is full of them and Article 2 § 9 forbids rewriting it.

One index (`tools/lib/corpus.js`) serves the builder, the tools, and the browser, and is published as `data/resolve.json`. Three consequences:

1. **Validation.** A measure citing an unresolvable identifier is not received — checked in the browser before commit and again in CI.
2. **Auto-linking.** Any prose anywhere gains links automatically, including the natural-language form ("Article 7 § 38 ²") in both languages.
3. **Backlinks.** Inverting the index gives every provision a list of every act taken under it.

Registering a new corpus means adding one entry to `CORPORA` and a loader; the resolver, linker, and backlink machinery follow.

## 19. Parameters

`parameters.yml` holds every tunable value. No tool may hardcode a value that appears there — that is the file's entire purpose. It covers voting classes and their quorums, thresholds, windows and successive-reading requirements; ballot rules; admission rules; the unit of account and issuance caps; and whether enactment publishes automatically.

The result is that changing what the organization does is frequently a one-line diff to a data file rather than a code change, and the gate governs it at `parameter` tier.

## 20. Tally algorithm

1. Read every `ballots/<measure>/*.json` except `_result.json`.
2. Reject: unknown citizenship, wrong measure, timestamp outside the window, signature failing against that citizenship's registered keys.
3. Deduplicate by citizenship, keeping the latest timestamp.
4. Apply delegation: a delegator's weight passes to their delegate only if the delegator has not voted; chains are followed, cycles broken.
5. Compute quorum against the count of active citizenships and threshold against decisive votes (yes + no; abstentions count toward quorum, not toward the threshold).
6. Carried iff quorum met, threshold met, and voting closed.
7. Publish every accepted ballot with its receipt, so the count is reproducible.

Elections use instant-runoff with the round-by-round table published.

**Reproducibility is the property that matters.** The tally is not asserted by an authority; it is recomputable by anyone from the published ballots, in the browser or on the command line.

## 21. The gate

`tools/gate.js` maps changed paths to a required class of measure:

| Path | Class |
|---|---|
| `constitution/{02,07,11}-*` | entrenched |
| `constitution/**` | amendment |
| `tools/**`, `.github/workflows/**` | organic |
| `parameters.yml` | parameter |
| `statutes/**` | policy |
| `register/offices.yml`, `keepers.txt` | ordinary |
| ballots, proposals, ledger, journal, checkpoints, citizens, entities | exempt |
| `site/`, docs | exempt |

Exemptions are load-bearing: requiring a vote to record a vote would deadlock the organization on its first measure.

The gate then locates the measure in the pull request title, body, or branch name; confirms the measure's declared class matches what the change requires; re-runs the tally; and fails unless it carried. For successive classes it enforces two readings the required number of days apart. It also refuses outright any amendment narrowing the right of exit or the right of division.

Registered as a required status check with an empty bypass list, this is what makes "no unilateral action" structural rather than aspirational.

## 22. Build pipeline

`tools/build.js` produces a static site. One page tree, not one per language: both authentic versions are embedded in every page and a toggle selects English, French, or both. This follows from Article 1 § 6 ² — neither version derives from the other, so neither gets its own site — and halves the page count.

Layout uses a gutter grid: the paragraph mark occupies its own column and each paragraph is separated by a hairline, which is what makes full-width legal text readable. The grid has exactly two children per paragraph, the mark and one text span; a stray third child (an inline citation link, for instance) would be flung into the next cell.

Deployment is any static host. `BASE_PATH` handles project-subpath hosting; a custom domain needs nothing.

## 23. Privacy

The hardest constraint in the design: the right to erasure conflicts head-on with an immutable log.

The resolution is architectural and must be built in from the first commit, because it cannot be retrofitted. **`person` and `citizen` are separate.** All personal data lives in `private/persons.json`, which is gitignored, mutable, and deletable. Every record references only a pseudonymous identifier that contains nothing personal. Erasure deletes the person row and breaks the link: the citizen still holds the offices they held and cast the votes they cast, but nobody can say who that was. No record is altered, so Article 2 § 9 is not breached — and Article 7 § 38 ² says so explicitly.

Supporting measures: encrypt personal data at rest with a per-person key so deleting the key destroys it even in backups, and never let free-text fields into record payloads without review, since a proposal body containing someone's name is personal data inside an immutable log.

Git history is effectively permanent — dangling objects remain reachable by hash, forks keep copies, and archival services ingest public repositories. If personal data ever lands in a commit, erasure becomes a promise that cannot be kept. The test suite greps the register for it on every push.

## 24. Threat model

| Threat | Mitigation | Residual |
|---|---|---|
| Operator rewrites history | hash chain, published checkpoints, distributed clones | detection, not prevention |
| Forge censors or loses the repository | mirror to a second host; every member holds a clone | mirror must be maintained |
| CI tallies dishonestly | every ballot published; anyone recomputes | a wrong count is provable, not impossible |
| Merge rights bypass procedure | empty bypass list, required signed commits, checkpoints | an out-of-procedure merge is visible |
| Forged ballot | SSHSIG against registered keys | key theft is indistinguishable from use |
| Replay of a superseded ballot | timestamp inside the signed payload | — |
| Sybil citizenships | none — plural citizenship is permitted by design | the protocol claims no person-to-citizenship correspondence |
| Key loss | second registered key; social or Registrar recovery | recovery is also an attack surface |
| Identity leakage via commit authorship | route submissions through a bot | not implemented here |

## 25. Interoperability specification **[spec]**

Any implementation claiming conformance must:

1. Serialize records with the canonical form in § 15 and chain them with SHA-256 as specified.
2. Produce and verify SSHSIG Ed25519 signatures in namespaces `republic` and `republic-checkpoint`.
3. Build Merkle trees with the domain separation in § 16 and chain checkpoints by `previous`.
4. Accept the citation grammar in § 18, including bare constitutional citations.
5. Read thresholds from `parameters.yml` and never from source.
6. Implement the tally in § 20, including supersession by timestamp and delegation.
7. Publish the projection files listed in § 2.3.

Two conforming organizations can then:

- **Recognize** — record the other's repository, office keys, and a verified checkpoint root.
- **Federate** — constitute a federation whose register lists member repositories, with member offices casting weighted ballots.
- **Merge** — namespace colliding identifiers, union the registers, and append a merge record to both ledgers citing both prior heads, rewriting nothing.
- **Split** — as Article 10, with the divergence point being a checkpoint both successors share.

The protocol has no registry, no discovery service, and no coordinating authority, because it needs none. Two organizations interoperate by reading each other's repositories and running the same verifier.

## 26. Cost

| | |
|---|---|
| Repository, CI, static hosting, discussions | $0 on public repositories |
| Second host for the mirror | $0 |
| External timestamping | $0 |
| Domain | ~$12/year, optional |

There is no tier to grow into. An organization of five and an organization of five thousand cost the same to run.

---

*Tools are published under CC0-1.0, as the constitution requires. This document and the constitutional text are likewise CC0.*
