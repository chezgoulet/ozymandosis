// Game controller: owns the world (or a network mirror), the loop, input,
// camera, HUD and the command sheet.
(function (E) {
  'use strict';
  const h = E.h, $ = E.$, DT = E.DT;
  const ABILITY_KEYS = ['q', 'w', 'e', 'r', 'd', 'f'];

  class Game {
    constructor() {
      this.root = $('game'); this.cv = $('view');
      this.renderer = new E.Renderer(this.cv);
      this.minimap = new E.Minimap($('minimap'), this.renderer);
      this.tech = new E.TechUI(this);
      this.selection = new Set(); this.groups = {}; this.pings = []; this.alerts = []; this.mode = null;
      this.pointers = new Map(); this.keys = new Set();
      this.running = false; this.speed = 1;
      this.bindInput(); this.bindHud();
      window.addEventListener('resize', () => this.resize());
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.autosave(); });
      window.addEventListener('pagehide', () => this.autosave());
    }

    // ── lifecycle ───────────────────────────────────────────────
    start(o) {
      this.netMode = o.mode || 'local';
      this.local = o.local || 0; this.relay = o.relay || null; this.peers = o.peers || new Map();
      if (this.netMode === 'guest') { this.world = E.NetPack.mirror(o.init); this.local = o.init.you; this.snapT = performance.now(); this.snapDt = 125; this.waiting = true; }
      else this.world = o.save ? new E.World({ state: o.save }) : new E.World({ cfg: o.cfg });
      const w = this.world;
      this.selection.clear(); this.groups = {}; this.pings = []; this.alerts = []; this.mode = null; this.acc = 0; this.snapAcc = 0; this.evBuf = []; this.hudT = 0; this.saveT = 45; this.lastAlert = null;
      this.paused = false; this.ended = false; this.speed = this.netMode === 'local' ? (E.Settings.speed || 1) : 1;
      this.renderer.quality = E.Settings.quality === 'low' ? 'low' : 'high';
      this.root.hidden = false; E.Screens.hideAll(); $('bg').hidden = true;
      this.resize();
      this.renderer.reset(w, this.local);
      const me = this.me();
      const home = me && w.s.structs.find(b => b.o === this.local && b.kind === 'nucleus');
      const c = this.renderer.cam;
      if (home) { c.x = home.x; c.y = home.y; } else { c.x = w.s.map.w / 2; c.y = w.s.map.h / 2; }
      c.z = Math.min(this.renderer.W, this.renderer.H) < 700 ? 0.75 : 1;
      if (me) { const cult = E.CULTURES[me.culture]; document.documentElement.style.setProperty('--pc0', cult.hex[0]); document.documentElement.style.setProperty('--pc1', cult.hex[1]); }
      $('mm-wrap').classList.toggle('collapsed', !!E.Settings.mmCollapsed);
      $('h-chat').hidden = this.netMode === 'local'; $('chat').hidden = this.netMode === 'local';
      $('chat-log').innerHTML = '';
      ['ov-tech', 'ov-forge', 'ov-pause', 'ov-end'].forEach(id => ($(id).hidden = true));
      this.sheetSig = ''; this.renderSheet();
      if (this.netMode === 'host') this.hostSetup();
      if (this.netMode === 'guest') this.guestSetup();
      this.running = true;
      if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(t => this.loop(t)); }
      E.Audio.play('build');
      if (!o.save && this.netMode !== 'guest') this.notify('The bloom begins. Hatch foragers, gather lumen, evolve.', 'info');
    }
    stop() {
      this.autosave();
      this.running = false; this.root.hidden = true; $('bg').hidden = false;
      if (this.relay) { this.relay.close(); this.relay = null; }
    }
    me() { return this.world && this.local >= 0 ? this.world.s.players[this.local] : null; }
    send(cmd) {
      if (!this.world || this.world.s.over) return;
      if (this.netMode === 'guest') this.relay.toHost({ k: 'cmd', cmd });
      else this.world.command(this.local, cmd);
    }
    resize() {
      this.renderer.resize(); this.minimap.resize();
      if (this.world) this.renderer.clampCam(this.world);
      this.measureSheet();
    }
    autosave() {
      if (!this.running || !this.world || this.netMode === 'guest' || this.world.s.over) return;
      E.Saves.write('auto', this.world, { local: this.local, name: 'Autosave' });
    }

    // ── networking ──────────────────────────────────────────────
    hostSetup() {
      const r = this.relay;
      r.on('msg', m => {
        const peer = this.peers.get(m.from); const d = m.data; if (!d) return;
        if (d.k === 'cmd' && peer) this.world.command(peer.slot, d.cmd);
        else if (d.k === 'chat' && peer) this.chat(peer.name, d.text, true);
        else if (d.k === 'ready' && peer) this.sendInit(m.from);
      });
      r.on('peer', m => {
        // mid-game rejoin: reclaim a dropped human slot with the same name, else any bot slot marked open
        const p = this.world.s.players.find(p => p.dropped && p.name === m.name) || this.world.s.players.find(p => p.dropped);
        if (!p) { this.relay.kick(m.id); return; }
        p.kind = 'remote'; p.dropped = false; this.peers.set(m.id, { slot: p.idx, name: m.name });
        this.notify(`${m.name} rejoined`, 'good'); this.sendInit(m.id);
      });
      r.on('left', m => {
        const peer = this.peers.get(m.id); if (!peer) return;
        this.peers.delete(m.id);
        const p = this.world.s.players[peer.slot]; p.kind = 'bot'; p.diff = p.diff || 'normal'; p.dropped = true; p.income = 1;
        this.notify(`${peer.name} disconnected. A bot takes over until they return.`, 'info');
      });
      r.on('close', () => this.notify('Lost connection to the relay server.', 'info'));
      for (const id of this.peers.keys()) this.sendInit(id);
    }
    sendInit(id) { const peer = this.peers.get(id); if (!peer) return; this.relay.send(id, E.NetPack.init(this.world, peer.slot)); this.relay.send(id, E.NetPack.snap(this.world, peer.slot, [])); }
    guestSetup() {
      const r = this.relay;
      r.on('msg', m => {
        const d = m.data; if (!d) return;
        if (d.k === 'snap') {
          const now = performance.now(); this.snapDt = E.clamp(now - this.snapT, 60, 300); this.snapT = now;
          E.NetPack.apply(this.world, d); this.waiting = false;
          this.handleEvents(d.ev || []);
        } else if (d.k === 'init') { this.world = E.NetPack.mirror(d); this.local = d.you; this.renderer.reset(this.world, this.local); }
        else if (d.k === 'chat') this.chat(d.from, d.text);
        else if (d.k === 'pause') { this.remotePaused = d.on; $('ov-pause').hidden = !d.on; $('pause-note').textContent = d.on ? 'Paused by the host' : ''; }
      });
      r.on('closed', () => { this.notify('The host closed the game.', 'info'); E.toast('The host closed the game.'); setTimeout(() => this.quit(true), 1500); });
      r.on('close', () => { if (this.running) this.notify('Disconnected from the relay.', 'info'); });
      r.on('error', m => E.toast(m.msg));
      r.toHost({ k: 'ready' });
    }
    broadcastSnaps(events) {
      for (const [id, peer] of this.peers) this.relay.send(id, E.NetPack.snap(this.world, peer.slot, events));
    }
    chat(from, text, relayOut) {
      text = String(text).slice(0, 140);
      const log = $('chat-log');
      log.appendChild(h('div', { class: 'msg' }, h('b', null, from + ': '), text));
      while (log.children.length > 6) log.firstChild.remove();
      setTimeout(() => { if (log.firstChild) log.firstChild.remove(); }, 20000);
      E.Audio.play('chat');
      if (relayOut && this.netMode === 'host') this.relay.send('all', { k: 'chat', from, text });
    }

    // ── loop ────────────────────────────────────────────────────
    loop(now) {
      this.raf = requestAnimationFrame(t => this.loop(t));
      const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
      if (!this.running || !this.world) return;
      const w = this.world;
      let alpha = 1;
      if (this.netMode !== 'guest') {
        if (!this.paused) {
          this.acc += dt * this.speed;
          let n = 0;
          while (this.acc >= DT && n < 8) { w.step(); this.acc -= DT; n++; const ev = w.drainEvents(); this.handleEvents(ev); if (this.netMode === 'host') this.evBuf.push(...ev); }
          if (n >= 8) this.acc = 0;
        }
        alpha = this.paused ? 1 : E.clamp(this.acc / DT, 0, 1);
        if (this.netMode === 'host') { this.snapAcc += dt; if (this.snapAcc >= 0.125) { this.snapAcc = 0; this.broadcastSnaps(this.evBuf); this.evBuf = []; } }
        this.saveT -= dt; if (this.saveT <= 0) { this.saveT = 45; this.autosave(); }
      } else alpha = E.clamp((now - this.snapT) / this.snapDt, 0, 1);
      this.updateCamera(dt);
      this.pings = this.pings.filter(p => this.renderer.t - p.t0 < 0.8);
      const ui = { selection: this.selection, box: this.box, ghost: this.ghost, target: this.targetPreview, pings: this.pings, showHp: E.Settings.showHp };
      this.renderer.frame(w, alpha, this.netMode === 'guest' ? w.s.t + alpha * this.snapDt / 1000 : w.s.t + alpha * DT, dt, ui);
      if (!$('mm-wrap').classList.contains('collapsed')) this.minimap.draw(w, dt, this.alerts);
      this.hudT -= dt; if (this.hudT <= 0) { this.hudT = 0.1; this.updateHud(); }
      if (!$('ov-tech').hidden) { this.techT = (this.techT || 0) - dt; if (this.techT <= 0) { this.techT = 0.25; this.tech.update(); } }
      if (this.forge && !$('ov-forge').hidden) this.forge.frame(dt);
      const me = this.me(); if (me) E.Audio.mood(me.energy, me.fever);
      if (w.s.over && !this.ended) this.onOver();
    }
    handleEvents(events) {
      if (!events.length) return;
      const w = this.world, L = this.local;
      this.renderer.consume(w, events);
      for (const ev of events) {
        const mine = ev.o === L;
        const seen = ev.x === undefined || this.renderer.seen(ev.x, ev.y);
        switch (ev.e) {
          case 'hatch': if (mine) E.Audio.play('hatch', 150); break;
          case 'die': if (seen) E.Audio.play('die', 90); break;
          case 'hit': if (seen) E.Audio.play('bite', 70); break;
          case 'research': if (mine) { const t = E.TECHS[ev.key]; this.notify(`${t.name} evolved`, 'good'); E.Audio.play('research'); this.sheetSig = ''; if (!$('ov-tech').hidden) this.tech.build(); } break;
          case 'alert': if (mine) { const t = performance.now() / 1000; this.alerts.push({ x: ev.x, y: ev.y, t }); this.alerts = this.alerts.slice(-6); this.lastAlert = ev; this.notify(`Your ${E.STRUCTS[ev.kind].name} is under attack`, 'alert', ev); E.Audio.play('alert', 3000); } break;
          case 'deny': if (mine) { E.toast(ev.why); E.Audio.play('deny'); } break;
          case 'pickup': if (mine) E.Audio.play('pickup'); break;
          case 'built': if (mine) { this.notify(`${E.STRUCTS[ev.kind].name} has bloomed`, 'good'); E.Audio.play('build'); this.sheetSig = ''; } break;
          case 'plant': if (mine) E.Audio.play('build'); break;
          case 'destroy': if (seen) E.Audio.play('destroy'); if (mine) this.notify(`Your ${E.STRUCTS[ev.kind].name} was destroyed`, 'alert', ev); break;
          case 'power': if (seen || mine) E.Audio.play('power'); break;
          case 'ability': if (seen) E.Audio.play('ability', 100); break;
          case 'convert': if (ev.from === L) this.notify('One of your creatures was turned', 'alert', ev); break;
          case 'eliminated': { const p = w.s.players[ev.o]; this.notify(`${p.name} has been extinguished`, ev.o === L ? 'alert' : 'info'); break; }
          case 'apex': if (mine) this.notify('A Leviathan rises', 'good'); break;
        }
      }
    }
    notify(text, kind, at) {
      const box = $('alerts');
      const el = h('div', { class: 'alert' + (kind === 'info' ? ' info' : kind === 'good' ? ' good' : '') }, h('span', null, text), at ? h('button', { class: 'btn small', onclick: () => this.jump(at.x, at.y) }, 'View') : null);
      box.appendChild(el); while (box.children.length > 3) box.firstChild.remove();
      setTimeout(() => el.remove(), kind === 'alert' ? 6000 : 3800);
    }
    jump(x, y) { this.renderer.cam.x = x; this.renderer.cam.y = y; this.renderer.clampCam(this.world); }

    // ── camera ──────────────────────────────────────────────────
    updateCamera(dt) {
      const c = this.renderer.cam, sp = 900 / c.z * dt;
      if (this.keys.has('arrowleft')) c.x -= sp; if (this.keys.has('arrowright')) c.x += sp;
      if (this.keys.has('arrowup')) c.y -= sp; if (this.keys.has('arrowdown')) c.y += sp;
      if (E.Settings.edgePan && this.mouseIn && this.mouse && !this.pointers.size) {
        const m = this.mouse, W = this.renderer.W, H = this.renderer.H, e = 10;
        if (m.x < e) c.x -= sp; else if (m.x > W - e) c.x += sp;
        if (m.y < e) c.y -= sp; else if (m.y > H - e) c.y += sp;
      }
      if (this.world) this.renderer.clampCam(this.world);
    }
    zoomAt(sx, sy, f) {
      const r = this.renderer, before = r.s2w(sx, sy);
      r.cam.z *= f; r.clampCam(this.world);
      const after = r.s2w(sx, sy); r.cam.x += before.x - after.x; r.cam.y += before.y - after.y; r.clampCam(this.world);
    }

    // ── picking & commands ──────────────────────────────────────
    pick(pt, forTap) {
      const w = this.world, z = this.renderer.cam.z, slop = (forTap ? 22 : 12) / z;
      let best = null, bd = Infinity;
      for (const u of w.s.units) {
        const own = !w.isEnemy(this.local, u.o);
        if (!own && (!this.renderer.seen(u.x, u.y) || w.isStealthed(u))) continue;
        const st = w.stats(u), d = Math.hypot(u.x - pt.x, u.y - pt.y) - st.size * 10;
        if (d < slop && d < bd) { bd = d; best = u; }
      }
      if (best) return best;
      for (const b of w.s.structs) { const r = E.STRUCTS[b.kind].r; if (Math.hypot(b.x - pt.x, b.y - pt.y) < r * 1.4 + slop * 0.5 && (b.o === this.local || this.renderer.explore(b.x, b.y))) return b; }
      for (const k of w.s.pickups) if (Math.hypot(k.x - pt.x, k.y - pt.y) < 22 + slop * 0.5 && this.renderer.seen(k.x, k.y)) return Object.assign({ pickup: true }, k);
      for (const r of w.s.pools) if (Math.hypot(r.x - pt.x, r.y - pt.y) < r.r && this.renderer.explore(r.x, r.y)) return Object.assign({ pool: true }, r);
      return null;
    }
    selUnits() { const w = this.world; return [...this.selection].map(id => w.byId.get(id)).filter(u => u && u.kind === undefined && u.o === this.local && u.hp > 0); }
    selStruct() { if (this.selection.size !== 1) return null; const b = this.world.byId.get([...this.selection][0]); return b && b.kind !== undefined ? b : null; }
    select(ids, add) {
      if (!add) this.selection.clear();
      for (const id of ids) this.selection.add(id);
      if (ids.length) E.Audio.play('select', 80);
      this.sheetSig = ''; this.renderSheet();
    }
    ping(x, y, c) { this.pings.push({ x, y, c: c || { r: 160, g: 255, b: 240 }, t0: this.renderer.t }); }
    smart(pt) {
      const us = this.selUnits(), st = this.selStruct();
      if (st && st.o === this.local && !us.length) { this.send({ c: 'rally', sid: st.id, x: pt.x, y: pt.y }); this.ping(pt.x, pt.y); E.Audio.play('order'); return true; }
      if (!us.length) return false;
      const ids = us.map(u => u.id), tg = this.pick(pt, true), w = this.world;
      if (tg && tg.o !== undefined && !tg.pool && !tg.pickup && w.isEnemy(this.local, tg.o)) { this.send({ c: 'attack', ids, tid: tg.id }); this.ping(tg.x, tg.y, { r: 255, g: 110, b: 110 }); }
      else if (tg && tg.pool) { this.send({ c: 'harvest', ids, rid: tg.id }); this.ping(tg.x, tg.y, { r: 200, g: 255, b: 255 }); }
      else if (tg && tg.pickup) { this.send({ c: 'move', ids, x: tg.x, y: tg.y }); this.ping(tg.x, tg.y, { r: 255, g: 224, b: 102 }); }
      else { this.send({ c: E.Settings.rightClick === 'move' ? 'move' : 'amove', ids, x: pt.x, y: pt.y }); this.ping(pt.x, pt.y); }
      E.Audio.play('order'); E.haptic(6);
      return true;
    }
    setMode(m) {
      this.mode = m; this.ghost = null; this.targetPreview = null;
      const hint = $('hint');
      if (!m) { hint.hidden = true; this.renderSheet(); return; }
      const labels = { amove: 'Tap a place to attack-move', move: 'Tap a place to move', rally: 'Tap to set the rally point', build: `Tap to plant a ${m.kind && E.STRUCTS[m.kind] ? E.STRUCTS[m.kind].name : ''}`,
        ability: m.ab ? `Target ${E.ABILITIES[m.ab].name}` : '', power: m.id ? `Target ${E.POWERS[m.id].name}` : '' };
      $('hint-text').textContent = labels[m.k] || ''; hint.hidden = false;
    }
    execMode(pt) {
      const m = this.mode; if (!m) return false;
      const ids = this.selUnits().map(u => u.id);
      if (m.k === 'amove' || m.k === 'move') { if (ids.length) { this.send({ c: m.k, ids, x: pt.x, y: pt.y }); this.ping(pt.x, pt.y, m.k === 'amove' ? { r: 255, g: 110, b: 110 } : null); } }
      else if (m.k === 'rally') { const st = this.selStruct(); if (st) this.send({ c: 'rally', sid: st.id, x: pt.x, y: pt.y }); }
      else if (m.k === 'build') {
        if (!this.world.canPlace(this.local, m.kind, pt.x, pt.y)) { E.toast('Too close to another structure or the edge.'); E.Audio.play('deny'); return true; }
        let builders = ids;
        if (!builders.length) { const f = this.nearestForager(pt); if (f) builders = [f.id]; }
        if (!builders.length) { E.toast('No creature available to plant it.'); return true; }
        this.send({ c: 'build', ids: builders, kind: m.kind, x: pt.x, y: pt.y }); this.ping(pt.x, pt.y);
      } else if (m.k === 'ability') {
        const A = E.ABILITIES[m.ab];
        if (A.target === 'unit') { const tg = this.pick(pt, true); if (!tg || tg.kind !== undefined || !this.world.isEnemy(this.local, tg.o)) { E.toast('Choose an enemy creature'); return true; } this.send({ c: 'ability', ids, ab: m.ab, tid: tg.id }); }
        else this.send({ c: 'ability', ids, ab: m.ab, x: pt.x, y: pt.y });
      } else if (m.k === 'power') this.send({ c: 'power', id: m.id, x: pt.x, y: pt.y });
      E.Audio.play('order');
      this.setMode(null);
      return true;
    }
    nearestForager(pt) {
      let best = null, bd = Infinity;
      for (const u of this.world.s.units) if (u.o === this.local && this.world.stats(u).canHarvest) { const d = Math.hypot(u.x - pt.x, u.y - pt.y); if (d < bd) { bd = d; best = u; } }
      return best;
    }
    boxSelect(b, add) {
      const r = this.renderer, p0 = r.s2w(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1)), p1 = r.s2w(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
      const ids = this.world.s.units.filter(u => u.o === this.local && u.x >= p0.x && u.x <= p1.x && u.y >= p0.y && u.y <= p1.y).map(u => u.id);
      if (ids.length || !add) this.select(ids, add);
    }
    selectSame(u) {
      const r = this.renderer, v0 = r.s2w(0, 0), v1 = r.s2w(r.W, r.H);
      this.select(this.world.s.units.filter(x => x.o === this.local && x.d === u.d && x.x > v0.x && x.x < v1.x && x.y > v0.y && x.y < v1.y).map(x => x.id));
    }
    clickAt(sx, sy, add, dbl) {
      const pt = this.renderer.s2w(sx, sy);
      if (this.mode) return this.execMode(pt);
      const e = this.pick(pt, true);
      if (e && e.kind === undefined && !e.pool && !e.pickup && e.o !== undefined) {
        if (e.o === this.local) { if (dbl) this.selectSame(e); else if (add && this.selection.has(e.id)) { this.selection.delete(e.id); this.sheetSig = ''; } else this.select([e.id], add); }
        else if (this.selUnits().length && this.world.isEnemy(this.local, e.o)) this.smart(pt);
        else this.select([e.id]);
        return;
      }
      if (e && e.kind !== undefined) {
        if (this.selUnits().length && this.world.isEnemy(this.local, e.o)) { this.smart(pt); return; }
        this.select([e.id]); return;
      }
      // empty ground / pool / pickup
      if (this.isTouch && E.Settings.tapCommand && this.selUnits().length) { this.smart(pt); return; }
      if (this.isTouch && e && (e.pool || e.pickup) && this.selUnits().length) { this.smart(pt); return; }
      if (!add) { this.selection.clear(); this.sheetSig = ''; this.renderSheet(); }
    }

    // ── input ───────────────────────────────────────────────────
    bindInput() {
      const cv = this.cv;
      cv.addEventListener('contextmenu', e => e.preventDefault());
      cv.addEventListener('pointerdown', e => {
        E.Audio.init();
        cv.setPointerCapture(e.pointerId);
        this.isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
        const p = { id: e.pointerId, x: e.offsetX, y: e.offsetY, x0: e.offsetX, y0: e.offsetY, t0: performance.now(), btn: e.button, moved: false };
        this.pointers.set(e.pointerId, p);
        if (this.isTouch) {
          if (this.pointers.size === 1) {
            clearTimeout(this.lpT);
            this.lpT = setTimeout(() => { if (!p.moved && this.pointers.size === 1) { p.box = true; this.box = { x0: p.x0, y0: p.y0, x1: p.x, y1: p.y }; E.haptic(15); } }, 380);
          } else { clearTimeout(this.lpT); this.box = null; for (const q of this.pointers.values()) { q.box = false; q.moved = true; } this.pinch = this.pinchState(); }
        } else if (e.button === 0 && !this.mode) { /* box starts on move */ }
      });
      cv.addEventListener('pointermove', e => {
        this.mouse = { x: e.offsetX, y: e.offsetY }; this.mouseIn = true;
        const p = this.pointers.get(e.pointerId);
        if (this.mode && this.mode.k === 'build') { const pt = this.renderer.s2w(e.offsetX, e.offsetY); this.ghost = { kind: this.mode.kind, x: pt.x, y: pt.y, ok: this.world.canPlace(this.local, this.mode.kind, pt.x, pt.y) }; }
        else if (this.mode && (this.mode.k === 'ability' || this.mode.k === 'power')) this.updateTargetPreview(e.offsetX, e.offsetY);
        if (!p) return;
        const dx = e.offsetX - p.x, dy = e.offsetY - p.y; p.x = e.offsetX; p.y = e.offsetY;
        if (Math.hypot(p.x - p.x0, p.y - p.y0) > (this.isTouch ? 10 : 6)) p.moved = true;
        if (this.isTouch) {
          if (this.pointers.size >= 2) { this.applyPinch(); return; }
          if (p.box) { this.box.x1 = p.x; this.box.y1 = p.y; return; }
          if (p.moved) { clearTimeout(this.lpT); const c = this.renderer.cam; c.x -= dx / c.z; c.y -= dy / c.z; this.renderer.clampCam(this.world); }
        } else {
          if (p.btn === 1 || (p.btn === 0 && this.keys.has(' '))) { const c = this.renderer.cam; c.x -= dx / c.z; c.y -= dy / c.z; this.renderer.clampCam(this.world); }
          else if (p.btn === 0 && p.moved && !this.mode) this.box = { x0: p.x0, y0: p.y0, x1: p.x, y1: p.y };
        }
      });
      const up = e => {
        const p = this.pointers.get(e.pointerId); if (!p) return;
        this.pointers.delete(e.pointerId); clearTimeout(this.lpT);
        if (this.isTouch) {
          if (this.pointers.size >= 1) { this.pinch = this.pinchState(); return; }
          this.pinch = null;
          if (p.box) { this.boxSelect(this.box, false); this.box = null; return; }
          if (!p.moved && e.type === 'pointerup') {
            const now = performance.now(), dbl = this.lastTap && now - this.lastTap.t < 320 && Math.hypot(this.lastTap.x - p.x, this.lastTap.y - p.y) < 28;
            this.lastTap = { t: now, x: p.x, y: p.y };
            if (this.mode && this.mode.k === 'build') { const pt = this.renderer.s2w(p.x, p.y); this.ghost = { kind: this.mode.kind, x: pt.x, y: pt.y, ok: this.world.canPlace(this.local, this.mode.kind, pt.x, pt.y) }; }
            this.clickAt(p.x, p.y, false, dbl);
          }
        } else {
          if (p.btn === 0) {
            if (this.box) { this.boxSelect(this.box, e.shiftKey); this.box = null; }
            else if (!p.moved) {
              const now = performance.now(), dbl = (this.lastClick && now - this.lastClick < 300) || e.ctrlKey; this.lastClick = now;
              this.clickAt(p.x, p.y, e.shiftKey, dbl);
            }
          } else if (p.btn === 2 && !p.moved) {
            if (this.mode) this.setMode(null); else this.smart(this.renderer.s2w(p.x, p.y));
          }
        }
      };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      cv.addEventListener('pointerleave', () => { this.mouseIn = false; });
      cv.addEventListener('wheel', e => {
        e.preventDefault(); if (!this.world) return;
        const f = Math.exp((E.Settings.invertZoom ? 1 : -1) * e.deltaY * (e.deltaMode ? 0.05 : 0.0015));
        this.zoomAt(e.offsetX, e.offsetY, f);
      }, { passive: false });
      window.addEventListener('keydown', e => this.onKey(e));
      window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
      // minimap
      const mm = $('minimap');
      const mmMove = e => { const r = mm.getBoundingClientRect(), pt = this.minimap.toWorld(this.world, e.clientX - r.left, e.clientY - r.top); this.jump(pt.x, pt.y); };
      mm.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.button === 2) { const r = mm.getBoundingClientRect(); this.smart(this.minimap.toWorld(this.world, e.clientX - r.left, e.clientY - r.top)); return; } mm.setPointerCapture(e.pointerId); this.mmDrag = true; mmMove(e); });
      mm.addEventListener('pointermove', e => { if (this.mmDrag) mmMove(e); });
      mm.addEventListener('pointerup', () => { this.mmDrag = false; });
      mm.addEventListener('contextmenu', e => e.preventDefault());
    }
    pinchState() {
      const ps = [...this.pointers.values()]; if (ps.length < 2) return null;
      const [a, b] = ps; return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
    applyPinch() {
      const s = this.pinchState(); if (!s || !this.pinch) { this.pinch = s; return; }
      const c = this.renderer.cam;
      c.x -= (s.mx - this.pinch.mx) / c.z; c.y -= (s.my - this.pinch.my) / c.z;
      if (this.pinch.d > 10) this.zoomAt(s.mx, s.my, s.d / this.pinch.d);
      this.pinch = s;
    }
    updateTargetPreview(sx, sy) {
      const pt = this.renderer.s2w(sx, sy), m = this.mode;
      if (m.k === 'ability') {
        const A = E.ABILITIES[m.ab], us = this.selUnits().filter(u => this.world.stats(u).abilities.includes(m.ab));
        const u = us[0];
        this.targetPreview = { x: pt.x, y: pt.y, r: m.ab === 'venom' ? 80 : m.ab === 'spit' ? 40 : 16, color: A.color, fromX: u && u.x, fromY: u && u.y, range: A.range };
      } else {
        const P = E.POWERS[m.id];
        this.targetPreview = { x: pt.x, y: pt.y, r: m.id === 'flare' ? 300 : m.id === 'tidecall' ? 190 : 250, color: P.color };
      }
    }
    onKey(e) {
      if (!this.running || this.root.hidden) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { if (e.key === 'Escape') e.target.blur(); return; }
      const k = e.key.toLowerCase();
      this.keys.add(k);
      const overlayOpen = !$('ov-tech').hidden || !$('ov-forge').hidden || !$('ov-pause').hidden || !$('ov-end').hidden;
      if (k === 'escape') {
        if (this.mode) this.setMode(null);
        else if (!$('ov-tech').hidden || !$('ov-forge').hidden) this.closeOverlays();
        else if (!$('ov-pause').hidden) this.resume();
        else if (this.selection.size) { this.selection.clear(); this.sheetSig = ''; this.renderSheet(); }
        else this.openPause();
        e.preventDefault(); return;
      }
      if (overlayOpen) return;
      if (k === 'enter' && this.netMode !== 'local') { this.openChat(); e.preventDefault(); return; }
      if (k === 'p' || k === 'f10') { this.openPause(); return; }
      const ctrl = e.ctrlKey || e.metaKey;
      if (/^[0-9]$/.test(k)) {
        const st = this.selStruct();
        if (ctrl) { this.groups[k] = [...this.selection]; E.toast(`Group ${k} set`); e.preventDefault(); return; }
        if (st && st.o === this.local && k !== '0' && !this.groups[k]) { this.hatchIdx(+k - 1, e.shiftKey ? 5 : 1); return; }
        const g = (this.groups[k] || []).filter(id => this.world.byId.get(id));
        if (g.length) {
          const now = performance.now();
          if (this.lastGroup === k && now - this.lastGroupT < 350) { const u = this.world.byId.get(g[0]); this.jump(u.x, u.y); }
          this.lastGroup = k; this.lastGroupT = now; this.select(g);
        } else if (st && st.o === this.local && k !== '0') this.hatchIdx(+k - 1, e.shiftKey ? 5 : 1);
        return;
      }
      const us = this.selUnits();
      if (k === 'a' && us.length) this.setMode({ k: 'amove' });
      else if (k === 'm' && us.length) this.setMode({ k: 'move' });
      else if (k === 's' && us.length) this.send({ c: 'stop', ids: us.map(u => u.id) });
      else if (k === 'h' && us.length) this.send({ c: 'hold', ids: us.map(u => u.id), x: us[0].x, y: us[0].y });
      else if (k === 'b') this.showBuild();
      else if (k === 't') this.openTech();
      else if (k === 'g') this.openForge();
      else if (k === 'f1') { e.preventDefault(); this.selectIdle(); }
      else if (k === 'f2') { e.preventDefault(); this.selectArmy(); }
      else if (k === ' ') { e.preventDefault(); if (this.lastAlert && performance.now() / 1000 - (this.alerts[this.alerts.length - 1] || { t: 0 }).t < 8) this.jump(this.lastAlert.x, this.lastAlert.y); else this.goHome(); }
      else if (k === 'tab') { e.preventDefault(); this.cycleStruct(); }
      else if (ABILITY_KEYS.includes(k) && us.length) { const abs = this.selAbilities(); const ab = abs[ABILITY_KEYS.indexOf(k)]; if (ab) this.useAbility(ab); }
    }
    goHome() { const n = this.world.s.structs.find(b => b.o === this.local && b.kind === 'nucleus') || this.world.s.structs.find(b => b.o === this.local); if (n) { this.jump(n.x, n.y); this.select([n.id]); } }
    cycleStruct() {
      const list = this.world.s.structs.filter(b => b.o === this.local && E.STRUCTS[b.kind].hatch);
      if (!list.length) return; const cur = this.selStruct(); const i = cur ? list.indexOf(cur) : -1; const n = list[(i + 1) % list.length];
      this.select([n.id]); this.jump(n.x, n.y);
    }
    selectIdle() {
      const w = this.world, idle = w.s.units.filter(u => u.o === this.local && w.stats(u).canHarvest && u.order.t === 'idle');
      if (!idle.length) { E.toast('No idle foragers'); return; }
      this.select(idle.map(u => u.id)); this.jump(idle[0].x, idle[0].y);
    }
    selectArmy() {
      const w = this.world, army = w.s.units.filter(u => u.o === this.local && !(w.stats(u).canHarvest && w.stats(u).dps < 6));
      if (!army.length) { E.toast('No army yet'); return; }
      this.select(army.map(u => u.id));
    }
    selAbilities() {
      const set = []; for (const u of this.selUnits()) for (const a of this.world.stats(u).abilities) if (!set.includes(a)) set.push(a);
      return set;
    }
    useAbility(ab) {
      const A = E.ABILITIES[ab], ids = this.selUnits().map(u => u.id);
      if (A.target === 'self') { this.send({ c: 'ability', ids, ab }); E.Audio.play('ability'); }
      else this.setMode({ k: 'ability', ab });
    }
    usePower(id) {
      const P = E.POWERS[id], me = this.me();
      if ((me.powerCd[id] || 0) > 0) { E.toast(`${P.name} is recharging`); return; }
      if (P.target === 'point') this.setMode({ k: 'power', id }); else { this.send({ c: 'power', id }); }
    }
    hatchIdx(i, n) {
      const st = this.selStruct(), me = this.me(); if (!st || !me) return;
      const list = me.designs.filter(d => !d.hidden); const d = list[i]; if (!d) return;
      this.hatch(st, d, n);
    }
    hatch(st, d, n) {
      const me = this.me(), lock = E.designLock(d, me);
      if (lock) { E.toast(lock); E.Audio.play('deny'); return; }
      const s = this.world.statsFor(this.local, d.id, 0, 0);
      if (me.lumen < s.cost || me.spore < s.spore) { E.toast('Not enough resources'); E.Audio.play('deny'); return; }
      this.send({ c: 'hatch', sid: st.id, d: d.id, n: n || 1 }); E.Audio.play('tap'); E.haptic(5);
    }

    // ── HUD ─────────────────────────────────────────────────────
    bindHud() {
      $('h-menu').onclick = () => this.openPause();
      $('f-army').onclick = () => this.selectArmy();
      $('f-idle').onclick = () => this.selectIdle();
      $('f-home').onclick = () => this.goHome();
      $('f-tech').onclick = () => this.openTech();
      $('f-forge').onclick = () => this.openForge();
      $('mm-toggle').onclick = () => { const w = $('mm-wrap'); w.classList.toggle('collapsed'); E.Settings.mmCollapsed = w.classList.contains('collapsed'); E.saveSettings(); };
      $('hint-cancel').onclick = () => this.setMode(null);
      $('sh-close').onclick = () => { this.selection.clear(); this.setMode(null); this.sheetSig = ''; this.renderSheet(); };
      $('sheet-grab').onclick = () => { $('sheet').classList.toggle('min'); this.measureSheet(); };
      document.querySelectorAll('#game [data-close]').forEach(b => (b.onclick = () => this.closeOverlays()));
      $('p-resume').onclick = () => this.resume();
      $('p-save').onclick = () => this.saveDialog();
      $('p-codex').onclick = () => { E.Menus.openCodex(true); };
      $('p-settings').onclick = () => { E.Menus.openSettings(true); };
      $('p-surrender').onclick = async () => { if (await E.confirm('Surrender?', 'Your colony will wither and the match will continue without you.', 'Surrender')) { this.send({ c: 'surrender' }); this.resume(); } };
      $('p-quit').onclick = async () => { if (this.world.s.over || await E.confirm('Quit to menu?', this.netMode === 'guest' ? 'You will leave the match.' : 'Your progress is autosaved. You can Continue from the menu.', 'Quit')) this.quit(); };
      $('end-menu').onclick = () => this.quit();
      $('end-watch').onclick = () => { $('ov-end').hidden = true; };
      $('h-chat').onclick = () => this.openChat();
      $('chat-form').onsubmit = e => {
        e.preventDefault(); const v = $('chat-input').value.trim(); $('chat-input').value = ''; $('chat-form').hidden = true;
        if (!v) return;
        const me = this.me(), name = me ? me.name : 'Spectator';
        if (this.netMode === 'guest') this.relay.toHost({ k: 'chat', text: v }); else this.chat(name, v, true);
      };
      const speeds = [0.5, 1, 1.5, 2];
      $('p-speed').innerHTML = '';
      for (const s of speeds) $('p-speed').appendChild(h('button', { 'aria-pressed': 'false', onclick: () => { this.speed = s; E.Settings.speed = s; E.saveSettings(); this.renderSpeed(); } }, s + '×'));
    }
    renderSpeed() { [...$('p-speed').children].forEach((b, i) => b.setAttribute('aria-pressed', String([0.5, 1, 1.5, 2][i] === this.speed))); $('p-speed').parentElement.hidden = this.netMode !== 'local'; }
    openChat() { $('chat').hidden = false; $('chat-form').hidden = false; $('chat-input').focus(); }
    openPause() {
      $('ov-pause').hidden = false; this.renderSpeed();
      $('p-save').hidden = this.netMode === 'guest';
      $('pause-note').textContent = this.netMode === 'guest' ? 'The match continues while this menu is open.' : '';
      if (this.netMode !== 'guest') { this.paused = true; if (this.netMode === 'host') this.relay.send('all', { k: 'pause', on: true }); }
    }
    resume() { $('ov-pause').hidden = true; this.paused = false; if (this.netMode === 'host') this.relay.send('all', { k: 'pause', on: false }); }
    async saveDialog() {
      const list = E.Saves.list().filter(s => s.id !== 'auto');
      const name = await E.prompt('Name this save', `${E.CULTURES[this.me() ? this.me().culture : 'verdant'].short} · ${E.fmtTime(this.world.s.t)}`);
      if (name === null) return;
      const slot = (list.find(s => s.name === name) || {}).id || E.Saves.freeSlot();
      const ok = E.Saves.write(slot, this.world, { local: this.local, name, mp: this.netMode === 'host' });
      E.toast(ok ? 'Saved' : 'Could not save (storage full?)');
      if (!ok) return;
      const blob = E.Saves.exportBlob(this.world, { local: this.local, name });
      if (await E.confirm('Saved', 'Also download a copy of this save as a file?', 'Download')) {
        const a = h('a', { href: URL.createObjectURL(blob), download: `efflorescent-${name.replace(/[^\w-]+/g, '_')}.json` }); document.body.appendChild(a); a.click(); a.remove();
      }
    }
    openTech() { $('ov-tech').hidden = false; this.tech.open(); }
    openForge() {
      $('ov-forge').hidden = false;
      if (!this.forge || this.forgeWorld !== this.world) {
        this.forgeWorld = this.world;
        this.forge = new E.Forge($('forge-game'), { mode: 'game', getPlayer: () => this.me(), onSave: d => { this.send({ c: 'design', design: d }); E.toast(`“${d.name}” added to your hatcheries`); E.Audio.play('research'); this.sheetSig = ''; setTimeout(() => this.forge.renderLib(), 300); } });
      } else this.forge.renderAll();
    }
    closeOverlays() { $('ov-tech').hidden = true; $('ov-forge').hidden = true; }
    quit(silent) {
      this.stop();
      E.Menus.home();
    }
    onOver() {
      this.ended = true;
      const w = this.world, s = w.s, me = this.me();
      const won = me && s.winner !== null && w.teamOf(this.local) === s.winner;
      $('end-title').textContent = won ? 'Efflorescence' : me ? 'Your light goes out' : 'The tide settles';
      $('end-title').style.color = won ? 'var(--pc1)' : '#ff9a9a';
      const winners = s.players.filter(p => s.winner !== null && w.teamOf(p.idx) === s.winner).map(p => p.name).join(', ');
      $('end-text').textContent = winners ? `Victory to ${winners} after ${E.fmtTime(s.t)}.` : `The Dreamscape falls dark after ${E.fmtTime(s.t)}.`;
      const rows = s.players.map(p => { const c = E.CULTURES[p.culture]; return `<tr><td><span style="color:${c.hex[1]}">●</span> ${E.esc(p.name)}${p.idx === this.local ? ' (you)' : ''}</td><td>${p.alive ? 'Alive' : 'Gone'}</td><td>${p.stats.hatched}</td><td>${p.stats.kills}</td><td>${p.stats.lost}</td><td>${Math.round(p.stats.gathered)}</td><td>${Math.round(p.stats.spore)}</td><td>${p.stats.evolved || 0}</td></tr>`; }).join('');
      $('end-stats').innerHTML = `<tr><th>Culture</th><th>State</th><th>Hatched</th><th>Kills</th><th>Lost</th><th>Lumen</th><th>Spore</th><th>Evolutions</th></tr>${rows}`;
      E.Audio.play(won ? 'victory' : 'defeat');
      if (this.netMode !== 'guest') E.Saves.remove('auto');
      setTimeout(() => { $('ov-end').hidden = false; }, 1800);
    }
    updateHud() {
      const w = this.world, me = this.me();
      $('h-clock').textContent = E.fmtTime(w.s.t);
      if (me) {
        $('h-lumen').textContent = Math.floor(me.lumen); $('h-spore').textContent = Math.floor(me.spore);
        const pop = w.popOf(this.local); $('h-pop').textContent = `${pop.used}/${pop.cap}`;
        $('h-pop-chip').classList.toggle('warn', pop.used >= pop.cap);
        $('h-fever').style.width = (me.fever * 100) + '%';
        const idle = w.s.units.filter(u => u.o === this.local && u.order.t === 'idle' && w.stats(u).canHarvest).length;
        $('f-idle-n').hidden = !idle; $('f-idle-n').textContent = idle;
        $('f-tech-n').hidden = !me.research.length; $('f-tech-n').textContent = me.research.length;
      }
      // drop dead selections
      let changed = false;
      for (const id of this.selection) { const e = w.byId.get(id); if (!e || e.hp <= 0) { this.selection.delete(id); changed = true; } }
      if (changed) this.sheetSig = '';
      if (this.waiting) $('sh-title').textContent = 'Connecting…';
      this.renderSheet(true);
    }

    // ── command sheet ───────────────────────────────────────────
    measureSheet() { requestAnimationFrame(() => { const sh = $('sheet'); if (sh) document.documentElement.style.setProperty('--sheet-h', sh.offsetHeight + 'px'); }); }
    renderSheet(tick) {
      const w = this.world; if (!w) return;
      const me = this.me();
      const us = this.selUnits(), st = this.selStruct();
      let kind = 'colony';
      if (this.buildMenu) kind = 'build';
      else if (us.length) kind = 'units';
      else if (st) kind = st.o === this.local ? 'struct' : 'enemyStruct';
      else if (this.selection.size === 1) { const e = w.byId.get([...this.selection][0]); if (e && e.kind === undefined) kind = 'enemyUnit'; }
      const sig = kind + ':' + [...this.selection].join(',') + ':' + (me ? me.designs.length + ':' + me.techVer + ':' + me.specials.length : '');
      if (sig !== this.sheetSig) { this.sheetSig = sig; this.buildSheet(kind, us, st); }
      else if (tick) this.tickSheet(kind, us, st);
    }
    buildSheet(kind, us, st) {
      const body = $('sh-body'), w = this.world, me = this.me();
      body.innerHTML = ''; this.dyn = [];
      $('sh-close').hidden = kind === 'colony';
      const cmd = (glyph, label, key, onclick, extra) => { const b = h('button', Object.assign({ class: 'cmd', onclick: e => { E.Audio.init(); onclick(e); } }, extra || {}), h('b', null, glyph), h('span', null, label), key ? h('kbd', null, key) : null); return b; };
      if (!me) { $('sh-title').textContent = 'Spectating'; $('sh-sub').textContent = ''; body.appendChild(h('p', { style: 'margin:0;color:var(--ink-soft)' }, 'Your colony is gone. You can keep watching the match.')); this.measureSheet(); return; }
      if (kind === 'colony') {
        $('sh-title').textContent = E.CULTURES[me.culture].name; $('sh-sub').textContent = '';
        const row = h('div', { class: 'hrow' },
          cmd('⌂', 'Hatch', 'Space', () => this.goHome()),
          cmd('⧉', 'Evolve', 'T', () => this.openTech()),
          cmd('⬡', 'Build', 'B', () => this.showBuild()),
          cmd('✎', 'Forge', 'G', () => this.openForge()),
          cmd('⚔', 'Army', 'F2', () => this.selectArmy()),
          cmd('◌', 'Idle', 'F1', () => this.selectIdle()));
        body.appendChild(row);
        const actives = me.specials.filter(id => E.POWERS[id].kind === 'active');
        const passives = me.specials.filter(id => E.POWERS[id].kind === 'passive');
        body.appendChild(h('div', { class: 'sec-l' }, 'Colony powers'));
        if (!me.specials.length) body.appendChild(h('div', { style: 'font-size:.84em;color:var(--ink-dim)' }, 'Evolve powers on the tech tree (⧉ → Powers).'));
        if (actives.length) {
          const pr = h('div', { class: 'hrow' });
          for (const id of actives) { const P = E.POWERS[id]; const b = cmd(P.glyph, P.name, null, () => this.usePower(id), { style: `color:${P.color}` }); b.appendChild(h('i', { class: 'cd' })); pr.appendChild(b); this.dyn.push({ k: 'power', id, el: b }); }
          body.appendChild(pr);
        }
        if (passives.length) body.appendChild(h('div', { class: 'tags' }, passives.map(id => h('span', { class: 'tag', title: E.POWERS[id].desc }, E.POWERS[id].glyph + ' ' + E.POWERS[id].name))));
      } else if (kind === 'build') {
        $('sh-title').textContent = 'Plant a structure'; $('sh-sub').textContent = us.length ? 'nearest selected creature plants it' : 'nearest forager plants it';
        const row = h('div', { class: 'hrow' });
        for (const k of ['bud', 'spire']) {
          const sd = E.STRUCTS[k];
          const b = cmd(k === 'bud' ? '❀' : '✷', `${sd.name} ◆${sd.cost.l}${sd.cost.s ? ' ✦' + sd.cost.s : ''}`, null, () => { this.buildMenu = false; this.setMode({ k: 'build', kind: k }); this.sheetSig = ''; });
          b.style.minWidth = '120px'; row.appendChild(b); this.dyn.push({ k: 'afford', el: b, cost: sd.cost });
        }
        row.appendChild(cmd('✕', 'Cancel', 'Esc', () => { this.buildMenu = false; this.sheetSig = ''; this.renderSheet(); }));
        body.appendChild(row);
        body.appendChild(h('div', { style: 'font-size:.82em;color:var(--ink-soft)' }, E.STRUCTS.bud.desc + ' ' + E.STRUCTS.spire.desc));
      } else if (kind === 'units') {
        const groups = new Map(); for (const u of us) { const g = groups.get(u.d) || []; g.push(u); groups.set(u.d, g); }
        const d0 = w.designOf(this.local, us[0].d);
        $('sh-title').textContent = us.length === 1 ? d0.name : `${us.length} creatures`;
        $('sh-sub').textContent = us.length === 1 ? w.stats(us[0]).role : `${groups.size} design${groups.size > 1 ? 's' : ''}`;
        if (groups.size > 1 || us.length > 1) {
          const gr = h('div', { class: 'groups' });
          for (const [d, list] of groups) {
            const cv = h('canvas'); const des = w.designOf(this.local, d);
            gr.appendChild(h('button', { class: 'grp', onclick: () => this.select(list.map(u => u.id)), title: des.name }, cv, h('span', null, des.name), h('b', null, '×' + list.length)));
            requestAnimationFrame(() => E.drawPortrait(cv, des, me.culture, me.tier, 0.5, { zoom: 1.3 }));
          }
          body.appendChild(gr);
        }
        const canHarv = us.some(u => w.stats(u).canHarvest);
        const cmds = h('div', { class: 'hrow' },
          cmd('➤', 'Attack', 'A', () => this.setMode({ k: 'amove' })),
          cmd('↗', 'Move', 'M', () => this.setMode({ k: 'move' })),
          cmd('■', 'Stop', 'S', () => this.send({ c: 'stop', ids: this.selUnits().map(u => u.id) })),
          cmd('⛉', 'Hold', 'H', () => { const s = this.selUnits(); this.send({ c: 'hold', ids: s.map(u => u.id), x: s[0].x, y: s[0].y }); }),
          canHarv ? cmd('◆', 'Harvest', null, () => { const f = this.selUnits().filter(u => w.stats(u).canHarvest); const r = w.nearestPool(f[0], 'lumen'); if (r) this.send({ c: 'harvest', ids: f.map(u => u.id), rid: r.id }); }) : null,
          canHarv ? cmd('✦', 'Spore', null, () => { const f = this.selUnits().filter(u => w.stats(u).canHarvest); const r = w.nearestPool(f[0], 'spore'); if (r) this.send({ c: 'harvest', ids: f.map(u => u.id), rid: r.id }); else E.toast('No spore beds nearby'); }) : null,
          cmd('⬡', 'Build', 'B', () => this.showBuild()));
        body.appendChild(cmds);
        const abs = this.selAbilities();
        if (abs.length) {
          body.appendChild(h('div', { class: 'sec-l' }, 'Abilities · long-press to toggle auto-cast'));
          const ar = h('div', { class: 'hrow' });
          abs.forEach((ab, i) => {
            const A = E.ABILITIES[ab];
            const b = cmd(A.glyph, A.name, ABILITY_KEYS[i] ? ABILITY_KEYS[i].toUpperCase() : null, () => this.useAbility(ab), { style: `color:${A.color}`, title: A.desc });
            b.appendChild(h('i', { class: 'cd' }));
            let lp; const toggle = () => { const on = !!me.autocast[ab]; this.send({ c: 'autocast', ab, on }); E.toast(`Auto-cast ${A.name}: ${on ? 'on' : 'off'}`); E.haptic(12); };
            b.addEventListener('contextmenu', e => { e.preventDefault(); toggle(); });
            b.addEventListener('pointerdown', () => { lp = setTimeout(() => { toggle(); b._skip = true; }, 500); });
            b.addEventListener('pointerup', () => clearTimeout(lp)); b.addEventListener('pointerleave', () => clearTimeout(lp));
            b.addEventListener('click', e => { if (b._skip) { b._skip = false; e.stopImmediatePropagation(); } }, true);
            ar.appendChild(b); this.dyn.push({ k: 'ability', ab, el: b });
          });
          body.appendChild(ar);
        }
        if (us.length === 1) body.appendChild(this.infoGrid(us[0]));
      } else if (kind === 'struct' || kind === 'enemyStruct') {
        const sd = E.STRUCTS[st.kind], owner = w.s.players[st.o];
        $('sh-title').textContent = (kind === 'enemyStruct' ? owner.name + ' · ' : '') + sd.name;
        this.dyn.push({ k: 'shp', st });
        $('sh-sub').textContent = '';
        if (kind === 'struct' && st.build < 1) body.appendChild(h('div', { style: 'color:var(--ink-soft)' }, 'Growing…'));
        else if (kind === 'struct' && sd.hatch) {
          const designs = me.designs.filter(d => !d.hidden);
          const grid = h('div', { class: 'hatch-grid' });
          designs.forEach((d, i) => {
            const cv = h('canvas'); const lock = E.designLock(d, me); const s = w.statsFor(this.local, d.id, 0, 0);
            const card = h('button', { class: 'hcard', title: `${d.name}: ${d.organs.map(o => E.ORGANS[o].name).join(', ')}`, onclick: e => this.hatch(st, d, e.shiftKey ? 5 : 1) },
              cv, h('b', null, (i < 9 ? (i + 1) + ' · ' : '') + d.name), h('span', null, `◆${s.cost}${s.spore ? ' ✦' + s.spore : ''} · ${s.hatch.toFixed(0)}s`), h('span', { class: 'role' }, s.role), lock ? h('div', { class: 'lock' }, '🔒 ' + lock) : null);
            let lp; card.addEventListener('pointerdown', () => { lp = setTimeout(() => { this.hatch(st, d, 5); card._skip = true; }, 550); });
            card.addEventListener('pointerup', () => clearTimeout(lp)); card.addEventListener('pointerleave', () => clearTimeout(lp));
            card.addEventListener('click', e => { if (card._skip) { card._skip = false; e.stopImmediatePropagation(); } }, true);
            grid.appendChild(card); this.dyn.push({ k: 'hcard', el: card, s, lock });
            requestAnimationFrame(() => E.drawPortrait(cv, d, me.culture, me.tier, 0.6));
          });
          body.appendChild(h('div', { class: 'sec-l' }, 'Hatch · long-press or Shift for ×5'));
          body.appendChild(grid);
          const q = h('div', { class: 'queue' }); this.dyn.push({ k: 'queue', el: q, st }); body.appendChild(q);
          body.appendChild(h('div', { class: 'hrow' },
            cmd('⚑', 'Rally', null, () => this.setMode({ k: 'rally' })),
            cmd('⧉', 'Evolve', 'T', () => this.openTech()),
            cmd('✎', 'Forge', 'G', () => this.openForge()),
            cmd('⇥', 'Next', 'Tab', () => this.cycleStruct())));
        } else if (kind === 'enemyStruct') body.appendChild(h('div', { style: 'color:var(--ink-soft);font-size:.86em' }, E.CULTURES[owner.culture].name));
      } else if (kind === 'enemyUnit') {
        const u = w.byId.get([...this.selection][0]); const owner = w.s.players[u.o];
        $('sh-title').textContent = owner.name + ' · ' + w.designOf(u.o, u.d).name; $('sh-sub').textContent = w.stats(u).role;
        body.appendChild(this.infoGrid(u));
      }
      this.tickSheet(kind, us, st);
      this.measureSheet();
    }
    infoGrid(u) {
      const w = this.world, s = w.stats(u), d = w.designOf(u.o, u.d);
      const g = h('div', { class: 'info-grid' });
      const add = (k, v) => g.appendChild(h('div', null, h('span', null, k), h('b', null, v)));
      add('HP', `${Math.ceil(u.hp)}/${s.hp}`); add('Armor', Math.round(s.armor * 100) + '%'); add('Speed', Math.round(s.speed));
      if (s.shot) add('Ranged', `${s.shot.toFixed(0)}/${s.shotCd}s`); else add('Bite', s.dps.toFixed(1) + '/s');
      add('Reach', Math.round(s.shot ? s.shotRange : s.range)); add('Sense', Math.round(s.sense));
      if (s.harvest) add('Harvest', s.harvest.toFixed(1)); add('Rank', '▲'.repeat(u.rank || 0) || '—');
      const wrap = h('div', null, g, h('div', { class: 'tags', style: 'margin-top:6px' }, [E.CHASSIS[d.chassis].name, ...d.organs.map(o => E.ORGANS[o].name)].map(t => h('span', { class: 'tag' }, t))));
      return wrap;
    }
    tickSheet(kind, us, st) {
      const w = this.world, me = this.me(); if (!me || !this.dyn) return;
      for (const d of this.dyn) {
        if (d.k === 'power') { const P = E.POWERS[d.id], cd = me.powerCd[d.id] || 0; d.el.querySelector('.cd').style.setProperty('--cd', cd / P.cd); d.el.disabled = (P.useLumen || 0) > me.lumen || (P.useSpore || 0) > me.spore; }
        else if (d.k === 'ability') {
          let best = Infinity, maxCd = E.ABILITIES[d.ab].cd;
          for (const u of this.selUnits()) if (w.stats(u).abilities.includes(d.ab)) best = Math.min(best, (u.cds && u.cds[d.ab]) || 0);
          d.el.querySelector('.cd').style.setProperty('--cd', best === Infinity ? 0 : best / maxCd);
          d.el.classList.toggle('auto', !me.autocast[d.ab]);
        } else if (d.k === 'hcard') d.el.disabled = !!d.lock || me.lumen < d.s.cost || me.spore < d.s.spore;
        else if (d.k === 'afford') d.el.disabled = me.lumen < d.cost.l || me.spore < d.cost.s;
        else if (d.k === 'shp') $('sh-sub').textContent = `${Math.ceil(d.st.hp)} / ${E.STRUCTS[d.st.kind].hp}` + (d.st.build < 1 ? ` · ${Math.round(d.st.build * 100)}%` : '');
        else if (d.k === 'queue') {
          const q = d.st.queue, el = d.el, sig = q.map(x => x.d).join();
          if (el._sig !== sig) {
            el._sig = sig; el.innerHTML = '';
            q.forEach((item, i) => {
              const cv = h('canvas'); const des = w.designOf(this.local, item.d);
              el.appendChild(h('button', { class: 'qitem', title: 'Cancel ' + des.name, onclick: () => this.send({ c: 'cancel', sid: d.st.id, i }) }, cv, h('i')));
              requestAnimationFrame(() => E.drawPortrait(cv, des, me.culture, me.tier, 0.4, { zoom: 1.4 }));
            });
          }
          if (q[0] && el.firstChild) el.firstChild.querySelector('i').style.width = (q[0].t / q[0].dur * 100) + '%';
        }
      }
    }
    showBuild() { this.buildMenu = true; this.sheetSig = ''; this.renderSheet(); }
  }
  E.Game = Game;
})(window.E);
