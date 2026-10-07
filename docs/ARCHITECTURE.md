# Architecture

Ozymandosis is plain browser scripts on one global namespace `E`. There is no bundler, so the same files run from `file://`, from any static host, as an offline PWA, inside the Capacitor native shell, and in Node for tests.

```
             commands (humans, bots, remote guests)
                         │
   ┌─────────────────────▼─────────────────────┐
   │  World (js/sim)  deterministic, fixed 30 Hz│  serializable state `w.s`
   │  rules · mapgen · AI personas · objectives │──► saves / autosave / rematch
   └───────┬───────────────────────────┬────────┘
           │ read-only state + events  │ snapshots (8 Hz, js/net)
   ┌───────▼────────┐          ┌────────▼────────┐
   │ Renderer (core)│          │ Relay server    │ zero-dep WebSocket rooms
   │ camera · vision│          │ (server/)       │
   │ fx · damage #s │          └─────────────────┘
   └───┬─────┬──────┘
 webgpu│webgl2│canvas2d   ← E.createRenderer picks; one interface
   ┌───▼─────▼──────────────────────────────┐
   │ three.js batched pipeline (js/render/gl,│  6 draw calls/frame
   │ js/render/gpu) · Canvas2D fallback      │
   └─────────────────────────────────────────┘
   UI (js/ui): menus, lobby, HUD/sheet, forge, tech, codex, governor
```

## Layers
| Layer | Files | Rule |
|---|---|---|
| Seed | `js/core/seed.js` | The original Dreamscape pack, kept verbatim. It drives the menu backdrop and the form-1 organs. |
| Content | `js/data/*` | 30 organs (renderers + stats), 6 chassis, 36 specials, the tech tree, 6 cultures. Pure data plus drawing functions. |
| Simulation | `js/sim/*` | Deterministic and serializable. It never touches the DOM or `Math.random` (it uses `w.rand`). The only input is `world.command(player, cmd)`. |
| Render core | `js/render/core.js` | Camera, vision grid (32 px cells, binary for rules plus soft channels for display), explored memory, events → effects, damage numbers. |
| Backends | `js/render/gl/*`, `js/render/gpu/*`, `js/render/renderer.js` | WebGL2 (GLSL), WebGPU (TSL node materials) and Canvas2D, all behind the same interface. |
| UI | `js/ui/*` | DOM overlays. It reads world state and sends commands. |
| Net | `js/net/net.js`, `server/server.js` | Host-authoritative: the host runs the World, guests interpolate snapshots and send commands. |
| Native | `js/native.js`, `android/`, `ios/`, `capacitor.config.json` | A no-op on the web. |

## The GPU pipeline (js/render/gl)
- **RibbonBatch**: one instanced capsule per spine segment. The fragment shader reproduces the seed's three-layer stroke (outer 10·size at α .1, mid, whitened core). MAX blending stops joints from doubling up.
- **SpriteBatch**: atlas sprites that cross-fade between frames. The atlas (`atlas.js`) bakes every organ × 4 tiers × 8 frames plus chassis decor, petals, shape markers and powerup glyphs, using the original Canvas2D drawing code. Colors are channel-encoded (R = body, G = accent, B = white), so one bake tints for every culture and every fever or blight state.
- **GlowBatch**: SDF quads for soft and hot glows, rings, arcs, dashed rings, discs, bars, hexagons and dark clouds. Everything is premultiplied.
- **Background pass**: abyss gradient, caustics that brighten near lumen pools (light shows where the food is), current streaks that flow along the real current field, parallax dust.
- **Fog pass**: samples an RG texture with soft vision and explored memory, rebuilt only when vision changes (every 0.1 s).
- Per frame, the CPU writes typed instance arrays directly from sim state. Trails are ring buffers and the spine is one shared scratch buffer, so nothing is allocated per creature.
- Text (damage numbers, labels) and the selection box go on a small 2D overlay canvas.

## Determinism contract
The sim's inputs are the config, the seed and the command stream. Pending commands are part of the saved state, so a save taken between ticks resumes identically (tested). Personas, objectives, counters and currents are all inside the sim. Cosmetic systems (progression, palette-tinted HUD, audio) live outside it and never feed back.

## Living structures (js/render/anatomy.js)
`E.drawStructure(D, renderer, view, b, pal, t)` draws a Nucleus, Bud or Spire as an organism through a small adapter `D` (`glow`, `glowTop`, `seg`, `poly`, `organ`). The GL backend maps it onto the batches (ribbons, glows, atlas organ sprites); `E.canvasStructAdapter` maps it onto Canvas2D strokes and the organ drawers. A per-individual **genome** (seeded by structure id and culture) fixes the silhouette harmonics, fused lobes, heart offset, rim organ order and sizes, and the culture signature. Renderer-only state (hurt flinch, aim easing, spire recoil from `spire` events) lives in `renderer.structVis`, never in the sim. Rim organs use the colony's research tier, so buildings evolve with the creatures. LOD: 0 full, 1 reduced, 2 membrane and heart only.

## The score (js/core/music.js)
A lookahead scheduler (25 ms timer, 160 ms horizon) plays 16th-note steps on the AudioContext clock. State: theme (culture mode, root, tempo, leitmotif seed), chord (Markov chain over scale degrees), section (drift, pulse, break, surge, chosen at 4-bar boundaries from a smoothed intensity), and mood (energy → brightness, fever → detune, drive and tempo). Voices are built per note from oscillators, filters and gains; a kick-driven gain node pumps the synth bus. `musicTick()` in the game computes intensity from engaged creatures, recent alerts and fever.

## Online (js/net, apps/play)
Snapshots are per guest (`E.NetPack.snap`): its own team in full, rivals only where its team can see (plus an edge so creatures glide in), rival economies and research withheld until the match ends, and rarely-changing player fields (designs, organs, research) sent only when they change. Guests keep fog memory of rival structures they have scouted. This makes map hacks pointless and cuts a late 6-player snapshot from ~22 KB to ~8 KB before compression; messages over 1 KB are deflated on the wire (`CompressionStream`, negotiated in the hello), with limits on inflated size and chunk counts. A congested link skips a snapshot round rather than queueing.

Links recover: a wobbling connection gets an ICE restart and 15 s before it counts as gone; a guest that loses the host rejoins by itself (same room, same seat) for 90 s; an online host whose signaling drops reattaches (`op host {resume}`), and the service keeps a started lobby two minutes for it. The match itself cannot move to another player (only the host has the full world); a host that vanishes forfeits.

Guests can verify the host (`js/net/audit.js`): the host records the command stream it applies (`world.rec`) and commits to state hashes every 600 ticks; bot takeovers go through the host-only `seat` command so a replay reproduces them. Anything that changes the world during an online match must be a command, or the audit will flag it.

- **Transport**: `E.Relay` keeps its original API but carries every game message over WebRTC DataChannels (host↔guest star, chunked framing, snapshot back-pressure). The WebSocket only negotiates offers, answers and ICE candidates. A match survives losing the signaling server.
- **Signaling servers**: `server/server.js` for LAN rooms; `apps/play` for accounts, lobbies, quick match, TURN credentials and match tickets (same `host`/`join`/`signal` protocol plus extras). See `docs/PLAY-SERVICE.md`.
- **Tickets**: on start the service signs (Ed25519) the list of players with each free player's deadline; clients verify it with WebCrypto and enforce it on each other.
