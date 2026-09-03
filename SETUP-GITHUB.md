# Hosting the Republic on GitHub

Everything runs on GitHub, on the free tier, for a **public** repository. The
only bill is the domain, and even that is optional. This document is the setup,
then the four things you should know before you commit to it.

---

## 1. What GitHub gives you

| Layer of the Republic | GitHub feature | Cost |
|---|---|---|
| The register (authoritative) | The repository itself | free |
| Rules that execute themselves | Actions — **unlimited minutes on public repos** | free |
| The public site | Pages, built from Actions, custom domain, HTTPS | free |
| Deliberation (art-08/§42) | Discussions | free |
| Proposals (art-08/§41) | Pull requests | free |
| Offices as permissions (art-06/§28/¶3) | Teams and CODEOWNERS | free |
| Merge discipline | Rulesets: required signed commits, required checks, no bypass | free on public repos |
| The Keeper's key | Actions secrets | free |
| Independent archive | Software Heritage ingests public repos automatically | free |

The unlimited-Actions-on-public-repos rule is what makes this work. Your
constitution is public anyway, so the free tier is not a compromise.

---

## 2. Setup

### a. Create an organisation, not a personal repo

`github.com/organizations/new` → Free plan. An organisation matters: the
Republic should not be owned by one person's account, ownership can be
transferred, and Teams can mirror the offices register.

### b. Push the repository

```bash
cd republic
git init && git add -A
git commit -m "Founding (art-11/§64)"
git branch -M main
git remote add origin https://github.com/<org>/republic.git
git push -u origin main
```

Do not commit `private/`. The `.gitignore` already excludes it — check before
the first push, because git history is effectively permanent (see §4).

### c. Turn on Pages

Settings → Pages → **Source: GitHub Actions**. The `publish.yml` workflow does
the rest.

**Set the base path.** A project repo serves from `https://<org>.github.io/republic/`,
and every absolute link breaks without this. In `publish.yml`, the build step
becomes:

```yaml
- run: BASE_PATH=/republic node tools/build.js
```

Two ways to avoid it entirely: name the repo `<org>.github.io`, or attach a
custom domain. With a custom domain, leave `BASE_PATH` unset and add a `CNAME`
file containing your domain to `site/`, copied into `dist/` at build.

### d. Permissions

Settings → Actions → General → Workflow permissions → **Read and write**, and
tick *Allow GitHub Actions to create and approve pull requests*. The
checkpoint, tally, anchor, and deliberation workflows open PRs rather than
pushing to `main`.

### e. Protect the branch

Settings → Rules → New ruleset, targeting `main`:

- Require a pull request, 1 approval
- Require status checks: `verify`, `receive`
- **Require signed commits**
- **Do not** add a bypass list

That last point is the whole game. A ruleset with a bypass for administrators
or for the Actions bot means the merge button *is* the constitution. The
supplied workflows are written to work without a bypass — they propose, they
never push.

### f. Teams as offices

Create a team per office (`registrar`, `keeper`, `treasurer`, `auditor`), add
a `github:` field to each citizen's register file, and run:

```bash
npm run sync:offices <org>
```

It reports where GitHub has drifted from `register/offices.yml`. The register
is authoritative; GitHub is the projection. Anyone holding repository
permissions the register does not grant is exercising authority not conferred —
art-01/§3/¶3.

### g. The Keeper's key

```bash
node tools/keygen.js keeper
```

Settings → Secrets → Actions → new secret `KEEPER_KEY`, paste the PEM. Add the
public key line to `register/keepers.txt`. Store the private key offline too;
a secret you cannot rotate from is a single point of failure.

### h. The second host — required by your own constitution

art-01/§5/¶4 says not fewer than two independent hosts, so GitHub alone puts
you in breach on day one. Create the same repo on Codeberg, then set secrets
`MIRROR_URL` and `MIRROR_TOKEN`. `mirror.yml` pushes on every commit and
nightly, and **fails the build** if `MIRROR_URL` is unset — deliberately.

### i. Discussions

Settings → Features → Discussions. Create a category "Deliberation" and title
each thread with the measure id (`P-0002 — …`) so `deliberation.yml` can find
and archive it into the repository.

---

## 3. How a measure actually moves

1. A citizen forks, copies `proposals/TEMPLATE.md`, opens a PR.
2. `receive.yml` runs `validate.js` — art-08/§41 executing. It checks the class,
   that every citation resolves, that an amendment to an entrenched Article
   carries the right class, and that nothing narrows the right of exit. A red
   check *is* "not received".
3. Deliberation happens in a Discussion titled with the measure id.
4. Merging the PR opens the voting window.
5. Citizens run `node tools/sign.js P-0002 yes c-0006` and open a PR adding one
   file to `ballots/P-0002/`.
6. Run the **Tally** workflow. It verifies every signature against the register,
   follows delegations, applies quorum and threshold, and opens a PR with the
   result and every ballot published.
7. The Keeper adds an issue of the Journal. Publication is promulgation
   (art-05/§25/¶2).

Nobody in this loop can be trusted more than the published tools, because every
ballot is public and anyone can recompute the count.

---

## 4. Four things to know before committing

### Commits leak identity

This is the significant one. Your register is pseudonymous by design —
`c-0006`, a public key, nothing else. But a pull request is authored by a
GitHub account with a name and an avatar, so the mapping from citizen id to
real identity is public in the commit history whether you intend it or not.

Three honest options:

- **Accept it.** GitHub identity becomes public civic identity. Simple, and
  arguably fine: art-07/§37/¶1 says the Republic holds only what a person has
  given it, and joining through GitHub is giving it. Say so in the terms.
- **Route through a bot.** Citizens submit signed ballots to a small Cloudflare
  Worker (free tier) that opens PRs under one bot account. The signature proves
  authorship; GitHub sees only the bot. Costs you a service to run.
- **Separate accounts.** Citizens use a GitHub account created for the Republic.
  Works, and depends on discipline.

Pick one deliberately. Discovering it later is worse.

### Git history is permanent, so erasure must never be needed

Deleting a commit does not remove it. Dangling objects stay reachable by SHA,
forks keep their own copies, and Software Heritage archives public repos. If
personal data ever lands in a commit, art-07/§38 becomes a promise you cannot
keep. This is exactly why `private/` is gitignored and why `tools/test.js`
greps the register for anything resembling personal data on every push. Keep
that test.

### Votes are public

A public repository means open ballots. That is a defensible choice — Swiss
communal assemblies vote by show of hands, and a small republic arguably
benefits from it — but it is a choice, not an oversight. If you want secrecy
you need a different architecture, and at this scale I would not bother. Say
plainly in the interface that voting is open.

### `GITHUB_TOKEN` pushes do not trigger workflows

By design, to prevent loops. So a checkpoint PR merged by the bot will not fire
`verify.yml`. The supplied workflows sidestep this by opening PRs — a human
merge triggers everything normally. If you ever want a chain to fire
automatically, that needs a PAT stored as a secret, which is one more key to
guard.

---

## 5. What it costs

| | |
|---|---|
| GitHub organisation, repo, Actions, Pages, Discussions | $0 |
| Codeberg mirror | $0 |
| OpenTimestamps anchoring | $0 |
| Software Heritage archival | $0 (automatic) |
| Domain | ~$12/year, optional |

There is no tier you grow into. The constraint you will hit first is Pages'
soft limit of ten builds an hour, and the site builds in seconds.
