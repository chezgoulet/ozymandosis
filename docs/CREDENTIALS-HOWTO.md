# Obtaining the Ozymandosis credentials

Where each one goes is `docs/ENVIRONMENT.md`. This is **how to get it**, in the order that
unblocks the most, with the least privilege each one can have.

Every step below was checked against the provider's own current documentation on
2026-09-30. Where I could not confirm something, it says so rather than guessing.

Two conventions throughout: **you paste a value into `~/.hermes/.env` on mikoa** (the
`#fill` block, uncomment and fill), and **each one gets a read-only check** before we trust
it — section 9. A mistyped key and a correct one look identical sitting in a file.

---

## 0. gcloud, on the build host

Two routes. The apt one is what Google documents; the tarball one needs no root at all,
which matters because `c` on the Thelio has no passwordless sudo.

**apt route (needs your sudo):**

```bash
sudo apt-get update
curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee -a /etc/apt/sources.list.d/google-cloud-sdk.list
sudo apt-get update && sudo apt-get install google-cloud-cli
```

Check `/etc/apt/sources.list.d/google-cloud-sdk.list` for duplicate lines before the last
step — the Google docs call that out, and a duplicate repo makes apt complain. The package
is `google-cloud-cli`; it gives you `gcloud`, `gsutil` and `bq`, but **not** `kubectl` or
the App Engine extensions.

**No-root route:** download `google-cloud-cli-linux-x86_64.tar.gz`, extract it, and run
`./google-cloud-cli/install.sh` with `--install-dir` pointing somewhere under `$HOME`.
Add that dir to `PATH`. Same CLI, no sudo.

**Why we want it at all:** it is only needed if *I* am to create the Cloud project, the
service account and the Pub/Sub topic by API rather than you clicking through the console.
If you would rather click, skip this section entirely — sections 4 and 5 are console work
either way.

---

## 1. Purelymail — the critical path

The whole chain waits on this: mailbox → the web deletion-request page → App content →
the closed track → the fourteen continuous days. Nothing else is on that chain.

1. **Create the account** at purelymail.com. It is a paid service, priced per user.
2. **Add the domain.** Account Admin portal → **Domains** → **Add New Domain** → enter
   `ozymandosis.com`. Purelymail then shows you the records it wants:
   - an **ownership** proof record — required, and you cannot add the domain without it,
   - **MX** → `mailserver.purelymail.com` (priority 50) for incoming mail,
   - **SPF**, for sending,
   - **three DKIM CNAMEs** (`purelymail1/2/3._domainkey` → `key1/2/3.dkimroot.purelymail.com`) —
     three because they rotate keys,
   - **DMARC** (`_dmarc` → `dmarcroot.purelymail.com`), recommended.
   **Those records get written into the Linode zone, which is mine to do** — copy them to me
   and I will add them and verify with `dig` against the Linode nameservers. Do not set them
   at the registrar; the zone lives at Linode.
   One caution: **delete any pre-existing MX or SPF records for the domain first.** Ours has
   none (the zone currently holds only the Pages records), so this should be clean.
3. **The API key.** Purelymail's API authenticates with a key from your account settings
   (the Account Admin portal; the API reference is at `news.purelymail.com/api`). I could
   not confirm the exact menu label from the docs, so: it is the credential your account
   uses to sign calls to `api.purelymail.com`, and its API is POST-with-JSON rather than
   REST. That becomes `PURELYMAIL_API_KEY`, and section 9 proves it by listing your domains.
4. **The mailboxes** — `privacy@` and `support@ozymandosis.com`. Create them as users, or as
   routing/aliases if you would rather they land in one inbox. `privacy@` matters beyond
   email: your privacy policy names a contact address and the stores check that it works.
5. **`SMTP_URL`** — while you are here, Purelymail offers SMTP too. Which provider sends is
   your call; Resend is the other option and is section 2.

---

## 2. Resend — sending

