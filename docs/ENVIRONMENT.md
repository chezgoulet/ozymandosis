# Environment: tools and credentials for the release automation

The master list for what to install where, and which credentials go to whom.
**Credentials are named, never valued** — no value belongs in this file, in git, or
in chat.

Written from what is actually installed on both machines, measured 2026-09-29.

## Tools — already present

**My environment (`/home/robot`):** node, npm, python3, pip3, jq, curl, openssl,
unzip, git, gh, **age**. Enough for API work, scripting, and repo operations today.

**The build host (`sasquatch`, user `c`):** node 22, npm, python3, jq, curl,
openssl, unzip, zip, git, gh, docker, **adb**, **JDK 21** with `keytool` and
`jarsigner`, ffmpeg, and the Android SDK with `aapt2` (three versions),
**`apkanalyzer`**, the emulator, and two AVDs (API 35 and 36).

> `apkanalyzer` is the useful one, and it is already there: it reads the manifest,
> the versionCode, and the permissions **out of the artifact**, so a claim about what
> is inside an APK or AAB can be a measurement rather than a grep of `build.gradle`.

## Tools — to install

| Tool | Where | Why | How |
|---|---|---|---|
| vault client | mine | **not installed by hand.** The Hermes integration installs and verifies its own: `hermes secrets bitwarden install` (pins `bws` v2.0.0). The earlier note here named `bw` — wrong binary, and installing it by hand was never needed. | `hermes secrets bitwarden setup` |
| `op` (1Password CLI) | mine | only if you choose 1Password rather than Bitwarden | 1Password publishes no user-level binary, so this one does need `sudo apt-get install 1password-cli` |
| **bundletool** | build host | generate installable APKs **from the AAB**, so a device runs the exact artifact Play delivers; and validate the bundle | the `bundletool-all-<version>.jar` from google/bundletool releases into `~/bin`, no sudo |
| **ImageMagick** | build host | the 1024×500 feature graphic, the 512×512 icon, and cropping screenshots to Play's required sizes | `sudo apt-get install -y imagemagick` — **needs sudo** |
| `gcloud` | build host | only if I am to create the Cloud project, the service account and the Pub/Sub topic for billing notifications by API instead of you clicking | Google's apt repo — **needs sudo** |
| `shellcheck` | both | cheap correctness check on the scripts and workflows I write | **needs sudo** |
| `age` | **the deployment boxes** | `deploy/backup.sh` shells out to it — `age -r "$BACKUP_AGE_RECIPIENT"` — so it is a runtime dependency of the box, not of the build host | installed by the bootstrap |
| `rclone` | **the deployment boxes** | `deploy/backup.sh` copies off-site with it (`rclone delete --min-age … "$BACKUP_REMOTE"`) | installed by the bootstrap |
| PATH fix | build host | `adb`, `keytool` and `jarsigner` are installed but not on a non-interactive shell's PATH — the same asymmetry that broke `android-keygen.sh` | one profile line, no sudo |

`pip3` is absent on the build host, so anything Python there is stdlib-only. That has
not been a constraint yet and I would rather keep it that way than install a second
Python.

## The installers

Two scripts, one per machine, both in `tools/`. Both are idempotent, both **detect
rather than assume** — they look in known locations and not only at `PATH`, because
`node`, `adb` and `keytool` are installed on the build host yet invisible to a
non-interactive shell, which is the same asymmetry that broke `android-keygen.sh` —
and both **end with a verification pass** that reports each tool as present or missing.
An installer that does not verify is an installer that lies.

```
bash tools/install-build-host.sh [--dry-run] [--prefix DIR] [--no-profile]
bash tools/install-agent-host.sh [--dry-run] [--prefix DIR]
```

**`install-build-host.sh`** — for sasquatch. Installs **bundletool** (the jar plus a
wrapper into `~/bin`, no root), appends the PATH line that makes `adb`, `keytool` and
`jarsigner` visible to non-interactive shells, and attempts **ImageMagick**,
**shellcheck** and **gcloud** *only if passwordless sudo is available.* On this host it
is not, so the script does everything it can without root and prints the exact
`sudo apt-get` line for the rest. It exits 1 when a required tool is missing, so it
doubles as a pre-flight check for the build host.

**`install-agent-host.sh`** — for mikoa. Installs the **Bitwarden CLI** from its own
release (a static binary, so no root), and prints the **1Password** apt instructions,
since 1Password publishes no user-level binary.

Neither script touches a credential and neither signs in to anything. The vault client
is installed so credentials can be *pulled* at process start; signing in needs your
master password and stays yours. No value should pass through a shell history or a chat.

One implementation note worth keeping: both resolve download URLs **from the GitHub
API** rather than building them from `/releases/latest/download/`. That shortcut is
wrong whenever a repository publishes several products on one release stream —
Bitwarden's "latest" release is the desktop app, so the CLI asset 404s.

## Credentials

**How to obtain each one, step by step, with the least privilege it can have, and the
read-only call that proves it works: `docs/CREDENTIALS-HOWTO.md`.** This document says
where each credential belongs; that one says how to get it.

### Where they go — one decision, then everything follows

**Preferred: your vault.** `hermes secrets bitwarden setup` installs `bws`, stores the
access token and picks the project; each credential then lives as an item in Bitwarden and
Hermes pulls it at process start. Nothing is pasted to me, nothing sits in a file on this
machine, and revoking is deleting the item. `hermes secrets sync` resolves the references
now and reports what changed, so "is it wired up" is a report rather than a hope.

