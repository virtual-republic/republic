# The Republic

This repository is the Republic. Not a description of it, not a backup of it —
the thing itself. Article 1 § 5 ² says so: *the repository is authoritative;
any other rendering, including any application or website, is a client.*

Everything here is plain text. Clone it and you hold a complete copy of the
constitution, the roll of citizens, every act ever taken, and the tools to
prove none of it has been altered. No blockchain, no database, no server, no
money. Total running cost is a domain name.

```
npm install
npm run seed        # found the Republic (once)
npm run test        # check every invariant of Article 2
npm run verify      # prove the register has not been rewritten
npm run build       # generate the public site into dist/
```

## What is where

| Path | What it is | Constitution |
|---|---|---|
| `constitution/` | Both authentic language versions. Neither derives from the other | art-01/§6 |
| `register/citizens/` | The roll. Identifiers and public keys — no personal data | art-03, art-07/§37 |
| `register/entities/` | Entities formed by citizens as of right | art-04/§19 |
| `register/offices.yml` | Who holds what, and the exact permissions attaching | art-06/§28 |
| `ledger/events.jsonl` | Every act, append-only, hash-chained | art-02/§9, §10 |
| `journal/` | The Journal. Publication is promulgation | art-05/§25 |
| `checkpoints/` | Signed Merkle roots anyone can verify | art-02/§10/¶2 |
| `proposals/` | Measures before the Assembly | art-08/§41 |
| `ballots/` | Signed ballots and published results | art-08/§43, §44 |
| `tools/` | The published tools. CC0 — art-05/§26/¶1 | |
| `private/` | Personal data and keys. **Never committed** | art-07/§37/¶2 |

## The four ideas

**Every act cites a provision.** The `provision` field is required on every
record, every proposal, and every issue of the Journal. A citation that does
not resolve means the act is not received (art-02/§11). The site then inverts
the index, so each provision page lists every act ever taken under it. That is
the whole of the "deep integration" — a foreign key, and it gives you something
no ordinary polity has.

**The invariants are executable.** Article 2 is short, absolute, and enforced by
`tools/` rather than by good intentions. `npm run test` asserts each one by
name. An act that would violate an invariant does not fail — it does not occur.

**Verification needs nothing.** `tools/verify.js` uses only Node's standard
library. No account, no permission, no network (art-05/§26/¶3). Any citizen can
run it, and any citizen who does is a monitor. Signatures are SSHSIG, so they
interoperate with `ssh-keygen -Y sign` — but you do not need `ssh-keygen` to
take part.

**Forking is the safety valve.** Article 10 states in advance how a division is
conducted: who may declare one, what the departing Republic takes, what happens
to holdings, names, offices, and judgments. Because the whole state is in a git
repository, exit is not a right the Republic grants — it is a `git clone`.

## Becoming a citizen

```bash
node tools/keygen.js c-0006          # writes private/c-0006.pem, prints your public key
```

Open a pull request adding `register/citizens/c-0006.yml` with your identifier
and public key, supported by two citizens (art-03/§16/¶2). Nothing in that file
is personal — no name, no email. Your name, if you give one, lives in
`private/persons.json`, which is not committed. Erasure under art-07/§38 deletes
that row; your acts remain under your identifier alone, and no record is
altered.

## Proposing and voting

```bash
cp proposals/TEMPLATE.md proposals/P-0002-my-measure.md
node tools/validate.js proposals/P-0002-my-measure.md
```

Validation is Article 8 § 41 executing: it checks that the class is known, that
every citation resolves, that an amendment to an entrenched Article carries the
right class, and that nothing tries to narrow the right of exit. Open a pull
request; `.github/workflows/receive.yml` runs the same check in public.

```bash
node tools/sign.js P-0002 yes c-0006
node tools/tally.js P-0002
```

The tally verifies every signature against the register, follows delegations
(art-08/§43/¶3), applies the quorum and threshold for the measure's class, and
publishes a receipt for each ballot so any citizen can confirm their own. All
ballots are published at the close, so anyone can recompute the result — the
tally is not asserted, it is checkable.

## Trust model, stated plainly

You are trusting the forge host not to lose or censor the repository; mirror to
a second host, and let citizens hold clones. You are trusting the CI runner to
tally honestly; every ballot is published, so a dishonest tally is provable, not
merely suspected. You are trusting whoever holds merge rights not to bypass the
workflow; require signed commits and branch protection with no administrator
override, and publish checkpoints so an out-of-procedure merge is *visible*.

Detection, not prevention, is the guarantee on offer. That is less than a
blockchain promises and roughly what a blockchain delivers, at none of the cost.

## What this is not

Not a state. Not a claim of sovereignty. Confers no legal status, alters no
obligation of any person, and issues nothing resembling an identity document.
The unit of account has no value outside the Republic and cannot be bought,
sold, redeemed, or exchanged (art-09/§48/¶2). If that ever changes, everything
in the legal analysis changes with it.

## Licence

Tools: CC0-1.0, as art-05/§26/¶1 requires. Constitution and Journal: CC0-1.0.
