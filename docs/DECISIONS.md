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
