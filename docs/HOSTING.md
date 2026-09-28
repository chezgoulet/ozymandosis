# Hosting and scale — what the box is, what it costs, and when to change it

## The box

**Linode, Toronto (`ca-central`), Ubuntu 26.04 LTS** — `linode/ubuntu26.04`, an
image since 9 June 2026. The 26.04.1 point release landed 26 August 2026, so
this is past the point release that a new LTS wants before production use.

**Plan: `g6-nanode-1` — 1 GB RAM, 1 shared vCPU, 25 GB SSD, 1 TB transfer,
$5/month.** The smallest thing Linode sells, and deliberately not sized for
load. Rebuilding is a reset of the same plan, so rebuilds cost nothing.

## What runs on it

Caddy for TLS termination; the play service (accounts, OAuth, TOTP, argon2id,
lobbies, matchmaking, WebRTC signalling, store validation, moderation, cloud
saves, crash intake); PostgreSQL; coturn; and the backup job.

## The measured load profile

Per `D19`, every cross-network match now relays through coturn, so coturn is on
the critical path rather than being a fallback.

- A six-player snapshot is about **2.6 KB per guest at 8 Hz** → **~104 KB/s per
  match** → **~125 MB of egress across a twenty-minute match**.
- **100 concurrent matches ≈ 81 Mbit/s**, comfortably inside a 1 Gbps port.
- The 1 TB allowance covers roughly **6,800 such matches a month**. Overage is
  **$0.005/GB**, about **$0.0006 per match**.
- **Inbound does not count against the quota**, which matters here because
  TURN's ingress from the host is free — you pay only for what the server sends.

**Bandwidth is not the constraint at any plausible early scale.**

## What actually binds, and why it does not bind yet

RAM is the real limit (PostgreSQL wants room), and CPU second (argon2id is
*designed* to be expensive — that is its security property). Both are
**load-dependent**. At rest the box looks like this:

| | |
|---|---|
| PostgreSQL | ~200 MB |
| Node (play service) | 100–150 MB |
| coturn, Caddy | tens of MB each |
| OS | ~200 MB |
| **total** | **~600 MB of the gigabyte** |

Tight, but nowhere near the wall — and with no players there is nothing
contending for the single core. So the small plan is right *now*, and the only
question is when it stops being right.

## The rule: size the server by subscribers, not by hopes

At **$1.70 net per subscriber-month** (the $2 subscription after a 15% store
cut):

| Plan | Cost | Covered by |
|---|---|---|
| Nanode 1 GB | $5/mo | **3 subscribers** |
| Shared 2 GB / 1 vCPU | $12/mo | **8 subscribers** |
| Shared 4 GB / 2 vCPU | $24/mo | **14 subscribers** |
| Shared 8 GB / 4 vCPU | $48/mo | **28 subscribers** |

**Upgrade when subscriber revenue covers the next plan.** That makes "spending
too much too early" impossible by construction, and it gives a trigger that is
neither a date nor a guess. Disk can only grow on a resize, so disk size is the
one long-term commitment.

## The one thing to add now, and it is free

**A 2–4 GB swap file, plus memory caps on the services.** On a 25 GB disk this
costs nothing and converts the real failure mode — the kernel choosing between
PostgreSQL and everything else — into slowness instead of a kill.

This is not hypothetical for this House: a host has already been lost to a unit
with `MemoryMax=infinity` that OOM-looped until session creation timed out and
nobody could log in. A capped service degrades; an uncapped one takes the box.

## The signals that say move up

No dates, no vibes — any one of these and $12 buys breathing room:

- swap usage climbing and staying climbed;
- PostgreSQL killed by the kernel, or the play service restarting itself;
- load average sitting above 1 on one vCPU;
- logins feeling slow under light concurrency, which is argon2id queueing.

## Backups: the one cost genuinely tied to data

Off-box backups go to **Linode Object Storage**, a separate paid product that
would roughly **double** the monthly spend. **Verify the current entry price
before ordering rather than trusting a figure written here.**

At zero accounts it can wait; a manual dump before any risky change is enough.
The moment the first real account exists it stops being optional — that is the
point where the data becomes the business rather than a copy of it.

## Deployment automation — already written, not yet live

`.github/workflows/deploy.yml` exists and does the right thing:

- **Two triggers**: automatically after a **successful `ci` run on `main`**, or
  manually via `workflow_dispatch` choosing `staging` or `production`.
- **`deploy/deploy.sh`** takes a pre-deploy backup first and **aborts if that
  backup fails**; rolls out with a **90-second health window**; and **rolls back
  automatically** to the previous revision if the new one does not come up.
  It also prunes old images afterwards.
- **GitHub environments** `staging` and `production` (production with required
  reviewers), each carrying `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` and
  `DEPLOY_KNOWN_HOSTS`.
- A nice guard: `CONFIGURED` is computed from `secrets.DEPLOY_HOST != ''`
  because secrets cannot appear in step conditions, so an **unconfigured
  environment no-ops loudly instead of failing**.

**State today: zero environments exist in the repository**, so every deploy run
prints *"No DEPLOY_HOST for this environment yet; nothing to deploy"* and does
nothing. That is why the workflow has been harmless so far.

### To make it live

1. **Bootstrap the rebuilt host once by hand** — a clone at `~/ozymandosis`,
   `deploy/.env` populated, Docker installed. Everything after that is
   automatic.
2. **Create the two environments and the four secrets in each.** Only the owner
   can, because they contain the private key.
3. **Promote `testing` to `main`**, and the pipeline deploys itself.

### Two consequences worth naming

- Deploys run on the **House runner on the Thelio**, so a deploy needs the
  Thelio up — and the runner executing a deploy can read the deploy key. That is
  the standard self-hosted trade, but it is a trade, and it is worth remembering
  when anyone proposes running untrusted jobs on that runner.
- `main` is the release branch, so deployment is triggered by **promotion**
  rather than by every push. That is the flow working as intended.

## Do not

- **Do not run a mail server here.** A fresh IP with no sending reputation is a
  months-long deliverability project; mail goes out through Resend and lands at
  Purelymail (see `LAUNCH.md`).
- **Do not size for a player base that does not exist yet.**
