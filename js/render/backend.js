// SPDX-License-Identifier: AGPL-3.0-only
// Renderer selection. Backends share one interface:
//   resize(), reset(view, local), frame(view, alpha, t, dt, ui), consume(view, events),
//   s2w/w2s, cam {x,y,z}, clampCam(view), seen(x,y), explore(x,y), quality, kind
// 'webgpu' (three WebGPURenderer, where navigator.gpu exists) → 'webgl2' (three
// WebGLRenderer, instanced batches) → 'canvas2d' (the original immediate-mode renderer).
(function (E) {
  'use strict';
  E.hasWebGL2 = function () {
    if (E._gl2 !== undefined) return E._gl2;
    try { const c = document.createElement('canvas'); E._gl2 = !!(window.WebGL2RenderingContext && c.getContext('webgl2')); } catch (e) { E._gl2 = false; }
    return E._gl2;
  };
  E.softwareGL = function () {
    if (E._sw !== undefined) return E._sw;
    try { const g = document.createElement('canvas').getContext('webgl2'), x = g && g.getExtension('WEBGL_debug_renderer_info'); E._sw = !!(x && /swiftshader|llvmpipe|software/i.test(g.getParameter(x.UNMASKED_RENDERER_WEBGL))); } catch (e) { E._sw = false; }
    return E._sw;
  };
  E.hasWebGPU = () => !!(navigator.gpu && window.THREE_GPU);
  // The WebGPU build of three is ~1 MB and only needed when that backend is chosen,
  // so it is loaded on demand (from the vendored file; works offline and from file://).
  E.loadWebGPU = function () {
    if (window.THREE_GPU) return Promise.resolve(true);
    if (!navigator.gpu) return Promise.resolve(false);
    if (E._gpuP) return E._gpuP;
    E._gpuP = new Promise(res => {
      const s = document.createElement('script'); s.src = 'vendor/three.webgpu.min.js';
      s.onload = () => res(!!window.THREE_GPU); s.onerror = () => res(false);
      document.head.appendChild(s);
    });
    return E._gpuP;
  };
  E.resolveBackend = function (want) {
    if (want === 'canvas2d') return 'canvas2d';
    if (want === 'webgpu' && E.hasWebGPU() && E.GPURenderer) return 'webgpu';
    // Software GL (SwiftShader/llvmpipe) is far slower than Canvas2D for our full-screen passes; auto picks Canvas2D there.
    if (want === 'auto' && E.softwareGL()) return 'canvas2d';
    if (window.THREE && E.GLRenderer && E.hasWebGL2()) return 'webgl2';
    return 'canvas2d';
  };
  E.createRenderer = function (canvas, want, opts) {
    const kind = E.resolveBackend(want || 'auto');
    let r;
    if (kind === 'webgpu') r = new E.GPURenderer(canvas, opts);
    else if (kind === 'webgl2') r = new E.GLRenderer(canvas, opts);
    else { r = new E.Renderer(canvas); r.kind = 'canvas2d'; }
    if (opts && opts.quality) r.quality = opts.quality;
    return r;
  };
})(window.E);
