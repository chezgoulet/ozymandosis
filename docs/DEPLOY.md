# Deploying ozymandosis.com

One VPS runs everything with Docker Compose: Caddy (automatic HTTPS for the site, the play service and the TURN certificate), the play service, Postgres 17, coturn and nightly backups. 2 vCPU / 4 GB is plenty to start; TURN bandwidth is the main cost as the player count grows.

## 1. DNS

Point these at the server's public IPv4 (and IPv6 if you have it):

| Record | Name |
|---|---|
| A / AAAA | `ozymandosis.com` |
| A / AAAA | `www.ozymandosis.com` |
| A / AAAA | `play.ozymandosis.com` |
| A / AAAA | `turn.ozymandosis.com` |

## 2. Firewall

Open TCP 80, 443; UDP 443 (HTTP/3); TCP and UDP 3478; TCP 5349; UDP 49160–49400 (TURN relay ports). Nothing else needs to be public (Postgres and the play service are only on the Compose network).

## 3. Install and configure

```
git clone <repo> /opt/ozymandosis && cd /opt/ozymandosis
cp deploy/.env.example deploy/.env
openssl rand -base64 32    # run three times: SECRET_KEY, POSTGRES_PASSWORD, TURN_SECRET
$EDITOR deploy/.env        # domain, public IP, secrets, SMTP, Stripe, providers
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml logs -f web play
```

Keep `SECRET_KEY` safe and backed up: it decrypts 2FA secrets and the ticket signing key. Losing it means every player must set up 2FA again.

## 4. The first owner

```
docker compose -f deploy/docker-compose.yml exec play node apps/play/dist/cli.js create-owner you@example.com "a long passphrase"
```

Sign in at https://play.ozymandosis.com, turn on two-factor sign-in (required for staff tools in production), sign out and back in, then open https://play.ozymandosis.com/admin. Promote moderators with `cli.js promote <email|name> moderator` or from their player page.

## 5. Stripe

1. Create the product and $1/month price: `docker compose … exec play node apps/play/dist/cli.js stripe:setup` (or create one yourself and set `STRIPE_PRICE_ID`).
2. Dashboard → Developers → Webhooks → add endpoint `https://play.ozymandosis.com/api/billing/webhook` with events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.payment_failed`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Settings → Billing → Customer portal: allow cancelling and updating payment methods.
4. Test with test-mode keys first; `stripe listen --forward-to` works against a local `npm run play:dev`.

App stores: Apple and Google require their own in-app purchase for digital goods in many regions, and Steam requires Steam Wallet for purchases inside Steam builds. The game currently opens the website for membership; review each store's current rules (US storefronts allow external purchase links on iOS) before submitting, and add store billing if needed.

## 6. Sign-in providers

Each needs an app registered with the provider; the redirect URI is `https://play.ozymandosis.com/auth/<provider>/callback`.

| Provider | Where | Notes |
|---|---|---|
| Google | Google Cloud console → APIs & Services → Credentials → OAuth client (Web) | Scopes: openid, email, profile. |
| Apple | Apple Developer → Identifiers → Services ID (enable Sign in with Apple, add the domain and return URL) and a Sign in with Apple key (.p8) | `APPLE_CLIENT_ID` is the Services ID; paste the .p8 with `\n` for newlines. |
| Discord | discord.com/developers → Applications → OAuth2 | Scopes: identify, email. |
| GitHub | Settings → Developer settings → OAuth Apps | |
| Steam | Works without setup for web sign-in. For native builds set `STEAM_APP_ID` and a publisher `STEAM_API_KEY`. |

## 7. Email

Any SMTP provider. Set SPF, DKIM and DMARC for the sending domain or verification mail lands in spam. `MAIL_FROM` must be an address the provider may send as.

## 8. Backups and restore

`deploy/backups/` receives a compressed dump every 24 hours (14 kept). Copy it off the machine, for example with a nightly `rclone copy deploy/backups remote:ozymandosis-backups`.

Restore:

```
gunzip -c deploy/backups/ozy-YYYYMMDD-HHMM.sql.gz | docker compose -f deploy/docker-compose.yml exec -T db psql -U ozy ozy
```

## 9. Updating

```
git pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Migrations run automatically at start. Matches in progress continue during a restart because they are peer to peer; lobbies and queues reset. To force old clients to update, raise **Minimum client version** in the admin console. For a longer outage, turn on **Maintenance** there first.

## 10. Monitoring

- `GET https://play.ozymandosis.com/healthz` for an uptime monitor.
- The admin dashboard shows live players, lobbies, members, crash and report counts.
- `docker compose … logs play` holds request lines (route, status, time, pseudonymous user) and errors, with no personal data.

## Mobile and desktop builds

- Web and PWA: served at https://ozymandosis.com/play/.
- Android and iOS: `npm run android:apk`, `npm run ios:open` (Capacitor). The native apps talk to play.ozymandosis.com by default.
- Desktop: `cd apps/desktop && npm install && npm run package` (Electron; launches fullscreen). A Steam build adds the Steamworks SDK for tickets (`POST /api/auth/steam-ticket`).
