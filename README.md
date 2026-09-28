# Ozymandosis

A real-time strategy game of bioluminescent evolution, grown from the *Bioluminescent Dreamscape* visualizer.
You tend a glowing culture: you harvest drifting light, evolve organs and body plans, and send living swarms against rival cultures. The whole colony's condition shows in its color.

## Play

| How | Command | Notes |
|---|---|---|
| Single player | open `index.html` in a browser | Works from `file://`. No build step. three.js is vendored in `vendor/`. |
| Local network | `npm start`, then open http://localhost:8080 | Zero-dependency LAN server (Node 18+). It only introduces players; matches run peer to peer over WebRTC. |
| Online (development) | `npm run play:dev` in one terminal, `npm start` in another | The play service on :8787 with an embedded Postgres; the game on localhost talks to it automatically. Verification emails appear at http://localhost:8787/api/dev/outbox. |
| Desktop app | `cd apps/desktop && npm install && npm start` | Electron shell that launches fullscreen (base for the Steam build). |
| Install on a phone | open the served URL, then "Add to Home Screen" | Plays offline after the first visit. |

Production (ozymandosis.com, play.ozymandosis.com) is one Docker Compose stack on Linode: see `docs/DEPLOY.md`, then `docs/OPERATIONS.md` (releases, alerts, backups, keys, incidents) and `docs/LAUNCH.md` (what only a person can do before launch).

## Repository

```
index.html, js/, css/, vendor/   the game client (web, PWA, Capacitor, desktop all load these files)
server/server.js                 LAN server: static files + WebRTC signaling
apps/play/                       play.ozymandosis.com: accounts, 2FA, OAuth, Stripe, matchmaking,
                                 signaling, tickets, crash reports, moderation, admin console
apps/site/                       ozymandosis.com: the website; the web client is served at /play/
apps/desktop/                    Electron shell (installed separately)
deploy/                          Compose stack: Caddy (TLS), play, Postgres, coturn (TURN), backups
android/, ios/                   Capacitor projects
```

## Rendering and platforms
- **three.js GPU renderer:** instanced batches, a baked organ atlas and shader caustics, currents and fog. WebGL2 by default, WebGPU optional, Canvas2D fallback. A frame-budget governor holds 60 fps. At 700 creatures it runs 125 fps versus 7 fps on the old renderer (`docs/PERFORMANCE.md`).
- **Installable PWA:** `npm run build` → `www/`.
- **Android:** `npm run android:apk`.
- **iOS:** `npm run ios:open` on a Mac (Capacitor 6).
- **Docs:** `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/PLAY-SERVICE.md` (online design, security and privacy), `docs/DEPLOY.md`, `docs/OPERATIONS.md`, `docs/LAUNCH.md`, and `docs/DELIVERY.md` (requirement-by-requirement summaries).

## What's in the game

- **Six cultures**, one for each of the seed's color sets. Each has a rule that changes play: Verdant harvest faster, Luminants research faster, Slither move faster, Choir are unseen and ambush, Seethe convert kills, Bloom are cheap swarms that live 90 seconds.
- **Six chassis**: Serpent, Carapace, Ctenophore, Medusa, Siphonophore, Nautiloid (plus the Leviathan apex). Each has its own body renderer, stats, slot count and trait.
- **Thirty organs**: 5 classes (legs, flagella, pili, mandibles, antennae) × 6 forms. Each has its own renderer, stats and passive, and each class grows through four research tiers.
- **Twelve unit abilities** granted by organs or chassis: Jet Dash, Ink Cloud, Dazzle, Camouflage, Spit Volley, Venom Burst, Harden, Tentacle Lash, War Song, Mend Spores, Tether Drain, Bud Split. All auto-cast by default, and you can toggle each one.
- **Twelve colony powers** on the tech tree: Frenzy, Lumen Flare, Tidecall, Spore Bloom, Apex Spawn, Mitosis, Chitin Weave, Deep Roots, Symbiosis, Hive Mind, Abyssal Hunger, Metamorphosis.
- **Twelve powerups** that spawn at hydrothermal vents.
- **The Spawnforge**: design your own creatures, save them to a library, and hatch them in any match once their parts are evolved.
- **Maps** generated from a seed: Tidepool 2400², Lagoon 3600×2400, Reef 4800×3200, Abyss 6400×4200. Also configurable: 2–6 cultures, teams or free-for-all, resource richness, powerup frequency, starting lumen, fog of war, ocean currents.
- **Bots** at four difficulty levels (Gentle, Tidal, Abyssal, Leviathan). They expand, research, design creatures, raid, defend, and use powers.
- **Multiplayer**: humans and bots in any mix, host-authoritative, with lobbies, room codes, chat and pause sync. Matches run peer to peer over encrypted WebRTC DataChannels; servers only introduce players. Online: accounts, rated quick match (duel, 4-player FFA), a public lobby browser, and a $1/month membership that lifts the 15-minute limit on online matches. If a player drops, a bot takes over their colony until they rejoin.
- **Wounds and healing**: creatures shed organs and tail as they are hurt, spraying residue in their culture's colours, and regrow as they heal: slowly on their own, fast (for lumen) beside a Nucleus or Bud via the Mend order. Gatherers (pale, with a harvest sac) and fighters (plated and spiked) are easy to tell apart.
- **Living structures**: every Nucleus, Bud and Spire is an asymmetric organism with a heartbeat, veins and rim organs at your research tier, plus a culture signature (roots, nautilus shell, flagella vortex, song rings, toothed maw, carapace and egg sacs).
- **A generative score**: composed live in each culture's mode, from ambient drift to a pumping synth surge as fighting grows.
- **Saves**: autosave every 45s and whenever the page is hidden, so you can **Continue** after a reload. There are eight named slots, and saves can be exported and imported as JSON. A multiplayer save can be resumed as a new hosted game.
- **Veterancy, fever, fog of war, expansion Buds, defensive Spires, research lanes, procedural audio, adaptive quality, and a first-game guide.**