1. **Sign up** at resend.com and **add the domain** (Domains → add `ozymandosis.com`). It
   gives you a DKIM CNAME and an SPF record — again, send them to me and I write them into
   the Linode zone. **Do not proxy those records** if a proxy is ever involved; it breaks
   verification. **Resend's own docs say verification usually completes within 15 minutes**
   but can take up to 72 hours to propagate globally.
2. **Create the API key** — full access or, better, **`sending_access` restricted to
   `ozymandosis.com`**. That is the least privilege this one can have. Becomes
   `RESEND_API_KEY`.
3. **`SMTP_URL`** — Resend's SMTP settings are fixed and public: host `smtp.resend.com`,
   port `465` (implicit TLS) or `587` (STARTTLS), **username `resend`**, password your API
   key. So the value is `smtps://resend:YOUR_KEY@smtp.resend.com:465`. If you pick
   Purelymail for sending instead, use its SMTP details and skip this.

---

## 3. Linode — a scoped token, replacing the one I hold

1. Cloud Manager → **Profile** → **API Tokens** → **Create a Personal Access Token**.
2. Set an **expiry**. No expiry is the default and is a bad default.
3. Scopes — this is all the job needs:
   - **`linodes:read_write`** — create and manage the boxes
   - **`domains:read_write`** — the DNS records for mail and for `play.`
   - **`object_storage:read_write`** only if you want me to create the bucket in section 6
4. That is `LINODE_API_KEY`.

**And then revoke the old one.** The key currently in my environment is full access, which
includes billing and account settings — more authority than any of this needs. I will tell
you when the new one tests clean so you can revoke the old without a gap. In your `.env`
block this line is marked differently from the others for that reason: **fill it in before
uncommenting**, or the working key is shadowed and DNS work stops until it is not.

---

## 4. The Google Play service account

This is what turns the release path into something I do rather than you.

1. **Create a Google Cloud project** (console.cloud.google.com) — this can also be where
   the OAuth client lives.
2. **Enable the API:** `androidpublisher.googleapis.com`. By console, or
   `gcloud services enable androidpublisher.googleapis.com`.
3. **Create a service account:** IAM & Admin → Service Accounts → Create. Name it
   recognisably, e.g. `ozymandosis-play`. Copy its email
   (`…@….iam.gserviceaccount.com`).
4. **Create the JSON key:** the service account → Keys → Add key → **JSON**. It downloads
   once. Becomes `GOOGLE_PLAY_SERVICE_ACCOUNT` — **the whole file, on one line.**
5. **Invite it in Play Console** → **Users and permissions** → Invite new users → paste the
   service-account email → then **App permissions** → add `com.ozymandosis.game` and tick:
   - **Releases:** *Release apps to testing tracks* — and *Release to production* only when
     you decide I should have it. *Manage testing tracks and edit tester lists* is useful.
   - **Store presence:** *Manage store presence* — this is what lets the listings and images
     API work.
   - **Draft apps:** *Edit and delete draft apps*.
   - **App access:** *View app information (read-only)*.

   Play auto-selects *View app quality information*, *Manage policy declarations* and
   *Manage deep links* — they appear checked and greyed.

   **You do not need** *Admin (all permissions)*, *View financial data*, *Manage orders and
   subscriptions*, or *Reply to reviews* — **unless** you want me doing billing work, which
   needs the middle two. That is a real decision: the billing permissions are a different
   blast radius from releasing builds, and I would keep them separate.
6. **No acceptance step** — the service account is active as soon as it is invited.
7. **`GOOGLE_CLOUD_PROJECT_NUMBER`** — on the Cloud project's home page, the **project
   number** (not the id). Needed for Play Integrity.

---

## 5. The Google OAuth client, for sign-in

1. **Configure the consent screen first** — you cannot create a client without it. Google's
   current console groups this under the Auth Platform; a product name, a support email and
   the scopes will do. It is an internal-ish app, so no verification review is needed while
   it stays in testing.
2. **Create the client:** Credentials → Create credentials → **OAuth client ID** →
   application type **Web application**.
3. **Authorized redirect URI** — exactly this, and it must match byte for byte:

   ```
   https://play.ozymandosis.com/api/auth/google/callback
   ```

   Google enforces: **HTTPS only** (localhost is the sole exception), **no raw IP
   hostnames**, and the TLD must be on the public suffix list. Our redirect satisfies all
   three, which is another reason the service must be up at that hostname first.
