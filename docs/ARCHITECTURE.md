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
