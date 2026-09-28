# Delivery summary: requirements → implementation

Evidence commands: `npm test` (52 sim/content tests), `npm run test:ui` (smoke, touch, flow, features, multiplayer), `npm run test:perf` (budget gate), `npm run bench` (results in `bench/results/`).

## 1. GPU port and performance
| Requirement | Done | Where |
|---|---|---|
| three.js batched, instanced 2D pipeline | ✅ Ribbon, sprite and glow instanced batches, plus background and fog passes; 6 draw calls per frame | `js/render/gl/*` |
| Atlases for 6 chassis + 30 organs + effects | ✅ Baked at startup from the original draw code: 30 × 4 tiers × 8 frames, plus decor, petals, markers and glyphs | `js/render/gl/atlas.js` |
| Custom shader glow, efficient fog, cached minimap | ✅ SDF glow kinds; fog from a soft-vision RG texture; minimap with terrain, fog (ImageData) and dynamic layers | `batches.js`, `minimap.js` |
| WebGL2 + WebGPU path + Canvas2D fallback | ✅ WebGPU through TSL node materials (verified on an RX 590 adapter); Canvas2D picked automatically on software GL or no WebGL2 | `backend.js`, `gpu/gpurenderer.js` |
| Repeatable benchmark on the host GPU, before and after | ✅ ANGLE/Vulkan harness. At 700 creatures: **6.9 → 125 fps**, p95 289 → 10.9 ms | `bench/`, `docs/PERFORMANCE.md` |
| 60 fps contract: budget, tiers, caps | ✅ Governor, 4 tiers, detail budget, hard fx/text/corpse caps, population-cap option, regression gate | `js/ui/perf.js`, `bench/budget.json` |
| Hotspots removed | ✅ No per-unit allocation in the GL path, no gradients or rgba strings in hot loops, minimap fog cached, backdrop capped at 30 fps and stopped in game, autosave on idle | |
| Mobile 30+ fps | ⚠️ Emulated (390×844@3×, 4× CPU throttle): 35–58 fps at 200–400 creatures. **Not measured on real phones.** The emulation throttles CPU only; the GPU is still the desktop card. | `bench/results/after-mobile.json` |

## 2. Web + mobile distribution
| Requirement | Done |
|---|---|
| Installable offline PWA | ✅ Generated precaching service worker, manifest with PNG and maskable icons, self-hosted fonts; `npm run build` → `www/` |
| Android app | ✅ Capacitor 6 project; `npm run android:apk` builds `dist/efflorescent-debug.apk`; installed and played on an Android 14 emulator (menu, setup and tutorial gameplay under WebGL2) |
| iOS app | ⚠️ The Xcode project is generated and synced (`ios/`). **Blocker: building needs macOS with Xcode and CocoaPods, which this Linux host doesn't have.** Run `npm run ios:open` on a Mac. |
| Touch parity, safe areas, notch | ✅ Touch gesture tests; `env(safe-area-inset-*)` on web and iOS; dark status band on Android (the WebView reports a zero inset when overlaid); Android back button; app-background autosave and pause |

## 3. Art direction
✅ The HUD is built as membranes tinted live by the colony palette (the same `E.playerPalette` the renderer uses), so fever, starvation and blight show in the UI. Cilia edges beat faster with colony activity. Resources are vesicle chips, buttons are polyps, and the minimap is a lens. Command icons are drawn from the organ art itself. Caustics concentrate on lumen pools, and current streaks follow the real flow field with brightness showing strength. Each culture has its own musical scale for hatch and research chimes, and the ambient pad follows energy and fever.

## 4. Gameplay and immersion
| Gap | Done |
|---|---|
| Feedback | ✅ Damage and heal numbers (observed hp deltas, so they work for network guests too), a batched kill feed, off-screen threat arrows you can tap to jump |
| Objectives | ✅ Annihilation, Heartfall (nucleus), Hold the Tide (great caustics), Luminance (gather race); objective HUD; bots play the objective |
| Orders | ✅ Shift or Queue-mode waypoints (up to 12), patrol, drawn order paths, Stop clears the queue |
| Meaningful currents | ✅ Riding the flow speeds creatures up to ×1.4 and fighting it slows them to ×0.75; vortex cores cut damage by 15%; Tidecall adds a temporary vortex |
| Meta-progression and rematch | ✅ Lineage XP, levels and titles; 16 achievements that unlock Forge designs; Rematch and New Dreamscape buttons, including for multiplayer hosts |
| Bot variety | ✅ Five personalities (Swarm, Bloom-farmer, Reef-builder, Raider with harassment squads, Evolver) independent of difficulty |
| Legible counters | ✅ Tide Wheel applied as damage (+12% / −8%), shown on every culture row in setup and in the codex |
| Onboarding | ✅ Tutorial mode with a passive rival released by the guide, plus the first-game guide and the codex |

