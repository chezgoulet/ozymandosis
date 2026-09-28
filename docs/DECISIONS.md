# Decision log

**D1. three.js vendored as IIFE bundles built by esbuild** (`tools/vendor-three.cjs` → `vendor/three.min.js`, `vendor/three.webgpu.min.js`).
Since r160, three ships ES modules only, and modules don't load from `file://`. A one-time vendoring step keeps the game build-free and offline. The bundles are rebuilt after bumping the devDependency.

**D2. A 2D instanced pipeline on raw shaders, not three's scene graph or sprites.**
Creatures are procedural, animated strokes. Baking whole creatures would lose the trail-following bodies that give the seed its character. Instead, bodies stay dynamic (ribbon capsules computed on the CPU and drawn in one instanced call) and only organs and decor are baked. Vertex shaders apply the 2D camera, so there is no per-object matrix work.

**D3. Channel-encoded atlas.** One bake instead of one per culture and palette state. Fever, starvation and blight tint live through uniforms and instance colors, which preserves the seed's "state read by eye".

**D4. WebGL2 is the Auto default; WebGPU is opt-in; Canvas2D is the fallback.**
WebGPU renders identically and performs the same (124 vs 125 fps at 700 creatures), but support is uneven (Safari/iOS). Its bundle is about 1 MB and loads on demand. Auto picks Canvas2D when WebGL is software-rendered (SwiftShader/llvmpipe): measured at 2–5 fps against Canvas2D's 7–46.
TSL If/ElseIf chains produced wrong results in the glow shader, so the TSL materials use branch-free `select` cascades.

**D5. The governor watches rAF gaps, not JS time alone.** GPU cost is only visible in frame intervals. The governor downgrades before a visible stutter (>10% of frames missing) and probes upward with a back-off, so it doesn't oscillate.

**D6. The population cap is a match option, not a runtime governor.** Changing caps mid-match would break determinism and multiplayer parity. The device class suggests a default (desktop 120, phone 90, low-end 60). Runtime scaling happens in the renderer's detail budget instead: only the nearest N creatures get organs.

**D7. Capacitor 6.** One codebase, and web assets are copied as-is. Version 6 matches the host's JDK 17 (7+ needs JDK 21). On Android the WebView reports a zero top safe-area inset under an overlaid status bar, so Android uses a dark status band; iOS overlays and pads with `env(safe-area-inset-*)`.

**D8. Autosave runs in `requestIdleCallback`.** Serialization stays synchronous (the sim state is plain JSON) but is kept out of busy frames. It also saves when the page is hidden or the app is backgrounded.

**D9. Mechanical culture counters (±12/8%)** make the Tide Wheel real without overpowering specialization. They are shown in setup and the codex.

**D10. Meta-progression is cosmetic plus designs.** Achievements unlock titles and preset Forge designs, which any player could build anyway. Multiplayer stays fair.

**D11. Matches are peer to peer; servers only introduce.** WebRTC DataChannels (DTLS) carry all game traffic host↔guest, so neither the LAN server nor play.ozymandosis.com can read or tamper with a match, and server outages don't end matches in progress. TURN (coturn) relays the encrypted traffic. *(Amended by D19: every online match is relayed; LAN matches are direct.)*

**D12. The free allowance is counted by the service; the ticket carries it.** *(Amended 2026-09-28 by `MONETIZATION.md` and D20: the per-match time limit is gone.)* The server cannot see inside a P2P match, but it sees every start, so it counts the free allowance (one match per rolling 24 hours, per account) there, and refuses a free player who has none left before a lobby, a join or a queue. The signed ticket says who is in the match, who is a member and how many free matches each has left: a count, not a deadline, and nothing ends a match early. Quick match makes a member the host when possible. The count is only as good as "the match started", which the host's client reports; that is the gentle nudge MONETIZATION.md open item 1 describes, not DRM.

**D13. Fastify + Postgres, PGlite for development and tests.** The same SQL and migrations run in production Postgres and in an in-process WASM Postgres, so tests need no database server and local development needs no Docker.

