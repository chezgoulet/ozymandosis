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
| `op` (1Password CLI) | mine | required by the credential channel below | static binary into `~/.local/bin`, no sudo |
| `bw` (Bitwarden CLI) | mine | the alternative to `op` | same |
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

## Credentials

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
