// DOM helpers, toasts/modals, and canvas previews of creatures and organs.
(function (E) {
  'use strict';
  const $ = id => document.getElementById(id);
  E.$ = $;
  E.h = function (tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (v !== false && v !== null && v !== undefined) el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
    return el;
  };
  E.esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let toastT = 0;
  E.toast = function (msg, ms) {
    const el = $('toast'); el.textContent = msg; el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), ms || 2400);
  };
  E.modal = function (title, body, buttons) {
    return new Promise(res => {
      const bg = E.h('div', { class: 'modal-bg' });
      const box = E.h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, E.h('h3', null, title), typeof body === 'string' ? E.h('p', { style: 'margin:0;color:var(--ink-soft)' }, body) : body);
      const row = E.h('div', { class: 'row' });
      (buttons || [{ label: 'OK', value: true, primary: true }]).forEach(b => row.appendChild(E.h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), onclick: () => { bg.remove(); res(b.value); } }, b.label)));
      box.appendChild(row); bg.appendChild(box); document.body.appendChild(bg);
      bg.addEventListener('click', e => { if (e.target === bg) { bg.remove(); res(null); } });
      const f = box.querySelector('input'); if (f) setTimeout(() => f.focus(), 30);
    });
  };
  E.confirm = (title, body, yes) => E.modal(title, body, [{ label: 'Cancel', value: false }, { label: yes || 'Confirm', value: true, primary: true }]);
  E.prompt = function (title, value) {
    const inp = E.h('input', { type: 'text', value: value || '', maxlength: 24 });
    return E.modal(title, inp, [{ label: 'Cancel', value: null }, { label: 'OK', value: 'ok', primary: true }]).then(v => v ? inp.value.trim() : null);
  };
  E.haptic = ms => { if (E.Settings.haptics && navigator.vibrate) try { navigator.vibrate(ms || 8); } catch (e) { /* */ } };

  // ── Previews ────────────────────────────────────────────────────
  function fit(cv) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, r.width || cv.width), h = Math.max(1, r.height || cv.height);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }
  // Static creature portrait (a gently curved swimmer)
  E.drawPortrait = function (cv, design, cultId, tier, t, opts) {
    opts = opts || {};
    const { ctx, w, h } = fit(cv);
    const cult = E.CULTURES[cultId] || E.CULTURE_LIST[0];
    ctx.fillStyle = opts.bg || '#040e12'; ctx.fillRect(0, 0, w, h);
    const pal = E.palette(cult, 0.4, 0, 100, false);
    const ch = E.CHASSIS[design.chassis] || E.CHASSIS.serpent;
    const st = E.computeStats(design, { tier: tier || {}, culture: cult.id }, opts.v ? { v: opts.v } : null);
    const scale = Math.min(1.6, (w * 0.62) / (ch.bodyLen * st.size + 30), h / 55) * (opts.zoom || 1);
    ctx.save(); ctx.translate(w * (ch.id === 'siphonophore' ? 0.8 : 0.66), h / 2); ctx.scale(scale, scale);
    E.drawGlow(ctx, -20, 0, 50, pal.primary, 0.12, true);
    const v = E.makeVis(0, 0, 0, ch.bodyLen * st.size, 7);
    const tr = v.trail; for (let i = 0; i < tr.length; i++) { tr[i].x = -i * v.spacing; tr[i].y = Math.sin(i * 0.12 + (t || 0)) * 3; }
    const pts = E.buildPts(v, 0, 0, t || 0.7, st.size);
    E.drawCreature(ctx, v, pts, { design, tier: tier || {}, hc: E.mix(cult.colors[0], cult.colors[1], 0.3), pal, t: t || 0.7, alpha: 0.95, lod: 0, size: st.size, vOverride: opts.v, role: design.organs.length ? E.roleClass(st) : null });
    ctx.restore();
  };
  // Single organ on a bare spine (tech tree + codex)
  E.drawOrganThumb = function (cv, organId, v, cultId, t) {
    const { ctx, w, h } = fit(cv);
    const cult = E.CULTURES[cultId] || E.CULTURE_LIST[0], pal = E.palette(cult, 0.45, 0, 100, false);
    ctx.fillStyle = '#040e12'; ctx.fillRect(0, 0, w, h);
    E.drawGlow(ctx, w * 0.55, h / 2, w * 0.5, pal.primary, 0.15, true);
    const o = E.ORGANS[organId], k = Math.min(1.3, h / 46);
    ctx.save(); ctx.translate(o.cls === 'flagella' ? w * 0.86 : w * 0.7, h / 2); ctx.scale(k, k);
    const pts = []; for (let i = 0; i < 20; i++) pts.push({ x: -i * (o.cls === 'flagella' ? 2.1 : 2.7), y: Math.sin((t || 0) * 3 - i * 0.55) * i * 0.18 });
    const hc = E.mix(cult.colors[0], cult.colors[1], 0.3);
    E.glowStroke(ctx, pts, 20, 0.9, hc, 0.9, 1);
    const par = { speed: 1, phase: 0.6 };
    o.draw(ctx, pts, 1, par, t || 0.6, v, pal, hc);
    if (o.cls !== 'flagella') o.draw(ctx, pts, -1, { speed: 1, phase: 1.9 }, t || 0.6, v, pal, hc);
    E.drawGlow(ctx, pts[0].x, pts[0].y, 11, pal.accent, 0.9);
    ctx.restore();
  };
  // Command icons drawn from the organs themselves (cached per culture).
  const ICON_ORGAN = { Attack: 'nippers', Move: 'whiptail', Hold: 'stilts', Patrol: 'finveil', Queue: 'tether', Harvest: 'fuzz', Spore: 'sporesacs',
    Evolve: 'plumes', Spawnforge: 'horns', Army: 'pincers', Idle: 'lures', Rally: 'photophores', Next: 'corkscrew', Hatch: 'tubefeet', Build: 'combs', Stop: 'thorn' };
  const iconCache = new Map();
  E.cmdIcon = function (label, cult) {
    const id = ICON_ORGAN[label]; if (!id) return null;
    const key = id + cult; let url = iconCache.get(key);
    if (!url) {
      const cv = document.createElement('canvas'); cv.width = 68; cv.height = 40; cv.style.width = '68px'; cv.style.height = '40px';
      // transparent close-up of the organ, framed on its anchor (head, body or tail)
      const ctx = cv.getContext('2d'), o = E.ORGANS[id], c = E.CULTURES[cult] || E.CULTURE_LIST[0], pal = E.palette(c, 0.6, 0, 100, false);
      const pts = []; for (let i = 0; i < 20; i++) pts.push({ x: -i * 2.7, y: Math.sin(i * 0.5) * i * 0.12 });
      const anchor = id === 'finveil' ? -34 : o.cls === 'flagella' ? pts[19].x - 30 : (o.cls === 'mandible' || o.cls === 'antenna') && id !== 'photophores' ? 4 : -14;
      ctx.translate(34, 20); ctx.scale(1.45, 1.45); ctx.translate(-anchor, 0);
      const hc = E.mix(c.colors[0], c.colors[1], 0.35);
      E.glowStroke(ctx, pts, 20, 0.7, hc, 0.7, 1);
      o.draw(ctx, pts, 1, { speed: 1, phase: 0.6 }, 0.7, 6, pal, hc);
      if (o.cls !== 'flagella') o.draw(ctx, pts, -1, { speed: 1, phase: 1.9 }, 0.7, 6, pal, hc);
      url = cv.toDataURL();
      iconCache.set(key, url);
    }
    return url;
  };
  E.drawChassisThumb = function (cv, chId, cultId, t) {
    const d = { chassis: chId, organs: [] };
    E.drawPortrait(cv, d, cultId, {}, t, { zoom: 0.95 });
  };

  // Animated aquarium used by the Forge preview
  class Aquarium {
    constructor(cv) { this.cv = cv; this.ctx = cv.getContext('2d'); this.items = []; this.t = 0; this.visible = true; }
    set(design, cultId, v) {
      this.design = design; this.cult = E.CULTURES[cultId]; this.v = v;
      const st = E.computeStats(design, { culture: cultId }, v ? { v } : null);
      const ch = E.CHASSIS[design.chassis];
      const prev = this.items[0];
      this.items = [{ x: prev ? prev.x : 0, y: prev ? prev.y : 0, a: prev ? prev.a : 0, vis: E.makeVis(0, 0, 0, ch.bodyLen * st.size, 3), size: st.size, role: E.roleClass(st), tx: 0, ty: 0, tt: 0 }];
    }
    frame(dt) {
      if (!this.design) return;
      const r = this.cv.getBoundingClientRect(); if (!r.width) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (this.cv.width !== Math.round(r.width * dpr) || this.cv.height !== Math.round(r.height * dpr)) { this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr); }
      this.t += dt;
      const ctx = this.ctx, z = Math.max(2.4, Math.min(r.width, r.height) / 110), W = r.width / z, H = r.height / z, t = this.t;
      ctx.setTransform(dpr * z, 0, 0, dpr * z, 0, 0);
      const pal = E.palette(this.cult, 0.35, 0, 100, false);
      const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.hypot(W, H) * 0.7);
      g.addColorStop(0, E.rgba(pal.bgCenter, 1)); g.addColorStop(1, 'rgb(0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 24; i++) { const x = (i * 97.3 + t * 3) % W, y = (i * 53.1 + Math.sin(t * 0.3 + i) * 6) % H; ctx.fillStyle = E.rgba(pal.primary, 0.25); ctx.beginPath(); ctx.arc(x, y, 0.7, 0, E.TAU); ctx.fill(); }
      for (const c of this.items) {
        if (!c.init) { c.x = W / 2; c.y = H / 2; c.init = true; for (const p of c.vis.trail) { p.x = c.x; p.y = c.y; } }
        c.tt -= dt;
        if (c.tt <= 0 || Math.hypot(c.tx - c.x, c.ty - c.y) < 12) { c.tx = W * (0.25 + Math.random() * 0.5); c.ty = H * (0.3 + Math.random() * 0.4); c.tt = 3 + Math.random() * 2; }
        const d = E.angWrap(Math.atan2(c.ty - c.y, c.tx - c.x) - c.a); c.a += E.clamp(d, -1.1 * dt, 1.1 * dt);
        c.x += Math.cos(c.a) * 30 * dt; c.y += Math.sin(c.a) * 30 * dt;
        c.x = E.clamp(c.x, 20, W - 20); c.y = E.clamp(c.y, 20, H - 20);
        E.advanceVis(c.vis, c.x, c.y, dt);
        const pts = E.buildPts(c.vis, c.x, c.y, t, c.size);
        E.drawCreature(ctx, c.vis, pts, { design: this.design, hc: E.creatureColor(this.cult, pal, c.vis.indiv, c.vis.phase, t), pal, t, alpha: 0.95, lod: 0, size: c.size, vOverride: this.v, role: c.role });
      }
    }
  }
  E.Aquarium = Aquarium;

  // Navigation between menu screens
  E.Screens = {
    stack: [],
    show(id) {
      document.querySelectorAll('.screen').forEach(s => (s.hidden = s.id !== id));
      if (this.stack[this.stack.length - 1] !== id) this.stack.push(id);
      const el = $(id); el.scrollTop = 0;
      if (this.onShow && this.onShow[id]) this.onShow[id]();
    },
    back() { const cur = this.stack.pop(); if (this.onLeave && this.onLeave[cur]) this.onLeave[cur](); const id = this.stack.pop() || 'scr-menu'; this.show(id); },
    hideAll() { document.querySelectorAll('.screen').forEach(s => (s.hidden = true)); },
    onShow: {}, onLeave: {},
  };
})(window.E);
