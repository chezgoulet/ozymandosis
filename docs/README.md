# The documents, and what each is for

Twenty-six documents, plus this index — and several of them cover the same ground. This is
the map: what each one is for, and whether it is **live** (keep it true) or a **record**
(true as of its date — do not edit it to match today).

If two of these ever disagree, the order of authority is: **owner rulings**
(`MONETIZATION.md`, `DECISIONS.md`) → the **live** operational documents → the
**records**.

## Start here

| Document | What it is |
|---|---|
| [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md) | **Live.** The way to the first release, ordered by what blocks what. Work from this one. |
| [fdroiddata/README.md](fdroiddata/README.md) | **Live.** The F-Droid submission: the question to send them, the recipe (linted), and what is left. |
| [LAUNCH.md](LAUNCH.md) | **Live.** What only a person can do — an account, a signature, a decision — grouped by kind. |

`RELEASE-CHECKLIST.md` says which of these is canonical for what; this file is the wider map.

## Running what exists

| Document | What it is |
|---|---|
| [DEPLOY.md](DEPLOY.md) | **Live.** Standing up the Linode: the box, the firewall, DNS, the first owner, and updating. Also the recipe for a staging box, which is spun up on demand and destroyed. |
| [OPERATIONS.md](OPERATIONS.md) | **Live.** Runbooks for the live service: releases, alerts, backups, restores, key rotation, incidents. |
| [HOSTING.md](HOSTING.md) | **Live.** What the box is, what it costs, and when to change it. |
| [PLAY-SERVICE.md](PLAY-SERVICE.md) | **Live.** What `play.ozymandosis.com` does and refuses to do, its protocol, its privacy posture. |
| [ENVIRONMENT.md](ENVIRONMENT.md) | **Live.** The machines, the tools each needs, and where each credential goes. |
| [CREDENTIALS-HOWTO.md](CREDENTIALS-HOWTO.md) | **Live.** How to obtain each credential, in order, and how each one gets proved working. |
| [DATA-INVENTORY.md](DATA-INVENTORY.md) | **Generated.** What personal data is held and where it goes. Generated from `apps/play/src/lib/inventory.ts` by `npm run inventory -w apps/play`; a test fails when it drifts. Do not edit by hand. |

## Releasing

| Document | What it is |
|---|---|
| [RELEASE-FLOW.md](RELEASE-FLOW.md) | **Live.** Branches, tags, nightlies and Play's tracks — and the two tests that keep a server deploy safe for a client already in players' hands. |
| [RELEASE-ANDROID.md](RELEASE-ANDROID.md) | **Live.** Signing, the AAB, and the Play track upload. |
| [STORES.md](STORES.md) | **Live.** iOS and Steam: how those builds sell and prove what `MONETIZATION.md` says. |
| [PLAY-DECLARATIONS.md](PLAY-DECLARATIONS.md) | **Live.** The Play Console declarations — the answers, and the one that is not true yet. |

## Design and decisions

| Document | What it is |
|---|---|
| [DECISIONS.md](DECISIONS.md) | **Live, append-only.** The decision log, D1 onward. The reason a rule exists is usually here. |
| [MONETIZATION.md](MONETIZATION.md) | **Live, binding.** The scheme of record as an owner ruling. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | **Live.** The shape of the code: the four layers, and where things live. |
| [PERFORMANCE.md](PERFORMANCE.md) | **Live.** The 60 fps contract and how it is measured. |
| [ADVISORIES.md](ADVISORIES.md) | **Live.** Advisories `npm audit` reports and we have decided to accept, with the reason. |
| [ROADMAP.md](ROADMAP.md) | **Live, and explicitly a wishlist** — ideas under consideration, not commitments. |

## Records — true as of their date

| Document | What it is |
|---|---|
| [DELIVERY.md](DELIVERY.md) | **Record (2026-09-28, plus later follow-ups).** Requirements → implementation, with the evidence commands. Read the follow-up sections as later than the first half. |
| [WORK-ORDER-FIRST-RELEASE.md](WORK-ORDER-FIRST-RELEASE.md) | **Record.** The work order the first release was built to. It owns no rule; its open items were resolved, and current status lives in the checklist. |
| [RELEASE-PLAN.md](RELEASE-PLAN.md) | **Superseded by `RELEASE-CHECKLIST.md`.** The original road to the stores, kept as the record of how the first release was scoped and sequenced. |
| [open-sourcing/README.md](open-sourcing/README.md) | **Live decision record.** Taking the game open source: licence, distribution, and the course of action. |
| [open-sourcing/reproducible-builds-and-signatures.md](open-sourcing/reproducible-builds-and-signatures.md) | **Record, with a revision at the end.** The two-rails question, verified from both sides' documentation. Its last section supersedes its middle. |
| [open-sourcing/compliance-audit.md](open-sourcing/compliance-audit.md) | **Record.** The F-Droid and reproducible-build audit at a named commit. Findings dated 2026-10-06; some are already fixed (the tags exist, and the licence landed after it was written). |
| [open-sourcing/open-source-plan.md](open-sourcing/open-source-plan.md) | **Record.** The thinking-out-loud that led to the decision record above. Where it poses an open question the decision record has since answered, the decision wins. |
