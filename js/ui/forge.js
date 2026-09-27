// The Organism Forge: design editor used both as a lab (everything unlocked,
// variants adjustable) and in-game (your unlocks, your research tiers).
(function (E) {
  'use strict';
  const h = E.h;

  class Forge {
    constructor(host, opts) {
      this.host = host; this.opts = opts || {};
      this.mode = this.opts.mode || 'lab';
      this.culture = this.opts.culture || 'verdant';
      this.design = { name: 'New organism', chassis: 'serpent', organs: ['nippers', 'whiptail', 'feelers'], role: undefined };
      this.v = [4, 4, 4, 4, 4, 4, 4, 4];
      this.build();
    }
    player() { return this.opts.getPlayer ? this.opts.getPlayer() : null; }
    unlocked(kind, id) {
      const p = this.player(); if (this.mode === 'lab' || !p) return true;
      return kind === 'chassis' ? p.chassis.includes(id) : p.forms.includes(id);
    }
    build() {
      const host = this.host; host.innerHTML = '';
      this.cv = h('canvas', { 'aria-label': 'Organism preview' });
      this.roleEl = h('div', { class: 'role' });
      this.costEl = h('div', { class: 'mono', style: 'color:var(--ink-soft);text-align:right' });
      const stage = h('div', { class: 'forge-stage' }, this.cv, h('div', { class: 'ovl' }, this.roleEl, this.costEl));
      this.aq = new E.Aquarium(this.cv);
      this.nameIn = h('input', { type: 'text', maxlength: 24, value: this.design.name, 'aria-label': 'Design name', oninput: () => { this.design.name = this.nameIn.value; } });
      this.cultRow = h('div', { class: 'chips row' });
      this.chRow = h('div', { class: 'chassis-pick' });
      this.slotsEl = h('div', { class: 'slots' });
      this.statsEl = h('div', { class: 'stat-bars' });
      this.tagsEl = h('div', { class: 'tags' });
      this.harvIn = h('input', { type: 'checkbox', onchange: () => { this.design.role = this.harvIn.checked ? 'harvest' : undefined; } });
      this.libEl = h('div', { class: 'design-list' });
      const left = h('div', { style: 'display:grid;gap:12px;align-content:start' }, stage,
        h('div', { class: 'card' }, h('div', { class: 'lbl', style: 'margin-bottom:8px' }, 'Anatomy'), this.statsEl, h('div', { style: 'height:8px' }), this.tagsEl),
        h('div', { class: 'card' }, h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:8px' }, h('span', { class: 'lbl' }, this.mode === 'game' ? 'Colony designs' : 'Library'), h('span', { class: 'mono', style: 'color:var(--ink-dim)' }, '')), this.libEl));
      const right = h('div', { class: 'card', style: 'display:grid;gap:12px;align-content:start' },
        h('div', { class: 'field', style: 'margin:0' }, h('label', null, 'Name'), this.nameIn),
        this.mode === 'lab' ? h('div', { class: 'field', style: 'margin:0' }, h('label', null, 'Culture'), this.cultRow) : null,
        h('div', { class: 'field', style: 'margin:0' }, h('label', null, 'Chassis'), this.chRow),
        h('div', { class: 'field', style: 'margin:0' }, h('label', null, this.mode === 'lab' ? 'Organs · variant 0–9' : 'Organs · tiers from research'), this.slotsEl),
        h('div', { class: 'toggle-row' }, h('span', null, 'Auto-harvest when hatched'), h('label', { class: 'switch' }, this.harvIn, h('i'))),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => this.save() }, this.mode === 'game' ? 'Add to hatchery' : 'Save to library'),
          h('button', { class: 'btn', onclick: () => this.mutate() }, 'Mutate'),
          this.mode === 'game' ? h('button', { class: 'btn', onclick: () => { E.Library.add(this.design); E.toast('Saved to your library'); this.renderLib(); } }, 'Save to library') : null));
      host.appendChild(h('div', { class: 'forge' }, left, right));
      this.renderAll();
    }
    renderAll() { this.renderCult(); this.renderChassis(); this.renderSlots(); this.update(); this.renderLib(); }
    renderCult() {
      this.cultRow.innerHTML = '';
      for (const c of E.CULTURE_LIST) {
        this.cultRow.appendChild(h('button', { class: 'btn small', style: { borderColor: this.culture === c.id ? c.hex[1] : '', background: this.culture === c.id ? c.hex[0] + '33' : '' },
          onclick: () => { this.culture = c.id; this.renderAll(); } }, c.short));
      }
    }
    renderChassis() {
      this.chRow.innerHTML = '';
      for (const ch of E.CHASSIS_LIST) {
        const cv = h('canvas');
        const ok = this.unlocked('chassis', ch.id);
        const b = h('button', { 'aria-pressed': String(this.design.chassis === ch.id), disabled: !ok, title: ch.blurb, onclick: () => { this.design.chassis = ch.id; this.design.organs = this.design.organs.slice(0, ch.slots); this.renderAll(); } }, cv, h('span', null, ch.name + (ok ? '' : ' 🔒')));
        this.chRow.appendChild(b);
        requestAnimationFrame(() => E.drawChassisThumb(cv, ch.id, this.cult(), 0.4));
      }
    }
    cult() { const p = this.player(); return this.mode === 'game' && p ? p.culture : this.culture; }
    renderSlots() {
      const ch = E.CHASSIS[this.design.chassis];
      this.slotsEl.innerHTML = '';
      for (let i = 0; i < ch.slots; i++) {
        const sel = h('select', { 'aria-label': 'Organ slot ' + (i + 1) });
        sel.appendChild(h('option', { value: '' }, '— empty —'));
        for (const cls of E.CLASS_IDS) {
          const og = h('optgroup', { label: E.CLASSES[cls].name + ' · ' + E.CLASSES[cls].role });
          for (const o of E.organsOf(cls)) { const ok = this.unlocked('form', o.id); og.appendChild(h('option', { value: o.id, disabled: !ok }, o.name + (ok ? '' : ' (locked)'))); }
          sel.appendChild(og);
        }
        sel.value = this.design.organs[i] || '';
        sel.onchange = () => { const arr = this.design.organs.slice(); arr[i] = sel.value; this.design.organs = arr.filter(Boolean); this.renderSlots(); this.update(); };
        const row = h('div', { class: 'oslot' }, sel);
        if (this.mode === 'lab') {
          const rng = h('input', { type: 'range', min: 0, max: 9, value: this.v[i], style: 'width:90px', 'aria-label': 'Variant', oninput: () => { this.v[i] = +rng.value; this.update(); } });
          row.appendChild(rng);
        } else {
          const p = this.player(); const o = E.ORGANS[this.design.organs[i]];
          row.appendChild(h('span', { class: 'mono', style: 'color:var(--ink-dim);min-width:40px;text-align:right' }, o && p ? ['I', 'II', 'III', 'IV'][p.tier[o.cls]] : ''));
        }
        this.slotsEl.appendChild(row);
      }
    }
    clean() { this.design.organs = this.design.organs.filter(Boolean); }
    vArr() {
      if (this.mode === 'lab') return this.v.slice(0, this.design.organs.length);
      const p = this.player();
      return this.design.organs.map(id => E.TIER_V[p ? p.tier[E.ORGANS[id].cls] : 0]);
    }
    update() {
      this.clean();
      const cult = this.cult(), p = this.player();
      const st = E.computeStats(this.design, { culture: cult, tier: p ? p.tier : {}, specials: p ? p.specials : [] }, { v: this.vArr() });
      this.aq.set(this.design, cult, this.vArr());
      const c = E.CULTURES[cult];
      this.host.style.setProperty('--pc0', c.hex[0]); this.host.style.setProperty('--pc1', c.hex[1]);
      this.roleEl.textContent = st.role;
      this.costEl.innerHTML = `${st.cost} lumen${st.spore ? ' · ' + st.spore + ' spore' : ''}<br>hatch ${st.hatch.toFixed(1)}s`;
      const bars = [['HP', st.hp, 400], ['Armor', st.armor * 100, 75], ['Speed', st.speed, 140], ['Bite', st.dps, 50], ['Ranged', st.shot, 30], ['Reach', Math.max(st.range, st.shotRange), 200], ['Harvest', st.harvest, 30], ['Sense', st.sense, 380]];
      this.statsEl.innerHTML = bars.map(([k, v, m]) => `<div class="sbar"><span>${k}</span><span class="b"><i style="width:${E.clamp(v / m, 0, 1) * 100}%"></i></span><b>${v < 20 ? v.toFixed(1) : Math.round(v)}</b></div>`).join('');
      const tags = [];
      const ch = E.CHASSIS[this.design.chassis]; tags.push(ch.trait);
      for (const a of st.abilities) tags.push(E.ABILITIES[a].glyph + ' ' + E.ABILITIES[a].name);
      if (st.slowOnHit) tags.push('Slows on hit'); if (st.thorns) tags.push('Thorns ' + Math.round(st.thorns * 100) + '%');
      if (st.regen) tags.push('Regen ' + st.regen.toFixed(1) + '/s'); if (st.evasion) tags.push('Evasion ' + Math.round(st.evasion * 100) + '%');
      if (st.leech) tags.push('Leech'); if (st.bleed) tags.push('Bleed'); if (st.poison) tags.push('Poison'); if (st.pierce) tags.push('Pierces armor');
      if (st.detect > 60) tags.push('Detects hidden'); if (st.aura) tags.push('Courage aura'); if (st.lure) tags.push('Lure'); if (st.sporeBonus) tags.push('Spore ×2');
      if (st.lifespan) tags.push('Lives ' + st.lifespan + 's');
      this.tagsEl.innerHTML = tags.map(t => `<span class="tag">${E.esc(t)}</span>`).join('');
      this.harvIn.checked = this.design.role === 'harvest';
      this.lastStats = st;
    }
    mutate() {
      const chs = E.CHASSIS_LIST.filter(c => this.unlocked('chassis', c.id));
      const ch = chs[Math.floor(Math.random() * chs.length)];
      const pool = E.ORGAN_LIST.filter(o => this.unlocked('form', o.id));
      const n = 1 + Math.floor(Math.random() * ch.slots);
      this.design.chassis = ch.id; this.design.organs = Array.from({ length: n }, () => pool[Math.floor(Math.random() * pool.length)].id);
      this.v = this.v.map(() => Math.floor(Math.random() * 10));
      const st = E.computeStats(this.design, { culture: this.cult() });
      this.design.name = st.role + ' ' + ['of the Drift', 'Prime', 'Minor', 'Rex', 'Vesper', 'Nox', 'Lux'][Math.floor(Math.random() * 7)];
      this.nameIn.value = this.design.name;
      this.renderAll();
    }
    load(d) {
      this.design = { name: d.name, chassis: d.chassis, organs: d.organs.slice(), role: d.role };
      this.nameIn.value = d.name; this.renderAll();
    }
    save() {
      this.clean();
      if (!this.design.organs.length) { E.toast('Give it at least one organ.'); return; }
      if (this.mode === 'game') {
        const p = this.player();
        const lock = p && E.designLock(this.design, p);
        if (lock) { E.toast(lock); return; }
        if (this.opts.onSave) this.opts.onSave(Object.assign({}, this.design));
      } else { E.Library.add(this.design); E.toast('Saved to your library. It can be hatched in any game once its parts are evolved.'); this.renderLib(); }
    }
    renderLib() {
      const el = this.libEl; el.innerHTML = '';
      const p = this.player();
      const list = this.mode === 'game' && p ? p.designs.map(d => Object.assign({ colony: true }, d)).concat(E.Library.all()) : E.Library.all();
      if (!list.length) { el.appendChild(h('p', { style: 'margin:0;color:var(--ink-dim);font-size:.86em' }, 'Saved designs appear here.')); return; }
      for (const d of list) {
        const cv = h('canvas');
        const lock = p && this.mode === 'game' ? E.designLock(d, p) : null;
        el.appendChild(h('div', { class: 'dl-item' }, cv,
          h('div', null, h('b', { style: 'font-weight:500;font-size:.9em' }, d.name), h('div', { class: 'mono', style: 'color:var(--ink-dim)' }, (d.colony ? 'colony · ' : 'library · ') + E.CHASSIS[d.chassis].name + (lock ? ' · 🔒' : ''))),
          h('div', { class: 'row', style: 'gap:4px;flex-wrap:nowrap' },
            h('button', { class: 'btn small', onclick: () => this.load(d) }, 'Edit'),
            !d.colony ? h('button', { class: 'btn small ghost', 'aria-label': 'Delete', onclick: () => { E.Library.remove(d.name); this.renderLib(); } }, '✕') : null)));
        requestAnimationFrame(() => E.drawPortrait(cv, d, this.cult(), p ? p.tier : {}, 0.5));
      }
    }
    frame(dt) { this.aq.frame(dt); }
  }
  E.Forge = Forge;
})(window.E);