## 5. Mobile UX and accessibility
✅ A culture shape marker (circle, triangle, square, diamond, hexagon, star) under every creature, on structures and on the minimap (setting: auto, always or off). Undo button for 4 s after any order, and Ctrl+Z. Touch build placement is two-step (preview, then Confirm) and spends nothing on the first tap. Orientation setting uses the native lock in the app and the Screen Orientation API on the web; rotation triggers a relayout. No text below 11 px on coarse pointers, and keyboard hints are hidden. Music, effects and mute controls are in the pause menu and the HUD.

## 6. Quality bar
✅ Tests expanded (queue/patrol/restore, modes, counters, persona determinism, features suite, perf gate), all green. Deterministic save/load re-verified. The multiplayer test covers lobby, guest commands, pause, drop-to-bot and rejoin, with snapshots carrying queues and objectives. Docs: `ARCHITECTURE.md`, `DECISIONS.md`, `PERFORMANCE.md`, this file.

## Known limits
- Real-device phone performance is unmeasured; the emulator run proves function, not frame rate.
- No iOS binary (see the blocker above).
- The WebGPU bundle carries its own copy of three's core (about 1 MB), loaded only when WebGPU is chosen.
- Balance is tuned on bot-vs-bot games.

---

# Update: Ozymandosis (renamed), online service, living structures, score

| Request | Where it lives |
|---|---|
| Renamed to Ozymandosis | UI, manifest, app ids (`com.ozymandosis.game`), icons and splashes, docs; end titles quote Shelley |
| Right-hand button icons centred and themed | `js/ui/icons.js` (claws, grub, nucleus, helix, egg, conch, tendrils…), `.fab` icon-over-label layout |
| Legible, Verne/Lovecraft type | Atkinson Hyperlegible Next and Mono for text, Cinzel for display (D17) |
| Buildings as living organisms | `js/render/anatomy.js`: asymmetric lobes, heartbeat, veins, rim organs at the colony's tier, culture signatures |
| Desktop fullscreen, WASD | `js/native.js` (first gesture, Alt+Enter/F11, setting), `apps/desktop` (launches fullscreen); WASD with eased panning (D18) |
| Forge → Spawnforge | everywhere |
| Text fit and centring | dock layout (sheet, organ buttons, guide and alerts stack), wrapping command grid, overlay flex fix, phone setup rows, overflow sweep |
| Procedural, moody soundtrack | `js/core/music.js`: Markov harmony, leitmotifs, adaptive sections, synthwave + generative-ambient palette |
| Server in the monorepo | `apps/play` (Fastify, Postgres), `apps/site`, `deploy/` (Caddy, coturn, Postgres, backups) |
| Discovery and matching only; P2P encrypted games | WebRTC DataChannels (D11); LAN and online signaling |
| Accounts: email + TOTP 2FA; Google, Apple, Steam | `apps/play/src/auth` |
| Stripe, $1/month, >15-minute matches | `apps/play/src/billing`, signed tickets enforced by peers (D12) |
| Minimal PII in logs | D16, `docs/PLAY-SERVICE.md` → Privacy |
| Crash and bug reports as reports | `js/core/crash.js`, `/api/reports`, admin → Crashes & bugs |
| ozymandosis.com + www; play.ozymandosis.com | `apps/site`, `deploy/Caddyfile` |
| Moderation, announcements, admin tooling | admin console, sanctions, player reports, live config, audit log, operator CLI, backups, dashboards |

## Known limits
- The time limit is enforced by honest clients (D12).
- Membership is sold on the web; app-store and Steam billing rules need review before store submission (`docs/DEPLOY.md` §5).
- The desktop shell is written but was not launched here (no display); the Steamworks SDK is not yet integrated.
- The soundtrack was checked by recording it in headless Chromium and measuring spectra and levels, not by ear. Tune by listening.
- `@capacitor/cli` 6 pulls a vulnerable `tar` (build tooling only); upgrading Capacitor needs JDK 21 (D7).
- Legal pages are drafts for counsel.

