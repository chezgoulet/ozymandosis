// GPU batches for the three.js backend. Everything the world draws goes
// through four instanced pipelines plus two full-screen passes:
//   GlowBatch   — SDF discs/glows/rings/arcs/bars (pools, heads, fx, UI rings)
//   RibbonBatch — capsule segments with the seed's three-layer glow profile
//                 (creature bodies, tentacles, lances, order lines)
//   SpriteBatch — atlas sprites with two-frame cross-fade and channel tinting
//                 (30 organs × 4 tiers, chassis decor, petals, markers, glyphs)
//   Background  — abyss gradient, pool-focused caustics, current streaks, dust
//   Fog         — soft fog-of-war from the vision/explored grid texture
// Coordinates are world units; the vertex shaders apply the 2D camera, so
// there is no scene graph traversal or matrix work per instance.
(function (E) {
  'use strict';
  // Backend descriptor: { ns: THREE | THREE_GPU, mat(name, uniforms, opts) → Material }

  const COMMON_V = `
    uniform vec4 uCam;   // camX, camY, zoom, time
    uniform vec2 uRes;   // CSS px
    vec4 toClip(vec2 w) { vec2 s = (w - uCam.xy) * uCam.z; return vec4(s.x / (uRes.x * 0.5), -s.y / (uRes.y * 0.5), 0.0, 1.0); }`;

  function quadGeometry(THREE) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  }
  const PREMUL = THREE => ({ blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor });

  // Growable interleaved instance buffer.
  class Batch {
    constructor(B, stride, attrs, material, cap) {
      const THREE = B.ns; this.THREE = THREE;
      this.stride = stride; this.attrs = attrs; this.cap = cap || 1024; this.n = 0;
      this.geo = quadGeometry(THREE);
      this.mesh = new THREE.Mesh(this.geo, material);
      this.mesh.frustumCulled = false;
      this.alloc(this.cap);
    }
    alloc(cap) {
      const THREE = this.THREE;
      const old = this.data;
      this.cap = cap; this.data = new Float32Array(cap * this.stride);
      if (old) this.data.set(old.subarray(0, Math.min(old.length, this.data.length)));
      this.buf = new THREE.InstancedInterleavedBuffer(this.data, this.stride, 1); this.buf.setUsage(THREE.DynamicDrawUsage);
      let off = 0;
      for (const [name, size] of this.attrs) { this.geo.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buf, size, off)); off += size; }
    }
    begin() { this.n = 0; }
    slot() { if (this.n >= this.cap) this.alloc(this.cap * 2); return (this.n++) * this.stride; }
    end() {
      this.geo.instanceCount = this.n;
      this.buf.clearUpdateRanges(); this.buf.addUpdateRange(0, this.n * this.stride); this.buf.needsUpdate = true;
      this.mesh.visible = this.n > 0;
    }
  }

  // kind: 0 soft glow, 1 hot glow, 2 ring, 3 arc, 4 disc, 5 bar, 6 hexagon, 7 dashed ring, 8 cloud (dark soft)
  class GlowBatch extends Batch {
    constructor(B, uniforms, order) {
      const mat = B.mat('glow', uniforms, { tex: typeof tex === 'undefined' ? null : tex });
      super(B, 12, [['iA', 4], ['iB', 4], ['iC', 4]], mat, 2048);
      this.mesh.renderOrder = order;
    }
    add(x, y, r, kind, c, a, p0, p1) {
      if (a <= 0.003 || r <= 0) return;
      const o = this.slot(), d = this.data;
      d[o] = x; d[o + 1] = y; d[o + 2] = r; d[o + 3] = kind;
      d[o + 4] = c.r / 255; d[o + 5] = c.g / 255; d[o + 6] = c.b / 255; d[o + 7] = a > 1 ? 1 : a;
      d[o + 8] = p0 || 0; d[o + 9] = p1 || 0; d[o + 10] = 0; d[o + 11] = 0;
    }
  }

  // Capsule segments. profile 0 = creature body (seed three-layer stroke), 1 = soft line, 2 = dashed line.
  class RibbonBatch extends Batch {
    constructor(B, uniforms, order) {
      const mat = B.mat('ribbon', uniforms, { tex: typeof tex === 'undefined' ? null : tex });
      super(B, 12, [['iA', 4], ['iB', 4], ['iC', 4]], mat, 8192);
      this.mesh.renderOrder = order;
    }
    // s: stroke scale (creature size or line half-width), R: quad half-extent
    add(x0, y0, x1, y1, s, R, prof, c, a, widthK) {
      if (a <= 0.003) return;
      const o = this.slot(), d = this.data;
      d[o] = x0; d[o + 1] = y0; d[o + 2] = x1; d[o + 3] = y1;
      d[o + 4] = s; d[o + 5] = R; d[o + 6] = prof; d[o + 7] = widthK === undefined ? 1 : widthK;
      d[o + 8] = c.r / 255; d[o + 9] = c.g / 255; d[o + 10] = c.b / 255; d[o + 11] = a > 1 ? 1 : a;
    }
  }

  class SpriteBatch extends Batch {
    constructor(B, uniforms, tex, order) {
      const mat = B.mat('sprite', uniforms, { tex: typeof tex === 'undefined' ? null : tex });
      super(B, 24, [['iA', 4], ['iB', 4], ['iUa', 4], ['iUb', 4], ['iC0', 4], ['iC1', 4]], mat, 4096);
      this.mesh.renderOrder = order;
    }
    add(x, y, rot, scale, ext, ua, ub, f, body, acc, a, flip) {
      if (a <= 0.003) return;
      const o = this.slot(), d = this.data;
      d[o] = x; d[o + 1] = y; d[o + 2] = rot; d[o + 3] = scale;
      d[o + 4] = ext[0]; d[o + 5] = ext[1];
      if (flip) { d[o + 6] = -ext[2]; d[o + 7] = -ext[3]; } else { d[o + 6] = ext[2]; d[o + 7] = ext[3]; }
      d[o + 8] = ua[0]; d[o + 9] = ua[1]; d[o + 10] = ua[2]; d[o + 11] = ua[3];
      d[o + 12] = ub[0]; d[o + 13] = ub[1]; d[o + 14] = ub[2]; d[o + 15] = ub[3];
      d[o + 16] = body.r / 255; d[o + 17] = body.g / 255; d[o + 18] = body.b / 255; d[o + 19] = a > 1 ? 1 : a;
      d[o + 20] = acc.r / 255; d[o + 21] = acc.g / 255; d[o + 22] = acc.b / 255; d[o + 23] = f;
    }
  }

  // Full-screen passes
  function fullscreen(B, name, uniforms, order, blend) {
    const THREE = B.ns;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const m = new THREE.Mesh(g, B.mat(name, uniforms, { blend })); m.frustumCulled = false; m.renderOrder = order;
    return m;
  }
  const MAX_POOLS = 48, MAX_CUR = 16;
  const BG_FRAG = `precision highp float;
    in vec2 vS; out vec4 o;
    uniform vec4 uCam; uniform vec2 uRes; uniform vec2 uMap;
    uniform vec3 uBgC; uniform vec3 uBg; uniform vec3 uPrim; uniform float uQ;
    uniform vec4 uPools[${MAX_POOLS}]; uniform int uPoolN;
    uniform vec4 uCur[${MAX_CUR}]; uniform vec2 uCurK[${MAX_CUR}]; uniform int uCurN;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float caustic(vec2 p, float t) {
      // interference of travelling waves: a cheap caustic net
      vec2 q = p;
      float c = 0.0;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        q += vec2(sin(q.y * 1.3 + t * 0.7 + fi), cos(q.x * 1.1 - t * 0.6 + fi * 1.7)) * 0.45;
        c += abs(sin(q.x + q.y * 0.6 + t * 0.4)) * abs(cos(q.y - q.x * 0.4 - t * 0.3));
      }
      return pow(1.0 - c / 3.0, 5.0);
    }
    void main() {
      float t = uCam.w;
      vec2 w = uCam.xy + (vS - uRes * 0.5) / uCam.z;
      float rM = length(uRes);
      float gr = length(vS - vec2(uRes.x * 0.5, uRes.y * 0.45)) / (rM * 0.8);
      vec3 col = gr < 0.5 ? mix(uBgC, uBg, gr / 0.5) : mix(uBg, vec3(0.0), clamp((gr - 0.5) / 0.5, 0.0, 1.0));
      col += mix(uPrim, vec3(0.51, 1.0, 0.94), 0.3) * (0.03 + 0.03 * (0.5 + 0.5 * sin(t * 0.7))) * clamp(1.0 - vS.y / (uRes.y * 0.35), 0.0, 1.0);
      bool inMap = w.x >= 0.0 && w.y >= 0.0 && w.x <= uMap.x && w.y <= uMap.y;
      // caustic light gathers where the lumen is: brighter near pools
      float focus = 0.12;
      for (int i = 0; i < ${MAX_POOLS}; i++) {
        if (i >= uPoolN) break;
        vec4 P = uPools[i]; float d = length(w - P.xy) / (abs(P.z) * 3.2);
        focus += (1.0 - smoothstep(0.0, 1.0, d)) * (0.35 + 0.65 * P.w);
      }
      if (uQ > 0.5) {
        float cz = caustic(w * 0.012, t * 0.6);
        col += mix(uPrim, vec3(0.78, 1.0, 1.0), 0.5) * cz * 0.10 * min(focus, 1.6);
      }
      // currents: animated streaks aligned with the flow; brightness shows strength
      vec2 flow = vec2(0.0);
      for (int i = 0; i < ${MAX_CUR}; i++) {
        if (i >= uCurN) break;
        vec4 C = uCur[i]; vec2 dv = w - C.xy; float d = length(dv);
        if (d >= C.z || d < 1.0) continue;
        float k = (1.0 - d / C.z) * min(1.0, d / 60.0);
        if (uCurK[i].x < 0.5) flow += vec2(-dv.y, dv.x) / d * C.w * k;
        else flow += vec2(cos(uCurK[i].y), sin(uCurK[i].y)) * abs(C.w) * k;
      }
      float fm = length(flow);
      if (fm > 1.5) {
        vec2 fd = flow / fm, fn = vec2(-fd.y, fd.x);
        float along = dot(w, fd), across = dot(w, fn);
        float lane = floor(across / 26.0);
        float ph = fract((along - t * fm * 2.2) / 90.0 + hash(vec2(lane, 3.0)));
        float streak = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.08, 0.5, ph)) * step(0.7, hash(vec2(lane, 9.0)));
        float laneMask = 1.0 - abs(fract(across / 26.0) - 0.5) * 2.0;
        col += mix(uPrim, vec3(1.0), 0.45) * streak * smoothstep(0.2, 0.9, laneMask) * clamp(fm / 35.0, 0.0, 1.0) * 0.13;
      }
      // parallax dust
      for (int l = 0; l < 2; l++) {
        float par = l == 0 ? 0.25 : 0.55, sc = l == 0 ? 90.0 : 60.0;
        vec2 p = (vS + uCam.xy * uCam.z * par) / sc; vec2 cell = floor(p), f = fract(p) - 0.5;
        float h = hash(cell + float(l) * 17.0);
        vec2 off = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
        float dd = length(f - off * 0.7 - vec2(sin(t * 0.1 + h * 6.0), cos(t * 0.08 + h * 5.0)) * 0.08);
        col += uPrim * (1.0 - smoothstep(0.0, 0.035 + h * 0.03, dd)) * (0.15 + 0.3 * h) * step(0.55, h);
      }
      if (!inMap) col *= 0.45;
      o = vec4(col, 1.0);
    }`;
  const FOG_FRAG = `precision highp float;
    in vec2 vS; out vec4 o;
    uniform vec4 uCam; uniform vec2 uRes; uniform vec2 uGrid; uniform float uCell; uniform sampler2D uFog;
    void main() {
      vec2 w = uCam.xy + (vS - uRes * 0.5) / uCam.z;
      vec2 uv = w / (uGrid * uCell);
      vec2 f = texture(uFog, uv).rg;
      float vis = smoothstep(0.05, 0.9, f.r), ex = smoothstep(0.02, 0.6, f.g);
      float a = mix(0.93, 0.58, ex) * (1.0 - vis);
      o = vec4(vec3(0.0, 0.012, 0.02) * a, a);
    }`;


  // ── WebGL2 material factory (GLSL ES 3.0 raw shaders) ────────────────
  function webglMat(name, uniforms, opts) {
    const THREE = window.THREE;
    if (name === 'bg' || name === 'fog') {
      const blend = opts && opts.blend;
      return new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, side: THREE.DoubleSide, uniforms, depthTest: false, depthWrite: false, transparent: !!blend, ...(blend ? PREMUL(THREE) : { blending: THREE.NoBlending }),
        vertexShader: `precision highp float; in vec3 position; out vec2 vS; uniform vec2 uRes;
          void main() { vS = (position.xy * 0.5 + 0.5) * uRes; vS.y = uRes.y - vS.y; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: name === 'bg' ? BG_FRAG : FOG_FRAG,
      });
    }
    if (name === 'sprite') uniforms = Object.assign({ uTex: { value: opts.tex } }, uniforms);
      if (name === 'glow') return new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, side: THREE.DoubleSide, uniforms, transparent: true, depthTest: false, depthWrite: false, ...PREMUL(THREE),
        vertexShader: `precision highp float;` + COMMON_V + `
          in vec3 position; in vec4 iA; in vec4 iB; in vec4 iC;
          out vec2 vUv; out vec4 vCol; out vec4 vP; flat out float vKind; out float vR;
          void main() {
            vec2 q = position.xy * 2.0 - 1.0;
            float r = iA.z;
            vUv = q; vCol = iB; vP = iC; vKind = iA.w; vR = r * uCam.z;
            gl_Position = toClip(iA.xy + q * r);
          }`,
        fragmentShader: `precision highp float;
          in vec2 vUv; in vec4 vCol; in vec4 vP; flat in float vKind; in float vR;
          uniform vec4 uCam;
          out vec4 o;
          void main() {
            float d = length(vUv), a = 0.0; vec3 c = vCol.rgb;
            float px = 1.0 / max(vR, 1.0);
            int k = int(vKind + 0.5);
            if (k == 0) { a = d < 1.0 ? (d < 0.5 ? mix(0.5, 0.18, d / 0.5) : mix(0.18, 0.0, (d - 0.5) / 0.5)) : 0.0; }
            else if (k == 1) { a = d < 1.0 ? (d < 0.25 ? mix(1.0, 0.5, d / 0.25) : mix(0.5, 0.0, (d - 0.25) / 0.75)) : 0.0; c = mix(c, vec3(1.0), clamp(0.55 - d * 2.2, 0.0, 0.55)); }
            else if (k == 2 || k == 7 || k == 3) {
              float th = max(vP.x * px, px * 1.2);
              a = 1.0 - smoothstep(th * 0.5 - px, th * 0.5 + px, abs(d - (1.0 - th * 0.5)));
              float ang = atan(vUv.x, -vUv.y) / 6.2831853 + 0.5;
              if (k == 7) a *= step(0.5, fract(ang * vP.y));
              if (k == 3) a *= step(ang, vP.y);
            }
            else if (k == 4) { a = 1.0 - smoothstep(1.0 - px * 1.5, 1.0, d); }
            else if (k == 5) { vec2 u = vUv * 0.5 + 0.5; float h = vP.x; if (abs(vUv.y) > h) a = 0.0; else { a = 1.0; if (u.x > vP.y) c = vec3(0.0); } }
            else if (k == 6) { vec2 p = abs(vUv); float hx = max(p.x * 0.866 + p.y * 0.5, p.y); a = 1.0 - smoothstep(px * 1.5, px * 3.0, abs(hx - 0.85)); }
            else if (k == 8) { a = d < 1.0 ? pow(1.0 - d, 1.6) : 0.0; }
            a *= vCol.a;
            if (a <= 0.002) discard;
            o = vec4(c * a, a);
          }`,
      });
      if (name === 'ribbon') return new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, side: THREE.DoubleSide, uniforms, transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        vertexShader: `precision highp float;` + COMMON_V + `
          in vec3 position; in vec4 iA; in vec4 iB; in vec4 iC;
          out vec2 vW; flat out vec4 vSeg; flat out vec4 vCol; flat out vec4 vP;
          void main() {
            vec2 p0 = iA.xy, p1 = iA.zw; float R = iB.y;
            vec2 d = p1 - p0; float L = length(d); vec2 t = L > 1e-4 ? d / L : vec2(1.0, 0.0); vec2 n = vec2(-t.y, t.x);
            vec2 q = position.xy; float along = mix(-R, L + R, q.x), side = (q.y * 2.0 - 1.0) * R;
            vec2 w = p0 + t * along + n * side;
            vW = w; vSeg = iA; vCol = iC; vP = iB;
            gl_Position = toClip(w);
          }`,
        fragmentShader: `precision highp float;
          in vec2 vW; flat in vec4 vSeg; flat in vec4 vCol; flat in vec4 vP;
          uniform vec4 uCam;
          out vec4 o;
          void main() {
            vec2 p0 = vSeg.xy, p1 = vSeg.zw, pa = vW - p0, ba = p1 - p0;
            float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
            float d = length(pa - ba * h);
            float s = vP.x, px = 1.0 / uCam.z, a; vec3 c = vCol.rgb;
            int prof = int(vP.z + 0.5);
            if (prof == 0) {
              float core = max(0.65 * px, 1.25 * s), mid = 2.6 * s, outer = 5.0 * s * vP.w;
              float aO = 0.1 * (1.0 - smoothstep(outer - px, outer + px, d));
              float aM = 0.32 * (1.0 - smoothstep(mid - px, mid + px, d));
              float aC = 0.85 * (1.0 - smoothstep(core - px * 0.7, core + px * 0.7, d));
              a = aO + aM * (1.0 - 0.1) + aC;
              c = mix(c, mix(c, vec3(1.0), 0.25), aC / max(a, 1e-3));
              a = min(a, 1.0);
            } else {
              float w = s;
              a = 1.0 - smoothstep(w - px, w + px, d);
              if (prof == 2) a *= step(0.5, fract((dot(vW - p0, normalize(ba + 1e-5))) / (10.0 * px)));
            }
            a *= vCol.a;
            if (a <= 0.002) discard;
            o = vec4(c * a, a);
          }`,
      });
      if (name === 'sprite') return new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, side: THREE.DoubleSide, uniforms, transparent: true, depthTest: false, depthWrite: false, ...PREMUL(THREE),
        vertexShader: `precision highp float;` + COMMON_V + `
          in vec3 position; in vec4 iA; in vec4 iB; in vec4 iUa; in vec4 iUb; in vec4 iC0; in vec4 iC1;
          out vec2 vUa; out vec2 vUb; flat out vec4 vC0; flat out vec4 vC1;
          void main() {
            // iA: x, y, rot, scale   iB: l, r, t, b (local extents; b<t flips)
            vec2 q = position.xy;
            vec2 loc = vec2(mix(iB.x, iB.y, q.x), mix(iB.z, iB.w, q.y)) * iA.w;
            float c = cos(iA.z), s = sin(iA.z);
            vec2 w = iA.xy + vec2(c * loc.x - s * loc.y, s * loc.x + c * loc.y);
            vUa = mix(iUa.xy, iUa.zw, q); vUb = mix(iUb.xy, iUb.zw, q);
            vC0 = iC0; vC1 = iC1;
            gl_Position = toClip(w);
          }`,
        fragmentShader: `precision highp float;
          uniform sampler2D uTex;
          in vec2 vUa; in vec2 vUb; flat in vec4 vC0; flat in vec4 vC1;
          out vec4 o;
          void main() {
            vec4 ta = texture(uTex, vUa), tb = texture(uTex, vUb);
            float f = vC1.w;
            vec4 t = mix(ta, tb, f);
            // channel decode: r=body, g=accent, b=white
            vec3 body = vC0.rgb, acc = vC1.rgb;
            vec3 c = t.r * body + t.g * acc + t.b * vec3(1.0);
            float a = t.a * vC0.a;
            if (a <= 0.003) discard;
            o = vec4(c * a, a);
          }`,
      });
    throw new Error('unknown material ' + name);
  }
  E.GL_BACKEND = () => ({ ns: window.THREE, mat: webglMat, kind: 'webgl2' });
  E.GL = { GlowBatch, RibbonBatch, SpriteBatch, fullscreen, BG_FRAG, FOG_FRAG, MAX_POOLS, MAX_CUR, PREMUL };
})(window.E);
