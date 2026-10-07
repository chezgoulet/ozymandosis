# Deploying ozymandosis.com on Linode

One Linode runs everything with Docker Compose: Caddy (automatic HTTPS for the site, the play service and the TURN certificate), the play service, Postgres 17, coturn, and the backup service. There is no permanent staging server: a test box is spun up on demand and destroyed (see "A staging box, when you need one"). Day-to-day operation (deploys, alerts, backups, key rotation, incidents) is in [OPERATIONS.md](OPERATIONS.md); what only you can do before launch is in [LAUNCH.md](LAUNCH.md).

## 1. Linodes

| | Plan | Why |
|---|---|---|
| Production | Shared CPU, 4 GB (2 vCPU) to start; Dedicated CPU when matches are busy | Postgres, the service and TURN relaying fit comfortably; TURN bandwidth is the main cost as players grow. |
| Staging | Nanode 1 GB, **on demand** | Not part of the pipeline and not always running. Spin one up when a change has to be proved against a real server — store billing with test keys, a migration, a restore drill — then destroy it. |

Ubuntu 24.04 LTS, your SSH key, a region near most players. Then turn on **Backups** for the production Linode (Linode's daily/weekly disk snapshots: a second layer under the database backups).

On each server:

```
adduser --disabled-password deploy && usermod -aG docker deploy   # after installing Docker Engine + compose plugin
apt install unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
# /etc/ssh/sshd_config: PasswordAuthentication no, PermitRootLogin no
```

## 2. Cloud Firewall

Create a Linode Cloud Firewall, attach it to the production Linode, default inbound **drop**, and allow:

| Protocol | Ports | From |
|---|---|---|
| TCP | 22 | your IP(s) and the deploy runner if you use the GitHub deploy workflow |
| TCP | 80, 443 | anywhere |
| UDP | 443 | anywhere (HTTP/3) |
| TCP + UDP | 3478 | anywhere (TURN) |
| TCP | 5349 | anywhere (TURN over TLS) |
| UDP | 49160–49400 | anywhere (TURN relay ports) |

Postgres and the play service are only on the Compose network and are never exposed.

## 3. DNS

At your registrar, or in Linode's DNS Manager (point the domain's nameservers to `ns1–ns5.linode.com`):

