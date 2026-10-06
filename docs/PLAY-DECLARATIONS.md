# Play Console declarations — the answers, and the one that isn't true yet

Source of truth for the data answers: `docs/DATA-INVENTORY.md`, which is
generated from the code and which `apps/play/test/inventory.test.ts` fails on if
it drifts. Nothing here is recalled; where an answer needs a decision rather than
a fact, it says so.

## The blocker: the deletion URL does not exist yet

Google Play requires that an app supporting account creation provide **both**:

1. an **in-app** path to delete the account and its data, and
2. a **publicly reachable web link** where a user can request deletion.

(1) is done — Settings → Delete account, and the account page offers download,
sign-out-everywhere, and deletion. **(2) is not.** The only web deletion path is
the account page at `play.ozymandosis.com`, and that hostname **does not resolve**:
the Linode zone holds only the apex and `www` for the static site, and the play
service is not deployed. So the field has nothing truthful to point at.

**Shortest honest path, in order:**

1. Sign up the mail provider (Purelymail) so `privacy@ozymandosis.com` exists —
   a deletion *request* needs somewhere to arrive.
2. Add `/delete-account` to the live site (`apps/site/public/`), stating the
   in-app steps and the email route for people who no longer have the app.
3. That page is the URL. Later, when the service is deployed, the site page can
   link to the account page and the account page becomes the primary route.

Nothing else in this document is blocked.

## Data safety

**Collected, not shared** (from the inventory's summary):

- App activity — App interactions, Other actions, Other user-generated content
- App info and performance — Crash logs, Other app performance data
- Messages — Other in-app messages
- Personal info — Name, Other info (the password hash and 2FA secret, the age range)

**Collected, and shared with service providers**:

- Financial info — Purchase history
- Personal info — Email address; User IDs

> **One decision, not a fact.** Play's Data Safety definitions exclude
> *service providers* acting on the developer's behalf from "shared" — which
> would make all three of the above **not shared**, with Stripe, Google, Apple and
> the email provider named as processors. The inventory phrases them as "shared
> with service providers only". Read the live form's own definition wording
> before answering, because the two readings are both defensible and getting it
> wrong is an enforcement matter rather than a cosmetic one.

**Not collected:** location, contacts, photos, files, calendar, health, device
identifiers, web history.

**Security practices:** data is **encrypted in transit** (HTTPS/WSS; matches are
DTLS). Deletion is available — subject to the URL above.

**Optional vs required** matters on the form and the inventory carries it per row:
display name, cloud saves, memberships, reports, crash reports and performance
data are **optional**; email, user IDs, age range, purchase history and match
records are **required**.

## Content rating (IARC questionnaire)

- **Violence:** creature-on-creature combat; no human or humanoid violence.
  Confirm against the final build whether any blood or dismemberment is depicted —
  the questions branch on it and I have not verified it from the code.
- **Sexuality, nudity, profanity, controlled substances, gambling:** none. There
  are **no loot boxes** — powerups spawn in the world and nothing randomised is
  sold (the monetization ruling is cosmetics and designs only).
- **Digital purchases:** **no.** The app is free on every platform and nothing is sold inside it; memberships are bought on the website. *(This was "yes" until 2026-10-06, when the in-app purchase went away.)*
- **User-generated content and online interaction:** **yes.** This is the answer
  that drives the rating, and it is unavoidable: chat goes through the server and
  is filtered, and reports are moderated.
- **Location sharing:** no.

## Target audience

**13 and over**, because the service enforces a 13+ age gate and stores only an
age band, never a birth date.

> **The risk a reviewer may disagree with.** The content — glowing creatures, a
> colourful palette, no gore — reads as child-appealing, and the target-audience
> answer is about who the app is *designed for*. The defence is that there is no
> under-13 experience at all: no account, no chat, no online play. Declaring an
> under-13 audience would pull the app into the Families policy, which is a much
> heavier obligation than it looks. **Answer 13+, and be ready to point at the
> gate.**

## Ads

**No ads.** No advertising or analytics SDK is present (the inventory lists every
third-party library and only Play Billing and Play Integrity collect anything),
and the privacy page states there are no advertising or tracking cookies.

## App access

Some functionality requires sign-in: **single-player and LAN need no account**;
online play needs one. So this is *not* "all functionality is available without
special access".

**Action:** create a working reviewer account and put its credentials in this
field, with a note that single-player and LAN can be reached without it. Keep
that account valid for the whole of review — a password change or an expiry
during review reads as a broken app.

## Privacy policy

`https://ozymandosis.com/privacy` — **live and verified** (200 over HTTPS, served
from GitHub Pages). It covers retention per data type and names the processors.

## Summary of what must exist before this page can be submitted

| Field | State |
|---|---|
| In-app account deletion | done |
| Web deletion-request URL | **does not exist — needs the mail provider and a site page** |
| Privacy policy URL | live |
| Data safety answers | ready, one definitional decision |
| Content rating | ready, one question to confirm from the build |
| Target audience | 13+, with the reasoning recorded |
| Ads | no |
| App access | needs a reviewer account |
