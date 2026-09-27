# Performance & the 60 fps contract

Benchmark: `npm run bench` (`bench/bench.cjs`). This builds a deterministic scene: 6 cultures, every chassis, max-tier organs, creatures moving in view, and 2 sim steps per frame. Vsync and the frame limiter are off, so the frame interval shows real throughput. Results are committed in `bench/results/`.
Host: AMD RX 590 via ANGLE/Vulkan (`--use-angle=vulkan --enable-features=Vulkan`; `VulkanFromANGLE` breaks WebGL).

## Before → after (desktop, 1440×900, real GPU)
| creatures | Canvas2D (before) fps / p95 | WebGL2 (after) fps / p95 | WebGPU fps / p95 |
|---|---|---|---|
| 50 | 68 / 42 ms | 595 / 3.4 ms | 671 / 2.6 ms |
| 100 | 36 / 60 ms | 444 / 3.7 ms | 446 / 3.6 ms |
| 200 | 18 / 124 ms | 291 / 5.2 ms | 285 / 5.2 ms |
| 400 | 8 / 298 ms | 180 / 7.3 ms | 182 / 7.3 ms |
| 700 | 7 / 289 ms | 125 / 10.9 ms | 124 / 10.6 ms |

## Mobile emulation (390×844 @3×, CPU throttled 4×)
WebGL2 medium/low tiers: about 100 fps at 100 creatures, 57 at 200, 35 at 400. Canvas2D manages 23 / 13 / 8. This emulates the CPU side only; the GPU is still the desktop card, so real-phone numbers are unverified.

## Software GL (no GPU)
WebGL2 on SwiftShader drops to 2–5 fps, so Auto selects Canvas2D when the GL renderer is software (`E.softwareGL`).

## Contract
- **Budget:** 16.7 ms per frame. On the reference desktop, 700 creatures at p95 10.9 ms (65% of budget). JS per frame is about 3.3 ms of render plus sim.
- **Governor** (`js/ui/perf.js`): drops one tier when more than 10% of frames exceed 1.25× budget over about 2 s. It probes one tier up after 8 s clean with JS under 45% of budget, and reverts with a 60 s back-off if the probe misses.
- **Tiers** (`E.GL_TIERS`): ultra, high, medium, low. They set DPR, caustics, pool-focus count, organ-detail budget (400 / 260 / 140 / 60 creatures), body segments, wake glows and atlas resolution.
- **Hard caps:** fx ≤ 400, corpses ≤ 60, floating texts ≤ 80, population cap per culture (setup option 60–150; the default comes from the device class).
- **Regression check:** `npm run test:perf` fails if results exceed `bench/budget.json`.
