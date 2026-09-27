// WebGPU backend: the same batched pipeline as the WebGL2 backend, driven by
// three's WebGPURenderer with node materials written in TSL. Selected when
// navigator.gpu exists and the player picks WebGPU (or 'auto' prefers it via
// Settings.preferWebGPU). Falls back to WebGL2 if adapter/device creation fails.
(function (E) {
  'use strict';
  const N = () => window.THREE_GPU;

  // Turn plain {value} uniforms into TSL uniform nodes in place, so renderer code
  // that writes `uniforms.x.value = …` keeps working for both backends.
  function nodeUniforms(obj) {
    const L = N().TSL, out = {};
    for (const k in obj) {
      const u = obj[k];
      if (u && u.isNode) { out[k] = u; continue; }
      const v = u.value;
      if (Array.isArray(v)) { const node = L.uniformArray(v, v[0] && v[0].isVector4 ? 'vec4' : 'vec2'); out[k] = { value: v, node }; }
      else if (v && v.isTexture) out[k] = L.texture(v);
      else out[k] = L.uniform(v);
      obj[k] = out[k];
    }
    return out;
  }
  const nd = u => (u && u.node) ? u.node : u;

  function tslMat(name, U, opts) {
    const NS = N(), L = NS.TSL;
    const { Fn, attribute, varying, vec2, vec3, vec4, float, positionGeometry, length, smoothstep, mix, clamp, max, min, abs, step, fract, floor, sin, cos, pow, dot, atan, select, If, Loop, Break, Discard, texture, int } = L;
    const u = nodeUniforms(U);
    const uCam = u.uCam, uRes = u.uRes;
    const toClip = w => { const s = w.sub(uCam.xy).mul(uCam.z); return vec4(s.x.div(uRes.x.mul(0.5)), s.y.negate().div(uRes.y.mul(0.5)), 0.0, 1.0); };
    const m = new NS.MeshBasicNodeMaterial();
    m.side = NS.DoubleSide; m.depthTest = false; m.depthWrite = false; m.transparent = true;
    const premul = () => Object.assign(m, E.GL.PREMUL(NS));
    if (name === 'glow') {
      premul();
      const iA = attribute('iA', 'vec4'), iB = attribute('iB', 'vec4'), iC = attribute('iC', 'vec4');
      const q = positionGeometry.xy.mul(2.0).sub(1.0);
      m.vertexNode = toClip(iA.xy.add(q.mul(iA.z)));
      const vUv = varying(q), vCol = varying(iB), vP = varying(iC), vKind = varying(iA.w), vR = varying(iA.z.mul(uCam.z));
      m.fragmentNode = Fn(() => {
        // branch-free: evaluate every shape, pick by kind
        const d = length(vUv), px = float(1.0).div(max(vR, 1.0)), k = vKind, one = float(1.0);
        const aSoft = select(d.lessThan(1.0), select(d.lessThan(0.5), mix(0.5, 0.18, d.div(0.5)), mix(0.18, 0.0, d.sub(0.5).div(0.5))), 0.0);
        const aHot = select(d.lessThan(1.0), select(d.lessThan(0.25), mix(1.0, 0.5, d.div(0.25)), mix(0.5, 0.0, d.sub(0.25).div(0.75))), 0.0);
        const th = max(vP.x.mul(px), px.mul(1.2));
        const aRing = one.sub(smoothstep(th.mul(0.5).sub(px), th.mul(0.5).add(px), abs(d.sub(one.sub(th.mul(0.5))))));
        const ang = atan(vUv.x, vUv.y.negate()).div(6.2831853).add(0.5);
        const aDash = aRing.mul(step(0.5, fract(ang.mul(vP.y))));
        const aArc = aRing.mul(step(ang, vP.y));
        const aDisc = one.sub(smoothstep(one.sub(px.mul(1.5)), one, d));
        const aBar = select(abs(vUv.y).greaterThan(vP.x), 0.0, 1.0);
        const hp = abs(vUv), hx = max(hp.x.mul(0.866).add(hp.y.mul(0.5)), hp.y);
        const aHex = one.sub(smoothstep(px.mul(1.5), px.mul(3.0), abs(hx.sub(0.85))));
        const aCloud = select(d.lessThan(1.0), pow(max(one.sub(d), 0.0), 1.6), 0.0);
        const a = select(k.lessThan(0.5), aSoft, select(k.lessThan(1.5), aHot, select(k.lessThan(2.5), aRing, select(k.lessThan(3.5), aArc,
          select(k.lessThan(4.5), aDisc, select(k.lessThan(5.5), aBar, select(k.lessThan(6.5), aHex, select(k.lessThan(7.5), aDash, aCloud)))))))).mul(vCol.a);
        const hotC = mix(vCol.rgb, vec3(1.0), clamp(float(0.55).sub(d.mul(2.2)), 0.0, 0.55));
        const barC = select(vUv.x.mul(0.5).add(0.5).greaterThan(vP.y), vec3(0.0), vCol.rgb);
        const c = select(k.lessThan(0.5), vCol.rgb, select(k.lessThan(1.5), hotC, select(k.greaterThan(4.5).and(k.lessThan(5.5)), barC, vCol.rgb)));
        If(a.lessThanEqual(0.002), () => { Discard(); });
        return vec4(c.mul(a), a);
      })();
      return m;
    }
    if (name === 'ribbon') {
      Object.assign(m, { blending: NS.CustomBlending, blendEquation: NS.MaxEquation, blendSrc: NS.OneFactor, blendDst: NS.OneFactor });
      const iA = attribute('iA', 'vec4'), iB = attribute('iB', 'vec4'), iC = attribute('iC', 'vec4');
      const p0 = iA.xy, p1 = iA.zw, R = iB.y, dd = p1.sub(p0), Ln = length(dd);
      const t = select(Ln.greaterThan(1e-4), dd.div(max(Ln, 1e-4)), vec2(1.0, 0.0)), n = vec2(t.y.negate(), t.x);
      const qx = positionGeometry.x, qy = positionGeometry.y;
      const w = p0.add(t.mul(mix(R.negate(), Ln.add(R), qx))).add(n.mul(qy.mul(2.0).sub(1.0).mul(R)));
      m.vertexNode = toClip(w);
      const vW = varying(w), vSeg = varying(iA), vCol = varying(iC), vP = varying(iB);
      m.fragmentNode = Fn(() => {
        const a0 = vSeg.xy, a1 = vSeg.zw, pa = vW.sub(a0), ba = a1.sub(a0);
        const hh = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-6)), 0.0, 1.0);
        const d = length(pa.sub(ba.mul(hh)));
        const s = vP.x, px = float(1.0).div(uCam.z), a = float(0).toVar(), c = vec3(vCol.rgb).toVar();
        If(vP.z.lessThan(0.5), () => {
          const core = max(px.mul(0.65), s.mul(1.25)), mid = s.mul(2.6), outer = s.mul(5.0).mul(vP.w);
          const aO = float(0.1).mul(float(1.0).sub(smoothstep(outer.sub(px), outer.add(px), d)));
          const aM = float(0.32).mul(float(1.0).sub(smoothstep(mid.sub(px), mid.add(px), d)));
          const aC = float(0.85).mul(float(1.0).sub(smoothstep(core.sub(px.mul(0.7)), core.add(px.mul(0.7)), d)));
          const tot = aO.add(aM.mul(0.9)).add(aC);
          c.assign(mix(c, mix(c, vec3(1.0), 0.25), aC.div(max(tot, 1e-3))));
          a.assign(min(tot, 1.0));
        }).Else(() => {
          a.assign(float(1.0).sub(smoothstep(s.sub(px), s.add(px), d)));
          If(vP.z.greaterThan(1.5), () => { a.mulAssign(step(0.5, fract(dot(pa, ba.div(max(length(ba), 1e-5))).div(px.mul(10.0))))); });
        });
        a.mulAssign(vCol.a);
        If(a.lessThanEqual(0.002), () => { Discard(); });
        return vec4(c.mul(a), a);
      })();
      return m;
    }
    if (name === 'sprite') {
      premul();
      const tex = texture(opts.tex); U.uTex = tex; m.uniforms = U;
      const iA = attribute('iA', 'vec4'), iB = attribute('iB', 'vec4'), iUa = attribute('iUa', 'vec4'), iUb = attribute('iUb', 'vec4'), iC0 = attribute('iC0', 'vec4'), iC1 = attribute('iC1', 'vec4');
      const q = positionGeometry.xy;
      const loc = vec2(mix(iB.x, iB.y, q.x), mix(iB.z, iB.w, q.y)).mul(iA.w);
      const cs = cos(iA.z), sn = sin(iA.z);
      m.vertexNode = toClip(iA.xy.add(vec2(cs.mul(loc.x).sub(sn.mul(loc.y)), sn.mul(loc.x).add(cs.mul(loc.y)))));
      const vUa = varying(mix(iUa.xy, iUa.zw, q)), vUb = varying(mix(iUb.xy, iUb.zw, q)), vC0 = varying(iC0), vC1 = varying(iC1);
      m.fragmentNode = Fn(() => {
        const t = mix(tex.sample(vUa), tex.sample(vUb), vC1.w);
        const c = vC0.rgb.mul(t.r).add(vC1.rgb.mul(t.g)).add(vec3(t.b));
        const a = t.a.mul(vC0.a);
        If(a.lessThanEqual(0.003), () => { Discard(); });
        return vec4(c.mul(a), a);
      })();
      return m;
    }
    // full-screen passes
    const vS = varying(vec2(positionGeometry.x.mul(0.5).add(0.5).mul(uRes.x), float(1.0).sub(positionGeometry.y.mul(0.5).add(0.5)).mul(uRes.y)));
    m.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0);
    const world = () => uCam.xy.add(vS.sub(uRes.mul(0.5)).div(uCam.z));
    if (name === 'fog') {
      premul();
      const fog = u.uFog; m.uniforms = U;
      m.fragmentNode = Fn(() => {
        const w = world(), uv = w.div(nd(u.uGrid).mul(nd(u.uCell)));
        const f = fog.sample(uv);
        const vis = smoothstep(0.05, 0.9, f.r), ex = smoothstep(0.02, 0.6, f.g);
        const a = mix(0.93, 0.58, ex).mul(float(1.0).sub(vis));
        return vec4(vec3(0.0, 0.012, 0.02).mul(a), a);
      })();
      return m;
    }
    if (name === 'bg') {
      m.transparent = false; m.blending = NS.NoBlending; m.uniforms = U;
      const hash = p => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
      const pools = nd(u.uPools), curs = nd(u.uCur), curK = nd(u.uCurK);
      m.fragmentNode = Fn(() => {
        const t = uCam.w, w = world();
        const rM = length(uRes);
        const gr = length(vS.sub(vec2(uRes.x.mul(0.5), uRes.y.mul(0.45)))).div(rM.mul(0.8));
        const col = vec3(select(gr.lessThan(0.5), mix(u.uBgC, u.uBg, gr.div(0.5)), mix(u.uBg, vec3(0.0), clamp(gr.sub(0.5).div(0.5), 0.0, 1.0)))).toVar();
        col.addAssign(mix(u.uPrim, vec3(0.51, 1.0, 0.94), 0.3).mul(float(0.03).add(sin(t.mul(0.7)).mul(0.5).add(0.5).mul(0.03))).mul(clamp(float(1.0).sub(vS.y.div(uRes.y.mul(0.35))), 0.0, 1.0)));
        const focus = float(0.12).toVar();
        Loop({ start: 0, end: E.GL.MAX_POOLS, type: 'int' }, ({ i }) => {
          If(i.greaterThanEqual(u.uPoolN), () => { Break(); });
          const P = pools.element(i), d = length(w.sub(P.xy)).div(abs(P.z).mul(3.2));
          focus.addAssign(float(1.0).sub(smoothstep(0.0, 1.0, d)).mul(float(0.35).add(P.w.mul(0.65))));
        });
        If(u.uQ.greaterThan(0.5), () => {
          const q = vec2(w.mul(0.012)).toVar(), cz = float(0).toVar(), tt = t.mul(0.6);
          Loop({ start: 0, end: 3, type: 'int' }, ({ i }) => {
            const fi = float(i);
            q.addAssign(vec2(sin(q.y.mul(1.3).add(tt.mul(0.7)).add(fi)), cos(q.x.mul(1.1).sub(tt.mul(0.6)).add(fi.mul(1.7)))).mul(0.45));
            cz.addAssign(abs(sin(q.x.add(q.y.mul(0.6)).add(tt.mul(0.4)))).mul(abs(cos(q.y.sub(q.x.mul(0.4)).sub(tt.mul(0.3))))));
          });
          const c = pow(float(1.0).sub(cz.div(3.0)), 5.0);
          col.addAssign(mix(u.uPrim, vec3(0.78, 1.0, 1.0), 0.5).mul(c).mul(0.1).mul(min(focus, 1.6)));
        });
        const flow = vec2(0.0).toVar();
        Loop({ start: 0, end: E.GL.MAX_CUR, type: 'int' }, ({ i }) => {
          If(i.greaterThanEqual(u.uCurN), () => { Break(); });
          const C = curs.element(i), K = curK.element(i), dv = w.sub(C.xy), d = length(dv);
          If(d.lessThan(C.z).and(d.greaterThan(1.0)), () => {
            const k = float(1.0).sub(d.div(C.z)).mul(min(1.0, d.div(60.0)));
            flow.addAssign(select(K.x.lessThan(0.5), vec2(dv.y.negate(), dv.x).div(d).mul(C.w).mul(k), vec2(cos(K.y), sin(K.y)).mul(abs(C.w)).mul(k)));
          });
        });
        const fm = length(flow);
        If(fm.greaterThan(1.5), () => {
          const fd = flow.div(fm), fn = vec2(fd.y.negate(), fd.x);
          const along = dot(w, fd), across = dot(w, fn), lane = floor(across.div(26.0));
          const ph = fract(along.sub(t.mul(fm).mul(2.2)).div(90.0).add(hash(vec2(lane, 3.0))));
          const streak = smoothstep(0.0, 0.08, ph).mul(float(1.0).sub(smoothstep(0.08, 0.5, ph))).mul(step(0.7, hash(vec2(lane, 9.0))));
          const laneMask = float(1.0).sub(abs(fract(across.div(26.0)).sub(0.5)).mul(2.0));
          col.addAssign(mix(u.uPrim, vec3(1.0), 0.45).mul(streak).mul(smoothstep(0.2, 0.9, laneMask)).mul(clamp(fm.div(35.0), 0.0, 1.0)).mul(0.13));
        });
        const inMap = w.x.greaterThanEqual(0.0).and(w.y.greaterThanEqual(0.0)).and(w.x.lessThanEqual(u.uMap.x)).and(w.y.lessThanEqual(u.uMap.y));
        return vec4(select(inMap, col, col.mul(0.45)), 1.0);
      })();
      return m;
    }
    throw new Error('unknown material ' + name);
  }

  class GPURenderer extends E.GLRenderer {
    constructor(canvas, opts) {
      const NS = N();
      const backend = { ns: NS, kind: 'webgpu', mat: tslMat, uniforms: () => ({ uCam: NS.TSL.uniform(new NS.Vector4(0, 0, 1, 0)), uRes: NS.TSL.uniform(new NS.Vector2(1, 1)) }) };
      super(canvas, Object.assign({}, opts, { backend }));
      this.ready = false;
      this.initP = this.r.init().then(() => { this.ready = true; }).catch(err => { this.failed = err; console.error('WebGPU init failed', err); });
    }
    makeRenderer(canvas) {
      const r = new this.ns.WebGPURenderer({ canvas, antialias: false, alpha: false });
      r.outputColorSpace = this.ns.LinearSRGBColorSpace;
      return r;
    }
    buildAtlas(scale) {
      super.buildAtlas(scale);
      if (this.sprite) this.sprite.mesh.material.uniforms.uTex.value = this.tex;
    }
    frame(view, alpha, t, dt, ui) { if (!this.ready) return; super.frame(view, alpha, t, dt, ui); }
    gpuName() { return 'WebGPU' + (this.r.backend && this.r.backend.isWebGPUBackend ? '' : ' (WebGL2 fallback)'); }
    flush() { /* WebGPU queues are async; frame intervals capture real cost */ }
  }
  E.GPURenderer = GPURenderer;
})(window.E);
