// Bot minds. Bots play through the same command interface as humans.
(function (E) {
  'use strict';
  const AI = {};

  const GENERIC_RESEARCH = ['tier:mandible:1', 'tier:leg:1', 'chassis:carapace', 'power:frenzy', 'tier:flagella:1', 'form:pincers', 'power:chitin',
    'tier:mandible:2', 'chassis:ctenophore', 'form:nematocyst', 'tier:antenna:1', 'form:eyestalks', 'power:bloom', 'tier:leg:2', 'form:horns', 'chassis:medusa',
    'power:hunger', 'tier:mandible:3', 'form:sporesacs', 'power:metamorph', 'chassis:siphonophore', 'tier:leg:3', 'power:apex', 'chassis:nautiloid', 'power:tidecall', 'tier:pili:1'];

  function mineOf(w, p) {
    const s = w.s, units = [], structs = [];
    for (const u of s.units) if (u.o === p.idx) units.push(u);
    for (const b of s.structs) if (b.o === p.idx) structs.push(b);
    return { units, structs };
  }
  function isForager(w, u) { const st = w.stats(u); return st.canHarvest && st.dps < 6 && !st.shot; }

  AI.ensureDesigns = function (w, p) {
    const cmd = c => w.command(p.idx, c);
    for (const t of E.AI_TEMPLATES) {
      if (t.needs && !p.forms.includes(t.needs)) continue;
      const ch = t.chassis.find(c => p.chassis.includes(c)); if (!ch) continue;
      const slots = E.CHASSIS[ch].slots;
      const organs = [];
      for (const opts of t.slots) { if (organs.length >= slots) break; const o = opts.find(x => p.forms.includes(x)); if (o) organs.push(o); }
      if (!organs.length) continue;
      const sig = ch + ':' + organs.join(',');
      if (p.designs.some(d => d.chassis + ':' + d.organs.join(',') === sig)) continue;
      cmd({ c: 'design', design: { name: t.name, chassis: ch, organs } });
      return; // one per think, keeps ids predictable
    }
  };

  AI.armyDesigns = function (w, p) {
    return p.designs.filter(d => {
      if (d.role === 'harvest' || E.designLock(d, p)) return false;
      const st = w.statsFor(p.idx, d.id, 0, 0);
      return st.dps >= 5 || st.shot;
    });
  };

  AI.tick = function (w, p) {
    const s = w.s, diff = E.DIFFS[p.diff], ai = p.ai, cmd = c => w.command(p.idx, c);
    if (ai.wave === undefined) { ai.wave = diff.wave[0]; ai.mode = 'build'; ai.lastDesign = 0; }
    const { units, structs } = mineOf(w, p);
    const nucleus = structs.find(b => b.kind === 'nucleus') || structs[0];
    if (!nucleus) return;
    const hatcheries = structs.filter(b => b.build >= 1 && E.STRUCTS[b.kind].hatch);
    const foragers = units.filter(u => isForager(w, u));
    const army = units.filter(u => !isForager(w, u) && !u.apex);
    const pop = w.popOf(p.idx);
    const queued = hatcheries.reduce((n, b) => n + b.queue.length, 0);
    const queuedF = hatcheries.reduce((n, b) => n + b.queue.filter(q => q.d === 'forager' || q.d === 'sig' && E.SIGNATURES[p.culture].role === 'harvest').length, 0);
    const buds = structs.filter(b => b.kind === 'bud');

    // Designs
    if (s.t - ai.lastDesign > 15) { ai.lastDesign = s.t; AI.ensureDesigns(w, p); }

    // Idle foragers back to work
    for (const u of foragers) if (u.order.t === 'idle' && !u.cargo) {
      const r = w.nearestPool(u, p.spore < 60 && s.t > 180 && (u.id % 4 === 0) ? 'spore' : 'lumen');
      if (r) cmd({ c: 'harvest', ids: [u.id], rid: r.id });
    }
    // Keep some foragers on spore
    if (s.t > 120 && foragers.length >= 6 && !foragers.some(u => { const r = w.byId.get(u.order.rid); return r && r.kind === 'spore'; })) {
      const u = foragers[foragers.length - 1], r = w.nearestPool(u, 'spore');
      if (r) cmd({ c: 'harvest', ids: [u.id], rid: r.id });
    }

    // Research
    const lanes = Math.min(3, 1 + buds.filter(b => b.build >= 1).length);
    if (p.research.length < lanes) {
      const list = E.CULTURES[p.culture].aiResearch.concat(GENERIC_RESEARCH);
      for (const key of list) {
        const t = E.TECHS[key]; if (!t || t.have(p) || p.research.some(r => r.key === key) || !t.req(p)) continue;
        const c = w.techCost(p, t);
        if (p.lumen >= c.l + 60 && p.spore >= c.s) { cmd({ c: 'research', key }); break; }
        if (c.s > p.spore) continue; // wait on spore without blocking other techs
        break;
      }
    }

    // Economy
    const want = Math.min(34, 7 + buds.length * 5 + (p.culture === 'verdant' ? 3 : 0));
    const hatch = (d) => {
      let b = null; for (const h of hatcheries) if (!b || h.queue.length < b.queue.length) b = h;
      if (b && b.queue.length < 3) cmd({ c: 'hatch', sid: b.id, d });
    };
    if (pop.used + queued < pop.cap && queued < hatcheries.length * 2) {
      const underThreat = ai.mode === 'defend' && army.length < 12;
      if (foragers.length + queuedF < want && !underThreat) {
        const useSig = E.SIGNATURES[p.culture].role === 'harvest' && !E.designLock(E.SIGNATURES[p.culture], p) && foragers.length > 4 && p.lumen > 120;
        hatch(useSig ? 'sig' : 'forager');
      } else {
        const opts = AI.armyDesigns(w, p);
        if (opts.length) {
          const recent = opts.slice(-3);
          const d = recent[Math.floor(w.rand() * recent.length)];
          const st = w.statsFor(p.idx, d.id, 0, 0);
          if (p.lumen >= st.cost + 40 && p.spore >= st.spore) hatch(d.id);
        }
      }
    }

    // Expansion
    const maxBuds = Math.min(4, Math.floor(s.t / 240) + (s.t > 150 ? 1 : 0));
    const pendingBuild = units.some(u => u.order.t === 'build');
    if (!pendingBuild && buds.length < maxBuds && p.lumen > 190 && foragers.length >= 5) {
      let best = null, bd = Infinity;
      for (const r of s.pools) {
        if (r.kind !== 'lumen' || r.amt < 300) continue;
        if (s.structs.some(b => E.dist2(b.x, b.y, r.x, r.y) < 520 * 520)) continue;
        if (s.structs.some(b => w.isEnemy(p.idx, b.o) && E.dist2(b.x, b.y, r.x, r.y) < 900 * 900)) continue;
        const d = E.dist(r, nucleus); if (d < bd) { bd = d; best = r; }
      }
      if (best) {
        const a = Math.atan2(nucleus.y - best.y, nucleus.x - best.x);
        const x = best.ax + Math.cos(a) * 110, y = best.ay + Math.sin(a) * 110;
        if (w.canPlace(p.idx, 'bud', x, y)) {
          const u = foragers.reduce((m, f) => (!m || E.dist2(f.x, f.y, x, y) < E.dist2(m.x, m.y, x, y) ? f : m), null);
          if (u) cmd({ c: 'build', ids: [u.id], kind: 'bud', x, y });
        }
      }
    }
    // Spires
    const spires = structs.filter(b => b.kind === 'spire').length;
    if (!pendingBuild && s.t > 240 && spires < Math.min(3, buds.length + 1) && p.lumen > 260 && p.spore >= 20 && foragers.length) {
      const base = structs.filter(b => b.kind !== 'spire')[spires % Math.max(1, structs.filter(b => b.kind !== 'spire').length)];
      const a = Math.atan2(s.map.h / 2 - base.y, s.map.w / 2 - base.x) + (w.rand() - 0.5);
      const x = base.x + Math.cos(a) * 150, y = base.y + Math.sin(a) * 150;
      if (w.canPlace(p.idx, 'spire', x, y)) cmd({ c: 'build', ids: [foragers[0].id], kind: 'spire', x, y });
    }

    // Military
    let threat = null;
    for (const e of s.units) {
      if (!w.isEnemy(p.idx, e.o) || e.hp <= 0) continue;
      for (const b of structs) if (E.dist2(b.x, b.y, e.x, e.y) < 480 * 480) { threat = e; break; }
      if (threat) break;
    }
    const ids = army.map(u => u.id);
    if (p.apex && w.byId.get(p.apex)) ids.push(p.apex);
    if (threat && ids.length) {
      cmd({ c: 'amove', ids: army.filter(u => u.order.t !== 'attack').map(u => u.id), x: threat.x, y: threat.y });
      if (p.specials.includes('tidecall') && !(p.powerCd.tidecall > 0) && w.enemiesNear(p.idx, threat.x, threat.y, 200).length >= 5) cmd({ c: 'power', id: 'tidecall', x: threat.x, y: threat.y });
      ai.mode = 'defend';
    } else {
      if (ai.mode === 'defend') { ai.mode = 'build'; if (ids.length) cmd({ c: 'amove', ids, x: nucleus.rally.x, y: nucleus.rally.y }); }
      if (ai.mode === 'attack') {
        const tgt = w.byId.get(ai.target);
        if (army.length < Math.max(2, ai.wave * 0.3)) { ai.mode = 'build'; cmd({ c: 'amove', ids, x: nucleus.rally.x, y: nucleus.rally.y }); }
        else if (!tgt || tgt.hp <= 0) { ai.target = AI.pickTarget(w, p, army); const t2 = w.byId.get(ai.target); if (t2) cmd({ c: 'amove', ids, x: t2.x, y: t2.y }); }
        else {
          const idle = army.filter(u => u.order.t === 'idle').map(u => u.id);
          if (idle.length) cmd({ c: 'amove', ids: idle, x: tgt.x, y: tgt.y });
          const near = army.filter(u => E.dist2(u.x, u.y, tgt.x, tgt.y) < 400 * 400).length;
          if (near >= 5) {
            if (p.specials.includes('frenzy') && !(p.powerCd.frenzy > 0) && p.fever < 0.3) cmd({ c: 'power', id: 'frenzy' });
            if (p.specials.includes('bloom') && !(p.powerCd.bloom > 0) && p.spore >= 20) {
              const hurt = army.filter(u => u.hp < w.stats(u).hp * 0.55);
              if (hurt.length >= 4) cmd({ c: 'power', id: 'bloom', x: hurt[0].x, y: hurt[0].y });
            }
          }
          if (p.specials.includes('flare') && !(p.powerCd.flare > 0)) cmd({ c: 'power', id: 'flare', x: tgt.x, y: tgt.y });
        }
      } else if (army.length >= ai.wave && s.t > diff.first) {
        ai.target = AI.pickTarget(w, p, army);
        const t = w.byId.get(ai.target);
        if (t) { ai.mode = 'attack'; ai.wave = Math.min(diff.wave[1], ai.wave + 3); cmd({ c: 'amove', ids, x: t.x, y: t.y }); }
      } else {
        // gather idle army at rally; grab nearby powerups
        const stray = army.filter(u => u.order.t === 'idle' && E.dist2(u.x, u.y, nucleus.rally.x, nucleus.rally.y) > 300 * 300).map(u => u.id);
        if (stray.length) cmd({ c: 'amove', ids: stray, x: nucleus.rally.x, y: nucleus.rally.y });
        for (const k of s.pickups) {
          if (!structs.some(b => E.dist2(b.x, b.y, k.x, k.y) < 900 * 900)) continue;
          const u = army.find(u => u.order.t === 'idle');
          if (u) { cmd({ c: 'move', ids: [u.id], x: k.x, y: k.y }); break; }
        }
      }
    }
    if (p.specials.includes('apex') && !(p.powerCd.apex > 0) && p.lumen > 360 && p.spore > 110 && !(p.apex && w.byId.get(p.apex))) cmd({ c: 'power', id: 'apex' });
  };

  AI.pickTarget = function (w, p, army) {
    let cx = 0, cy = 0; for (const u of army) { cx += u.x; cy += u.y; } cx /= army.length || 1; cy /= army.length || 1;
    let best = null, bd = Infinity;
    for (const b of w.s.structs) {
      if (!w.isEnemy(p.idx, b.o)) continue;
      const d = E.dist2(b.x, b.y, cx, cy) * (b.kind === 'spire' ? 1.6 : 1);
      if (d < bd) { bd = d; best = b; }
    }
    return best ? best.id : 0;
  };

  AI.micro = function () {};
  E.AI = AI;
})(typeof window !== 'undefined' ? window.E : globalThis.E);
