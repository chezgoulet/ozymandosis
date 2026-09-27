// Anatomy → numbers. Used by the sim, the Forge and the hatch menus.
(function (E) {
  'use strict';

  // design: {chassis, organs:[organId]}; ctx: {tier:{cls:lvl}, culture, specials:[], rank, elite}
  // opts.v overrides per-organ variant (the Forge preview).
  E.computeStats = function (design, ctx, opts) {
    ctx = ctx || {};
    const ch = E.CHASSIS[design.chassis] || E.CHASSIS.serpent;
    const cult = E.CULTURES[ctx.culture];
    const m = cult ? cult.mods : null;
    const specials = ctx.specials || [];
    const s = {
      hp: ch.hp, armor: ch.armor || 0, speed: ch.speed, turn: ch.turn, size: ch.size, sense: ch.sense,
      dps: 1.2, range: 10, harvest: 0, cargo: 0, evasion: ch.evasion || 0, regen: ch.regen || 0, sting: ch.sting || 0,
      slowOnHit: 0, thorns: 0, leech: 0, bleed: 0, poison: 0, pierce: 0, detect: 55, vision: 0, aura: 0, lure: 0, sporeBonus: 0,
      shot: 0, shotRange: 0, shotCd: 0, shotRangeBonus: 0,
      cost: ch.cost, spore: ch.spore, hatch: ch.hatch, abilities: [], chassis: ch.id, slots: ch.slots,
    };
    if (ch.ability) s.abilities.push(ch.ability);
    const organs = (design.organs || []).slice(0, ch.slots);
    organs.forEach((id, i) => {
      const o = E.ORGANS[id]; if (!o) return;
      const v = opts && opts.v ? opts.v[i] : E.TIER_V[(ctx.tier && ctx.tier[o.cls]) || 0];
      const d = o.stats(v);
      for (const k in d) {
        if (k === 'range') s.range = Math.max(s.range, d[k]);
        else if (k === 'slowOnHit' || k === 'pierce' || k === 'lure' || k === 'aura' || k === 'shotCd') s[k] = Math.max(s[k], d[k]);
        else if (k === 'detect') s.detect = Math.max(s.detect, d[k]);
        else if (k === 'shotRange') s.shotRange = Math.max(s.shotRange, d[k]);
        else s[k] = (s[k] || 0) + d[k];
      }
      if (o.ability && !s.abilities.includes(o.ability)) s.abilities.push(o.ability);
      if (!ch.hero) { s.cost += 14 + 2 * v; if (o.form >= 4) s.spore += 5; }
      s.hatch += 0.5;
    });
    if (s.shot) s.shotRange += s.shotRangeBonus;
    s.armor = Math.min(0.75, s.armor);
    s.evasion = Math.min(0.5, s.evasion);
    if (m) {
      s.hp *= m.hp; s.speed *= m.speed; s.dps *= m.attack; s.shot *= m.attack; s.harvest *= m.harvest; s.sense *= m.sense;
      s.cost = Math.round(s.cost * m.cost); s.spore = Math.round(s.spore * m.cost); s.hatch *= m.hatch;
      if (cult.lifespan && !ch.hero) s.lifespan = cult.lifespan;
    }
    if (specials.includes('chitin')) s.armor = Math.min(0.75, s.armor + 0.1);
    if (specials.includes('hivemind')) { s.sense *= 1.3; s.detect += 60; }
    s.vision += s.sense * 1.25 + 40;
    const rank = ctx.rank || 0, rk = specials.includes('metamorph') ? 0.18 : 0.12;
    s.hp *= 1 + rank * rk; s.dps *= 1 + rank * rk; s.shot *= 1 + rank * rk;
    if (ctx.elite) { s.hp *= 2; s.dps *= 1.3; s.size *= 1.15; }
    s.speed = Math.max(14, s.speed);
    s.hp = Math.max(10, Math.round(s.hp));
    s.canHarvest = s.harvest > 0;
    s.role = E.roleOf(s, design);
    return s;
  };

  E.roleOf = function (s, design) {
    if (design && design.chassis === 'leviathan') return 'Apex';
    if (s.harvest >= 6 && s.dps < 6) return 'Harvester';
    const sc = [
      ['Artillery', s.shot ? 2 + s.shot / 10 : 0],
      ['Brawler', (s.dps - 1.2) / 8],
      ['Bulwark', (s.hp - 50) / 70 + s.armor * 2],
      ['Skirmisher', (s.speed - 50) / 30],
      ['Seeker', (s.sense - 110) / 70 + (s.detect > 100 ? 0.8 : 0)],
      ['Support', s.abilities.some(a => a === 'mend' || a === 'warsong') ? 1.1 : 0],
      ['Harvester', s.harvest / 8],
    ].sort((a, b) => b[1] - a[1]);
    return sc[0][1] > 0 ? sc[0][0] : 'Drifter';
  };

  // Is a design buildable with this player's unlocks? Returns null or a reason.
  E.designLock = function (design, p) {
    if (design.id && design.id[0] === '_') return null;
    const ch = E.CHASSIS[design.chassis];
    if (!ch || ch.hero) return 'Unknown chassis';
    if (!p.chassis.includes(design.chassis)) return `${ch.name} not evolved`;
    for (const o of design.organs) if (!p.forms.includes(o)) return `${E.ORGANS[o] ? E.ORGANS[o].name : o} not evolved`;
    if (!design.organs.length) return 'No organs';
    return null;
  };
})(typeof window !== 'undefined' ? window.E : globalThis.E);