## Controls

**Touch**
- **Tap:** select. **Tap the ground** with creatures selected to send them there.
- **Drag:** pan. **Pinch:** zoom.
- **Long-press then drag:** box-select. **Double-tap:** select every creature of that design on screen.

**Mouse and keyboard**
- **Left-click/drag:** select. **Right-click:** smart command.
- **Wheel:** zoom. **W A S D, arrow keys, middle-drag or screen edges:** pan (Shift pans faster).
- **X / M / Z / H / P:** attack-move, move, stop, hold, patrol.
- **Q E R F C V:** abilities. **B:** build. **T:** evolve. **G:** Spawnforge.
- **Alt+Enter / F11:** fullscreen (desktop starts fullscreen on the first click; turn it off in Settings).
- **F1:** idle foragers. **F2:** army. **Space:** home or last alert.
- **Ctrl+0–9:** set a control group. **0–9:** recall a group, or hatch when a hatchery is selected.
- **Enter:** chat. **Esc:** cancel or open the menu.

The in-game **Codex** documents everything.

## Architecture

Plain browser scripts (no bundler) sharing one `E` namespace, so the game runs from `file://` and loads in Node for tests.

```
js/core/seed.js      the original Dreamscape pack, verbatim (drives the menu backdrop; its organ renderers are the form-1 organs)
js/core/util.js      math, seeded RNG, spatial grid
js/data/*            organs (30 renderers), chassis (6 bodies), specials (36 effects), techs + cultures
js/sim/*             World: deterministic, fixed 30 Hz, fully serializable; mapgen; bot AI; stats
js/render/*          palettes/creature drawing, world renderer (camera, fog, fx), minimap
js/render/anatomy.js living structures (one drawer, adapters for GPU and Canvas2D)
js/core/music.js     the generative score; audio.js holds the synthesized effects
js/net/net.js        peer-to-peer transport (WebRTC DataChannels) + snapshot packing
js/net/online.js     account, lobbies, quick match, tickets, reports (play service client)
js/core/crash.js     crash reports and the bug report dialog
js/ui/*              menus, lobby, game controller (input/HUD/sheet), forge, tech tree, codex
server/server.js     static files + WebRTC signaling for LAN play (RFC 6455, no dependencies)
```

- **Simulation and rendering are separate.** The world holds positions, orders and rules. The trailing bodies are visual state owned by the renderer, so the simulation stays small and serializable.
- **Commands** are the only way to change the world. Humans, bots and remote players all go through `world.command()`.
- **Multiplayer**: the host runs the world and streams compact snapshots at 8 Hz over a DataChannel to each guest. Guests interpolate between snapshots and send commands back.

## Tests

```
npm test          # simulation: content counts, mapgen, deterministic save/load, bot games on every map size,
                  # and every ability/power/powerup/organ has an observable effect
npm run test:perf # frame-budget regression gate on the host GPU (bench/budget.json)
npm run play:test # play service: auth, 2FA, hand-off, OAuth, lobbies, tickets, quick match, Stripe webhooks,
                  # reports, moderation, announcements, config, static pages (in-memory Postgres)
npm run test:ui   # browser: features (backends, governor, undo, touch build confirm, tutorial, rematch), menus and a full match, touch gestures and reload→continue,
                  # two-browser multiplayer over WebRTC (lobby, commands, pause, drop→bot, rejoin), and online
                  # end to end (sign-up, lobby browser, join, signed tickets, reports, free time limit)
```

The browser tests use Playwright-core with a local Chromium (`PW=/path/to/playwright-core` to point elsewhere).

## Credits

The visual language, color sets, organ renderers and palette logic come from the *Bioluminescent Dreamscape* pack of the Phonon visualizer bench. The original concept document is in `docs/concept.html`.
