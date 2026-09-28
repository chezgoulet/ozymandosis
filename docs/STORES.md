# The App Store and Steam

How the iOS and Steam builds sell and prove what `docs/MONETIZATION.md` says, and what
a person sets up. Android is in docs/RELEASE-ANDROID.md. Implementation: D20.

## What the service checks

| | The $1 game (ownership, `/api/ownership/*`) | The membership | Counts on |
|---|---|---|---|
| Android | Play Integrity: Play-recognised, licensed, our nonce | Play Billing, Play Developer API, RTDN | Android |
| iOS | `AppTransaction`, signed by Apple | StoreKit 2 transactions + Server Notifications V2 | iOS |
| Steam | `CheckAppOwnership` for the account's linked Steam id | Season DLC ownership, until its end date | Steam |

Everything Apple signs is verified against Apple Root CA - G3 (pinned in
`apps/play/src/billing/appstore.ts`). The store apps prove ownership by themselves
before going online and at least every 30 days; the player sees nothing unless the
store says no.

## App Store (iOS)

1. **App Store Connect → the app → Monetization → Subscriptions**: one group, products
   `ozymandosis.membership.monthly` ($2, 1 month) and `ozymandosis.membership.annual`
   ($12, 1 year). Different ids go in `APPSTORE_PRODUCT_MONTHLY` / `_ANNUAL`.
2. **App Information → App Store Server Notifications**: version 2, production and
   sandbox URL `https://play.ozymandosis.com/api/billing/appstore/notify`.
3. The app's price: tier for $1.
4. **Sign in with Apple** configured on the service (`APPLE_*`, docs/DEPLOY.md). On iOS
   the game hides Google and Steam sign-in unless Apple sign-in is offered (guideline 4.8).
5. Account deletion is in the game (Settings → Delete account) and on the account page
   (guideline 5.1.1(v)); the dialog reminds a member to cancel in the App Store.
6. TestFlight review builds make sandbox purchases: set `APPSTORE_ALLOW_SANDBOX=true`
   on the server that review uses (never needed in development or tests).
7. Build in Xcode (`npm run ios:open`); `LanPlugin.swift` and `StoreKitPlugin.swift`
   are app-target plugins registered in `MainViewController.swift`. The StoreKit
   capability (In-App Purchase) must be on for the target. Not compiled in CI (no Xcode).

## Steam

1. The game's app id in `STEAM_APP_ID`; a **publisher** Web API key in `STEAM_API_KEY`
   (the partner API answers ownership only with a publisher key).
2. Each year's season is a DLC at $12. List them with their end dates:
   `STEAM_SEASONS=[{"appid": 1234560, "until": "2027-10-01T00:00:00Z"}]`. The game's
   membership offer opens the current season's store page.
3. Steam players sign in with Steam (or link it on the account page): ownership is
   checked for the linked Steam id.
4. The desktop shell is the Steam build when launched by Steam (or with
   `steam_appid.txt` beside it); a build that is neither cannot play online in production.