## Follow-up: title screen, promo codes, culture names
| Request | Where it lives |
|---|---|
| Selection box follows the UI palette | both renderers draw it in the colony's live accent |
| Music from launch | audio starts at boot; Android WebView and the desktop shell allow it at once; browsers wake it on the first touch, click or key (with a hint) |
| Quit on the main screen | closes the desktop and Android apps and installed web apps; a farewell screen in a browser tab; hidden on iOS (Apple forbids apps quitting themselves) |
| Persistent, varied title creatures | `js/render/menuscene.js` MenuScene: a fixed school covering every chassis, every organ and every culture; they turn back from beyond the screen edges and steer around the title |
| Tagline removed | |
| The word built from creatures | LivingLogo: letter strokes are creature spines with tapered glowing bodies, chassis textures, and organs from the library as serifs, tails and limbs; heartbeat, breathing, undulation and palette drift. OCR reads it as OZYMANDOSIS in 12 of 12 sampled frames on desktop and phone |
| Culture names | The Slither, The Choir, The Seethe, The Bloom (ids unchanged, so saves and settings still load) |
| Promo codes | `apps/play/src/billing/promo.ts`, admin → Promo codes, portal and game redemption |
| Identity: Google, Apple, Steam, email | Discord and GitHub removed |

## Follow-up: living title everywhere, Begin, beta
| Request | Where it lives |
|---|---|
| The living title wherever the name is shown publicly | game title and farewell screen; website hero and navigation on every page; account portal; concept document (`title.html` in an iframe); emails and native splash screens get a rendered still (`tools/render-title.cjs`). Pages outside the game load `living-logo.js`, bundled from the game's own code by `tools/living-logo.cjs` (26 KB gzipped); it pauses off-screen and shows one still frame for reduced-motion users |
| "Begin the bloom" → "Begin" | setup screen (skirmish and lobbies) |
| Beta | badge beside every living title; notice banner on the website and the portal; badge in the admin console; beta clause in the terms; "BETA" in emails |

## Follow-up: healing, wounds and roles
| Request | Where it lives |
|---|---|
| Creatures heal slowly after damage | `E.MEND` in `js/sim/world.js`: 1% of health per second once 5 s out of combat |
| Return to the nucleus to heal fast, for lumen | beside an own Nucleus or Bud: 12% per second at 0.25 lumen per point; **Mend** order (button, N) sends the selection home and releases it when whole |
| Buildings heal slowly | 0.4% per second once 8 s unhit |
| Grisly fighting: pieces come off and regrow | `js/render/gore.js`: organs tear away at seeded damage thresholds and tumble off as real organ pieces; tails wear down and drift away; everything buds back as health returns; deaths break into chunks and loose organs |
| Residue, not red blood | ichor, glowing motes and fading stains in each culture's own colours, from creatures and struck structures |
| Tell gatherers from fighters | gatherers: pale, slimmer, a translucent harvest sac that fills with cargo; fighters: dark war plates, chevron armour bands, spikes and a spiked crown. Shown in play, on hatch cards, in the Spawnforge and on the title screen |

## Follow-up: the three-month list

Everything from the "what will bite us" review, fixed in code or handed over as a checklist:

| Risk | Now |
|---|---|
| TURN certificate expiring silently | `deploy/turn.sh` reloads coturn when Caddy renews (tested with a real renewal), and copies the root-only key for the unprivileged coturn user |
| Disk filling | Docker log rotation on every container; hourly retention sweep (`retention.ts`) with the periods published in the privacy page; disk alerts |
| Google Play target SDK | Capacitor 8, Android API 36, JDK 21, edge-to-edge insets; iOS 15 |
| Mixed client versions | peer protocol hello on every link; the service pairs only compatible clients |
| Host-reported results | every player reports; only agreement counts; guests audit the host's simulation (commit–reveal of state hashes, re-simulation, own-order checks); disputes go to moderators; anti-boosting limits |
| Bandwidth | per-guest snapshots culled to what the guest can see (also ends map hacks), memoized slow fields, deflate on the wire: a late 6-player snapshot ~22 KB → ~2.6 KB |
| Dropped connections | ICE restart with a grace period, automatic guest rejoin, host signaling resume, abandonment settles as a forfeit |
| Lost progress (Safari eviction) | cloud sync of lineage, designs and saves with versioned merges |
| Chat and children | age gate (13+, only a band stored), server-routed filtered chat, quick chat for under-16s, server-held evidence for reports |
| Tax and fees | Stripe Tax, tax-inclusive prices from Stripe, optional yearly plan; economics in LAUNCH.md |
| Store rules | store builds never sell; the decision on in-app purchase is in LAUNCH.md |
| Single server, no alerts | encrypted off-site backups with restore drills, deploy with backup and automatic rollback, staging, alerts by email/webhook, metrics, key rotation for every secret (OPERATIONS.md) |
| Untested platforms | CI runs Chromium, Firefox and WebKit; real-device and real-provider checks are listed in LAUNCH.md |
| Balance blind spots | culture win rates with confidence intervals and fielded designs in the admin console |
| Legal, trademark, signing, email DNS | checklists in LAUNCH.md |
