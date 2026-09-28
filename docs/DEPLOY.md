# Deploying ozymandosis.com on Linode

One Linode runs everything with Docker Compose: Caddy (automatic HTTPS for the site, the play service and the TURN certificate), the play service, Postgres 17, coturn, and the backup service. A second, small Linode runs staging. Day-to-day operation (deploys, alerts, backups, key rotation, incidents) is in [OPERATIONS.md](OPERATIONS.md); what only you can do before launch is in [LAUNCH.md](LAUNCH.md).

## 1. Linodes

| | Plan | Why |
|---|---|---|
| Production | Shared CPU, 4 GB (2 vCPU) to start; Dedicated CPU when matches are busy | Postgres, the service and TURN relaying fit comfortably; TURN bandwidth is the main cost as players grow. |
| Staging | Nanode 1 GB | Same stack, Stripe test keys, `staging.ozymandosis.com`. Every release goes here first. |

For both: Ubuntu 24.04 LTS, your SSH key, a region near most players. Then turn on **Backups** for the production Linode (Linode's daily/weekly disk snapshots: a second layer under the database backups).

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
| A (+ AAAA) | `staging`, `www.staging`, `play.staging`, `turn.staging` | staging Linode |
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
git clone git@github.com:chezgoulet/efflorescent.git ~/ozymandosis && cd ~/ozymandosis
cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
openssl rand -base64 32    # three times: SECRET_KEY, POSTGRES_PASSWORD, TURN_SECRET
$EDITOR deploy/.env        # domain, public IP, secrets, SMTP, Stripe, providers, backups, alerts
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml logs -f web play
```

Put `SECRET_KEY` in your password manager too: it decrypts two-factor secrets and the ticket signing keys. Losing it means every player sets up two-factor again.

Staging is the same with `DOMAIN=staging.ozymandosis.com`, Stripe **test** keys, and its own secrets (never share secrets between the two).

## 6. The first owner

```
docker compose -f deploy/docker-compose.yml exec play node apps/play/dist/cli.js create-owner you@example.com "a long passphrase"
```

Sign in at https://play.ozymandosis.com, turn on two-factor sign-in (required for staff tools in production), sign out and back in, then open https://play.ozymandosis.com/admin. Promote moderators with `cli.js promote <email|name> moderator` or from their player page.

## 7. Stripe (off by default)

Memberships are sold in each platform's store (docs/MONETIZATION.md, D20), so web checkout is off (`WEB_BILLING=false`) and none of this is needed. Only if an operator decides to sell on the web:


1. Create the product and prices: `… exec play node apps/play/dist/cli.js stripe:setup` creates $2/month (tax included); `stripe:setup 1200` also creates a $12/year plan. Or create your own and set `STRIPE_PRICE_ID` / `STRIPE_PRICE_ID_YEARLY`.
2. **Tax**: Dashboard → Tax → activate Stripe Tax, set your origin address, and add registrations where you must collect (EU One-Stop Shop, UK, and US states as you cross thresholds). Checkout computes tax automatically (`STRIPE_TAX=true`); if Stripe Tax is not active, checkout still works and the admin console raises an alert.
3. Webhook endpoint `https://play.ozymandosis.com/api/billing/webhook` with events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.payment_failed`. Its signing secret goes in `STRIPE_WEBHOOK_SECRET`.
4. Settings → Billing → Customer portal: allow cancelling, switching plans and updating payment methods.
5. Test everything on staging with test-mode keys and cards (`4242 4242 4242 4242`, and `4000 0027 6000 3184` for 3-D Secure).

## 8. Sign-in providers

Each needs an app registered with the provider; the redirect URI is `https://play.ozymandosis.com/auth/<provider>/callback` (and the staging equivalent in a separate app).

| Provider | Where | Notes |
|---|---|---|
| Google | Google Cloud console → APIs & Services → Credentials → OAuth client (Web) | Scopes: openid, email, profile. Publish the consent screen before launch. |
| Apple | Apple Developer → Identifiers → Services ID (Sign in with Apple, domain and return URL) and a Sign in with Apple key (.p8) | `APPLE_CLIENT_ID` is the Services ID; paste the .p8 with `\n` for newlines. |
| Steam | Web sign-in works without setup. Native builds need `STEAM_APP_ID` and a publisher `STEAM_API_KEY`. | |

## 9. Monitoring

Set `ALERT_EMAIL` and/or `ALERT_WEBHOOK_URL`, then add the outside watchers described in [OPERATIONS.md](OPERATIONS.md#watching-from-outside). The service can only report what it can see; a dead server needs someone else to notice.

## 10. Updating

```
deploy/deploy.sh            # or the "deploy" GitHub workflow
```

It backs up the database, builds, starts the new release, waits for it to be healthy, and rolls back automatically if it is not. Details and the rules for migrations are in [OPERATIONS.md](OPERATIONS.md#releases).

## Mobile and desktop builds

- There is no browser version (docs/MONETIZATION.md); the website links to the stores.
- Android and iOS: `npm run android:aab` (docs/RELEASE-ANDROID.md), `npm run ios:open` (Capacitor 8; Android targets API 36). The apps sell memberships through their own stores (docs/STORES.md).
- Desktop: `cd apps/desktop && npm install && npm run package` (Electron; launches fullscreen). Launched from Steam (or with `steam_appid.txt` beside it) it behaves as a Steam build. Signing and notarization: [LAUNCH.md](LAUNCH.md#code-signing).
