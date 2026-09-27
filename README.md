# Efflorescent

A real-time strategy game of bioluminescent evolution, grown from the *Bioluminescent Dreamscape* visualizer.
You tend a glowing culture: you harvest drifting light, evolve organs and body plans, and send living swarms against rival cultures. The whole colony's condition shows in its color.

## Play

| How | Command | Notes |
|---|---|---|
| Single player | open `index.html` in a browser | Works from `file://`. No build step. three.js is vendored in `vendor/`. |
| Everything, including multiplayer | `npm start`, then open http://localhost:8080 | Zero-dependency Node server (Node 18+). Friends on your network use the LAN address it prints. |
| Install on a phone | open the served URL, then "Add to Home Screen" | Plays offline after the first visit. |

`PORT` and `HOST` environment variables override the server defaults. To play over the internet, run the server on any reachable host (or behind a TLS proxy; the client uses `wss://` automatically on https).

## Rendering and platforms
- **three.js GPU renderer:** instanced batches, a baked organ atlas and shader caustics, currents and fog. WebGL2 by default, WebGPU optional, Canvas2D fallback. A frame-budget governor holds 60 fps. At 700 creatures it runs 125 fps versus 7 fps on the old renderer (`docs/PERFORMANCE.md`).
- **Installable PWA:** `npm run build` → `www/`.
- **Android:** `npm run android:apk`.
- **iOS:** `npm run ios:open` on a Mac (Capacitor 6).
- **Docs:** `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, and `docs/DELIVERY.md` (a requirement-by-requirement summary).

## What's in the game

- **Six cultures**, one for each of the seed's color sets. Each has a rule that changes play: Verdant harvest faster, Luminants research faster, Current-born move faster, Deep Choir are unseen and ambush, Umbral Kin convert kills, Bloomtide are cheap swarms that live 90 seconds.
- **Six chassis**: Serpent, Carapace, Ctenophore, Medusa, Siphonophore, Nautiloid (plus the Leviathan apex). Each has its own body renderer, stats, slot count and trait.
- **Thirty organs**: 5 classes (legs, flagella, pili, mandibles, antennae) × 6 forms. Each has its own renderer, stats and passive, and each class grows through four research tiers.
- **Twelve unit abilities** granted by organs or chassis: Jet Dash, Ink Cloud, Dazzle, Camouflage, Spit Volley, Venom Burst, Harden, Tentacle Lash, War Song, Mend Spores, Tether Drain, Bud Split. All auto-cast by default, and you can toggle each one.
- **Twelve colony powers** on the tech tree: Frenzy, Lumen Flare, Tidecall, Spore Bloom, Apex Spawn, Mitosis, Chitin Weave, Deep Roots, Symbiosis, Hive Mind, Abyssal Hunger, Metamorphosis.
- **Twelve powerups** that spawn at hydrothermal vents.
- **The Organism Forge**: design your own creatures, save them to a library, and hatch them in any match once their parts are evolved.
- **Maps** generated from a seed: Tidepool 2400², Lagoon 3600×2400, Reef 4800×3200, Abyss 6400×4200. Also configurable: 2–6 cultures, teams or free-for-all, resource richness, powerup frequency, starting lumen, fog of war, ocean currents.
- **Bots** at four difficulty levels (Gentle, Tidal, Abyssal, Leviathan). They expand, research, design creatures, raid, defend, and use powers.
- **Multiplayer**: humans and bots in any mix, host-authoritative, with a lobby, room codes, chat and pause sync. If a player drops, a bot takes over their colony until they rejoin.
- **Saves**: autosave every 45s and whenever the page is hidden, so you can **Continue** after a reload. There are eight named slots, and saves can be exported and imported as JSON. A multiplayer save can be resumed as a new hosted game.
- **Veterancy, fever, fog of war, expansion Buds, defensive Spires, research lanes, procedural audio, adaptive quality, and a first-game guide.**

## Controls

**Touch**
- **Tap:** select. **Tap the ground** with creatures selected to send them there.
- **Drag:** pan. **Pinch:** zoom.
- **Long-press then drag:** box-select. **Double-tap:** select every creature of that design on screen.

**Mouse and keyboard**
- **Left-click/drag:** select. **Right-click:** smart command.
- **Wheel:** zoom. **Middle-drag, arrow keys or screen edges:** pan.
- **A / M / S / H:** attack-move, move, stop, hold.
- **Q W E R:** abilities. **B:** build. **T:** evolve. **G:** forge.
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
js/net/net.js        relay client + snapshot packing
js/ui/*              menus, lobby, game controller (input/HUD/sheet), forge, tech tree, codex
server/server.js     static files + WebSocket room relay (RFC 6455, no dependencies)
```

- **Simulation and rendering are separate.** The world holds positions, orders and rules. The trailing bodies are visual state owned by the renderer, so the simulation stays small and serializable.
- **Commands** are the only way to change the world. Humans, bots and remote players all go through `world.command()`.
- **Multiplayer**: the host runs the world and streams compact snapshots at 8 Hz. Guests interpolate between snapshots and send commands back.

## Tests

```
npm test          # simulation: content counts, mapgen, deterministic save/load, bot games on every map size,
                  # and every ability/power/powerup/organ has an observable effect
npm run test:perf # frame-budget regression gate on the host GPU (bench/budget.json)
npm run test:ui   # browser: features (backends, governor, undo, touch build confirm, tutorial, rematch), menus and a full match, touch gestures and reload→continue,
                  # two-browser multiplayer (lobby, commands, pause, drop→bot, rejoin)
```

The browser tests use Playwright-core with a local Chromium (`PW=/path/to/playwright-core` to point elsewhere).

## Credits

The visual language, color sets, organ renderers and palette logic come from the *Bioluminescent Dreamscape* pack of the Phonon visualizer bench. The original concept document is in `docs/concept.html`.