**D14. Opaque sessions, never JWTs.** Tokens are random; only their SHA-256 is stored, so revocation (bans, password resets, sign-out-everywhere) is immediate. Game clients use bearer tokens (they run from file://, capacitor://, other origins); the portal uses an HttpOnly SameSite=Lax cookie plus a required custom header on state changes.

**D15. Game clients sign in through the browser by hand-off.** The client keeps a secret verifier and polls with it; the portal (any provider, any 2FA) approves the hash. It works identically on the web, in Capacitor, and in the desktop shell, and no provider needs a custom URL scheme.

**D16. Minimal-PII logging by construction.** The request logger records route, status, time and an HMAC pseudonym of the user id; Pino redacts auth, cookie and address fields; Caddy's access log filter deletes client IPs and sign-in query parameters; coturn logs nothing. Crash reports are scrubbed of emails, IPs, home paths and tokens server-side, and only whitelisted context keys are stored.

**D17. Hyperlegible type, engraved display.** Atkinson Hyperlegible Next/Mono (designed for low-vision readers; distinct letterforms help dyslexic readers) for everything read in play; Cinzel capitals for headings give the Verne/Lovecraft engraved-plate feel without cursive shapes.

**D18. WASD pans the camera.** Abilities moved to Q E R F C V (around the pan keys), attack-move to X and stop to Z, so no command shares a pan key.

**D19. Every cross-network match is relayed; players are not told each other's addresses.**
The peer connection is created with `iceTransportPolicy: 'relay'` unconditionally, so a match always travels through the TURN server and no player can learn another's IP address. This replaces the "Hide my IP address from other players" toggle: that behaviour becomes the only behaviour, and the setting and its switch are removed. Note what does and does not change — WebRTC DataChannels were already encrypted with DTLS in both modes, so this is not about the payload being private; it is about who can see whom. The service already issues coturn REST credentials valid for twelve hours, so the mechanism is in place and the change is small.

Recorded so the consequences are not rediscovered:

- **TURN stops being a fallback for difficult NATs and becomes the path every match takes.** Measured: a 6-player snapshot is about 2.6 KB per guest at 8 Hz, so roughly 104 KB/s per match, about 122 MB across twenty minutes, and about 244 MB counted in both directions. A hundred concurrent matches is therefore about 81 Mbit/s of sustained relay throughput. The **money is small** — between $0.0012 and $0.012 per match depending on the bandwidth rate, against $1.70 net per subscriber-month, so one subscriber's month covers between 143 and 1,428 matches. The **capacity, redundancy and monitoring** are the real cost, not the bandwidth bill: an unreachable TURN server now means no online play at all rather than degraded play.
- **A same-network match is direct, unrelayed, and outside the subscription entirely.** Two devices on one network discover each other and connect directly: no relay, no account, no call to the service. Same-LAN play is a base-game feature and only worldwide online play is gated. This was decided after the entry above was written; it is no longer an open question.
- **Consequence: cleartext for the local signalling hop is now permanent** (see `RELEASE-PLAN.md` Appendix C). Keeping local play serverless means the local signalling transport stays, so the Android cleartext exception and the iOS App Transport Security exception both remain for it. Local traffic on the players' own network, with the match payload still inside DTLS — acceptable, but it should be stated rather than rediscovered.
- **Android gates local networking from API 37, and this is on the critical path.** Local Network Protections are opt-in for apps targeting 36 (the current target) and mandatory for 37, where the local network is blocked by default. The gated operations are exactly this feature: outgoing TCP, accepting incoming TCP, UDP multicast and broadcast, and resolving `.local` names. Joining can avoid the broad permission by using `NsdManager` with `DiscoveryRequest.FLAG_SHOW_PICKER`, where the user picks the device from a system dialog and the grant persists; **hosting always requires `ACCESS_LOCAL_NETWORK`**, because accepting incoming connections does. Build and test the feature under `adb shell am compat enable RESTRICT_LOCAL_NETWORK <package>` now, so the next Play target-API bump does not break it.

**D20. Compliance with the monetization scheme (`MONETIZATION.md`), and how it is read.** Implemented 2026-09-28:

- **The allowance** is server-side (D12): `apps/play/src/billing/allowance.ts`, live-configurable as `freeMatchesPerDay` (was `freeMatchMinutes`). Counted once per player per match, at the start, whichever side; a rejoin is not counted again; members are never counted; LAN never reaches the service.
- **No browser version**: the site no longer serves the client (`/play/` redirects to the platforms), and in production (`REQUIRE_STORE_CLIENT`, on by default there) the service lets only the store apps online: `android`, `ios`, `steam`. A browser or a non-Steam desktop build gets "online play is in the app".
- **The $1 purchase is bound to the account, per platform, verified with the store** (`ownership.ts`): Play Integrity (Play-recognised and licensed) on Android, `AppTransaction` signed by Apple on iOS, `CheckAppOwnership` for the linked Steam id on Steam. A store app goes online only with a proof for its own platform, renewed at least every 30 days (so refunds take effect).
- **Subscriptions are per platform** and each is validated with its store: Play Billing (`play.ts`), StoreKit 2 + App Store Server Notifications (`appstore.ts`, JWS pinned to Apple Root CA G3), and the Steam season as DLC ownership with an end date (`STEAM_SEASONS`). A row carries its platform and counts only there. iOS and Android sell $2/month and $12/year; Steam sells a $12 yearly season. Prices shown come from the stores.
- **How it was read, where the scheme is silent:**
  - *Web checkout (Stripe)* is not in the scheme — there is no platform for a web subscription to belong to — so it is **off** (`WEB_BILLING=false`); the code stays for an operator who decides otherwise. Rows created by Stripe before this change keep working as they did (none existed in production).
  - *Promo codes and staff gifts* are comps, not purchases, and remain platform-less (honoured everywhere). If that should change, give `promo.ts` rows a platform.
  - *iOS* also gets in-app account deletion (Settings → Delete account) and hides third-party sign-in unless Sign in with Apple is offered (guideline 4.8).