4. That gives `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. They are needed by the
   **service**, not by me — sign-in does not work at all until they exist.

---

## 6. Object Storage, for the encrypted backups

Measured on your account just now: **27 clusters, and not one in Canada.** Nearest are
`us-east` (Newark), `us-iad` (Washington DC), `us-ord` (Chicago), `us-mia` (Miami). There
are also **zero buckets** on the account today, so this is a from-scratch setup.

1. **Create a bucket** in one of those regions — Cloud Manager → Object Storage → Create
   Bucket. Name it something like `ozymandosis-backups`. Becomes `BACKUP_REMOTE`.
2. **Create an access key** — Object Storage → Access Keys → Create. **Set the region on
   the key when you create it.** Linode changed this: a key created without a region may not
   include the newer endpoints in its scope, and their own changelog says to always define
   the regions. The key gives you an **Access Key** and a **Secret Key** — and the secret is
   shown **once, only in the creation response.** Those become `OBJECT_STORAGE_ACCESS_KEY`
   and `OBJECT_STORAGE_SECRET_KEY`; I will wire them into an rclone remote the backup script
   uses.
3. **The endpoint** for rclone is the cluster's `s3_endpoint`, e.g. `us-east-1.linodeobjects.com`.
   I can read the exact one for whichever region you pick.
4. **The age keypair is mine, not yours.** I generate it here and give you the **public**
   half (`age1…`) for `BACKUP_AGE_RECIPIENT`. The **private** half goes into your password
   manager and the offline copy — never onto the box it protects, for the same reason as the
   upload key. Encrypted backups whose only key sits on the machine they back up are not
   backups.

---

## 7. Later, with those platforms

- **Steamworks** — a publisher Web API key, from your Steamworks partner account. Needs the
  $100 Steam Direct fee and the 21-day wait first. Becomes `STEAM_API_KEY`.
- **Apple** — an App Store Connect API key (key id, issuer id, and the `.p8`). Needs the
  Apple Developer Program. Becomes the `APPLE_*` entries. iOS also still needs StoreKit
  before App Review will accept a membership.

---

## 8. What is mine to make, so you can skip it

`SECRET_KEY`, `METRICS_TOKEN`, `GOOGLE_PLAY_RTDN_TOKEN`, `TURN_SECRET`, `DEPLOY_SSH_KEY`,
`DEPLOY_KNOWN_HOSTS`, and the age keypair. Random bytes and key material. I make them, put
them where they belong, and show you the names — never the values.

---

## 9. Each one gets proved before we trust it

The point of this section is that **a wrong key and a right key look the same in a file.**
So as you supply each one, I run a read-only call against the provider and report what came
back. Nothing here changes anything at the provider.

| Credential | The call | What a pass looks like |
|---|---|---|
| `LINODE_API_KEY` | `GET /v4/profile` and `GET /v4/domains` | your username; the `ozymandosis.com` zone |
| `PURELYMAIL_API_KEY` | `POST api.purelymail.com/api/v0/listDomains` | the domain list, including `ozymandosis.com` once added |
| `RESEND_API_KEY` | `GET api.resend.com/domains` | the domain and its verification status |
| `GOOGLE_PLAY_SERVICE_ACCOUNT` | token exchange, then `GET …/applications/com.ozymandosis.game/edits` | an edit id, or a permission error naming the missing grant |
| `OBJECT_STORAGE_*` | S3 `ListBuckets` with the key pair | your bucket, and only your bucket |
| `GOOGLE_CLIENT_ID` | shape check only, for now | it ends in `.apps.googleusercontent.com` |
| `SMTP_URL` | a real test message to `privacy@`, then read the mailbox | the message arrives |

**One that cannot be proved here yet:** the OAuth client. Its real test is a sign-in, and
sign-in needs the service deployed at `play.ozymandosis.com`. So it gets a shape check now
and a real one the day the box is up — and I would rather say that than pretend a regex is
a verification.