| Record | Name | Value |
|---|---|---|
| A (+ AAAA) | `ozymandosis.com`, `www`, `play`, `turn` | production Linode |
| TXT / CNAME | SPF, DKIM, DMARC | from your email provider (see [LAUNCH.md](LAUNCH.md#email)) |
| CAA | `ozymandosis.com` | `0 issue "letsencrypt.org"` and `0 issue "sectigo.com"` (Caddy's fallback issuer, ZeroSSL) |

## 4. Object Storage (off-site backups)

Create a bucket (for example `ozymandosis-backups`) in a **different region** from the production Linode, and an access key limited to that bucket (read/write). Put the endpoint (shown in Cloud Manager, e.g. `us-ord-1.linodeobjects.com`), key and secret in `deploy/.env`. Optionally add a lifecycle rule to expire objects after 90 days; the backup service also prunes them.

On **your own computer** (never the server):

```
age-keygen -o ozymandosis-backup.key      # prints the public key: age1...
```

Store `ozymandosis-backup.key` in your password manager and on an offline drive. Put the public key in `BACKUP_AGE_RECIPIENT`. The server can write backups but cannot read them.

## 5. Install and configure

```
sudo -iu deploy
git clone git@github.com:chezgoulet/ozymandosis.git ~/ozymandosis && cd ~/ozymandosis
cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
openssl rand -base64 32    # three times: SECRET_KEY, POSTGRES_PASSWORD, TURN_SECRET
$EDITOR deploy/.env        # domain, public IP, secrets, SMTP, Stripe, providers, backups, alerts
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml logs -f web play
```

Put `SECRET_KEY` in your password manager too: it decrypts two-factor secrets and the ticket signing keys. Losing it means every player sets up two-factor again.

### A staging box, when you need one

Staging is **not part of the pipeline**, and there is no standing staging server or
`staging.` DNS. When a question can only be answered against a real server, build
one by hand:

1. a Nanode, `linode/ubuntu24.04`, the same cloud firewall;
2. `adduser deploy` + Docker, then the usual clone at `~/ozymandosis`;
3. `deploy/.env` with `DOMAIN` set to a throwaway name and **its own** secrets —
   never production's, and never production's database or store credentials;
4. `deploy/deploy.sh <tag or commit>` on that box, by hand;
5. when the question is answered, destroy the Linode.

Nothing in CI knows the box exists. That is deliberate: a permanent staging server
is a second thing to patch, pay for and keep in sync, and this project does not have
the traffic to justify it yet.

## 6. The first owner

```
docker compose -f deploy/docker-compose.yml exec play node apps/play/dist/cli.js create-owner you@example.com "a long passphrase"
```

Sign in at https://play.ozymandosis.com, turn on two-factor sign-in (required for staff tools in production), sign out and back in, then open https://play.ozymandosis.com/admin. Promote moderators with `cli.js promote <email|name> moderator` or from their player page.

## 7. Stripe (on, for the FOSS rail)

The store builds sell in their store. The FOSS build has no store, so its membership is bought here, on the
website — see the revision in docs/MONETIZATION.md. That makes this section part of the product rather than an
option.

**Set both secrets and the flag together, or the service will not boot.** With `WEB_BILLING=1`, production
config validation requires `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (`apps/play/src/config.ts`); without
them the new container fails its health window and the deploy rolls back to the previous revision.

```
# in deploy/.env, on the server
WEB_BILLING=1
STRIPE_SECRET_KEY=sk_live_…        # Stripe dashboard → Developers → API keys
STRIPE_WEBHOOK_SECRET=whsec_…      # created with the endpoint in step 3 below
```

Then:


1. Create the product and prices: `… exec play node apps/play/dist/cli.js stripe:setup` creates $2/month (tax included); `stripe:setup 1200` also creates a $12/year plan. Or create your own and set `STRIPE_PRICE_ID` / `STRIPE_PRICE_ID_YEARLY`.
2. **Tax**: Dashboard → Tax → activate Stripe Tax, set your origin address, and add registrations where you must collect (EU One-Stop Shop, UK, and US states as you cross thresholds). Checkout computes tax automatically (`STRIPE_TAX=true`); if Stripe Tax is not active, checkout still works and the admin console raises an alert.
3. Webhook endpoint `https://play.ozymandosis.com/api/billing/webhook` with events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.payment_failed`. Its signing secret goes in `STRIPE_WEBHOOK_SECRET`.
4. Settings → Billing → Customer portal: allow cancelling, switching plans and updating payment methods.
5. Prove it on an on-demand staging box first, with test-mode keys and cards (`4242 4242 4242 4242`, and `4000 0027 6000 3184` for 3-D Secure).

## 8. Sign-in providers

Each needs an app registered with the provider; the redirect URI is `https://play.ozymandosis.com/auth/<provider>/callback`. If you spin up a staging box, register a second app for its own callback URL — never point a test box at a production OAuth client.

| Provider | Where | Notes |
|---|---|---|
| Google | Google Cloud console → APIs & Services → Credentials → OAuth client (Web) | Scopes: openid, email, profile. Publish the consent screen before launch. |
| Apple | Apple Developer → Identifiers → Services ID (Sign in with Apple, domain and return URL) and a Sign in with Apple key (.p8) | `APPLE_CLIENT_ID` is the Services ID; paste the .p8 with `\n` for newlines. |
| Steam | Web sign-in works without setup. Native builds need `STEAM_APP_ID` and a publisher `STEAM_API_KEY`. | |

## 9. Monitoring

Set `ALERT_EMAIL` and/or `ALERT_WEBHOOK_URL`, then add the outside watchers described in [OPERATIONS.md](OPERATIONS.md#watching-from-outside). The service can only report what it can see; a dead server needs someone else to notice.

## 10. Updating

```
deploy/deploy.sh <tag or commit>                    # on the server
gh workflow run deploy.yml -f ref=<tag or commit>   # the deploy workflow
```

It backs up the database, builds, starts the new release, waits for it to be healthy, and rolls back automatically if it is not. Details and the rules for migrations are in [OPERATIONS.md](OPERATIONS.md#releases).

**What deploys, and when.** A release tag (`v0.6.0`) deploys the service *if the release touched `apps/play` or `deploy/`* — a client-only release does not rebuild the server for nothing. `git tag v0.6.0 && git push origin v0.6.0` is the whole ritual; [OPERATIONS.md](OPERATIONS.md#releases) has the table and what the client release does. A push to a branch never deploys.

**Two notes about the mechanics**, both of which have bitten:

- Because GitHub resolves `workflow_dispatch` against the **default branch**, this workflow file has to exist on `main` — editing it on `testing` alone changes nothing about what a manual dispatch runs. A tag push is different: it runs the copy in the tagged commit.
- A tag can point at any commit, including one that never passed CI, so the deploy refuses unless `tools/ci-status.cjs` finds a green `ci` run for that exact SHA.

## Mobile and desktop builds

- There is no browser version (docs/MONETIZATION.md); the website links to the stores.
- Android and iOS: `npm run android:aab` (docs/RELEASE-ANDROID.md), `npm run ios:open` (Capacitor 8; Android targets API 36). The apps sell memberships through their own stores (docs/STORES.md).
- Desktop: `cd apps/desktop && npm ci && npm run package` (Electron; launches fullscreen; on Linux the Steam depot is `dist/linux-unpacked/`, see [STORES.md](STORES.md#the-linux-build)). Launched from Steam (or with `steam_appid.txt` beside it) it behaves as a Steam build. Signing and notarization: [LAUNCH.md](LAUNCH.md#code-signing).