1Password works the same way but needs `sudo apt-get install 1password-cli` first, since
1Password publishes no user-level binary. Then `hermes secrets onepassword setup --account
<shorthand>`, and per credential `hermes secrets onepassword set LINODE_API_KEY
'op://Vault/Item/field'`.

**Alternative — `~/.hermes/.env` on mikoa** (mode 0600, 39 entries today). Simpler, and the
values then live in a file on a machine I can read. `hermes config set` is *not* the tool
for this: it writes settings to `config.yaml`, and secrets never belong there.

**Never: this chat.** A Telegram group message is not a secret channel, and this thread has
history.

**You supply each credential once.** I read it from the environment and write it where it
belongs — the GitHub repository secrets, and `deploy/.env` on the boxes — without printing a
value. The one credential the mechanism itself needs is a vault access token, and that goes
in through the tool (`hermes secrets bitwarden setup`), not through me.

### A. Into my environment — Hermes' store, or your vault via `hermes secrets`

| Name | What it is | Notes |
|---|---|---|
| `GOOGLE_PLAY_SERVICE_ACCOUNT` | the Play API service account JSON | scope: *Release apps to testing tracks*; add *Release to production* when you want it. Rotatable. |
| `LINODE_API_KEY` | **a scoped replacement** for the one I hold | `linodes:read_write` + `domains:read_write` is the whole job. Mine is currently full access, which also carries billing. |
| `RESEND_API_KEY` | sending | scope to the domain, sending only |
| `PURELYMAIL_API_KEY` | the mailbox owner key | lets me create `privacy@` and `support@` and read the DNS records they require |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | the OAuth client | only if I am to exercise sign-in myself; they are also runtime credentials (below) |
| `STEAM_API_KEY` | Steamworks publisher key | later, with the Steam release |
| `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_TEAM_ID`, `APPLE_CLIENT_ID` | App Store Connect API key | later, with iOS |
| `OP_SERVICE_ACCOUNT_TOKEN` or `BW_ACCESS_TOKEN` | the vault itself | only if you choose the `hermes secrets` path |

### B. That I generate, not that you give me

`SECRET_KEY`, `METRICS_TOKEN`, `GOOGLE_PLAY_RTDN_TOKEN`, `TURN_SECRET`,
`DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`. These are random bytes or key material; I make
them, show you the names, and never the values.

### C. GitHub repository secrets — the names I will create

- `STAGING_DEPLOY_HOST`, `STAGING_DEPLOY_USER`, `STAGING_DEPLOY_SSH_KEY`, `STAGING_DEPLOY_KNOWN_HOSTS`
- `PROD_DEPLOY_HOST`, `PROD_DEPLOY_USER`, `PROD_DEPLOY_SSH_KEY`, `PROD_DEPLOY_KNOWN_HOSTS`
- `GOOGLE_PLAY_SERVICE_ACCOUNT`

Prefixed rather than environment-scoped because the org is on GitHub Free with a
private repo, where environments cannot be configured at all.

**No keystore secret is needed, and that is the better design.** The runner is
self-hosted on the same machine where `android/keystore.properties` already points at
the upload key, so CI reads the key from the filesystem and **the upload key never
enters GitHub.**

### D. Runtime — `deploy/.env` on each box

**The service refuses to boot without these:** `DATABASE_URL`, `SECRET_KEY`,
`SMTP_URL`.

**Without these it boots but the product does not work:** `TURN_URLS` and
`TURN_SECRET` (every online match is relayed — no TURN, no multiplayer),
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (sign-in),
`GOOGLE_PLAY_SERVICE_ACCOUNT` and `GOOGLE_PLAY_RTDN_TOKEN` (billing),
`GOOGLE_CLOUD_PROJECT_NUMBER` (Play Integrity).

**Operations:** `METRICS_TOKEN`, and either `ALERT_EMAIL` or `ALERT_WEBHOOK_URL`.

**Backups** — `deploy/backup.sh` shells out to `age` and `rclone`, so it needs
`BACKUP_AGE_RECIPIENT` (the **public** half, an `age1…` string), `BACKUP_REMOTE`, and
an rclone remote configured for Linode Object Storage with **its own access key and
secret**. That key pair was missing from my earlier list.

> The age **private** key must never live on the box it protects. Encrypted backups
> whose only key sits on the machine they back up are not backups. Its homes are your
> password manager and the offline copy — the same two places as the upload key.

**Leave alone:** `WEB_BILLING` off, `REQUIRE_STORE_CLIENT` on (both already the
production defaults).

### E. Not needed

**Stripe** — `WEB_BILLING` is off and the config only demands Stripe keys when it is
on; memberships are sold in each platform's store. **Play Console login** — a browser
session holding your Google identity is too much authority for forms that are legal
declarations, and most of those fields have no API anyway. **Cloudflare** — the zone
is on Linode.

## The one-time things only you can create

1. A Google Cloud project, the Play Android Developer API enabled, and a service
   account — unless you install `gcloud` and give me a credential with IAM rights.
2. The **service account invited in Play Console** → Users and permissions, with app
   permissions. Without this the JSON key authenticates and is authorised for nothing.
3. A Google Cloud **OAuth client** (Web application) with the redirect
   `https://play.ozymandosis.com/api/auth/google/callback`, for sign-in.
4. **Purelymail** and **Resend** accounts.
5. A **scoped Linode token**, replacing the full-access one.
6. A **Linode Object Storage** bucket and its access key pair, for the off-site backups
   — and an **age keypair** to encrypt them, whose private half lives only in your
   password manager and the offline copy, never on the box.
7. Later: Apple Developer and Steamworks.

Everything after those six is mine.
