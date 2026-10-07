// SPDX-License-Identifier: AGPL-3.0-only
// Evolve overlay: the tech tree (organ tiers, 30 forms, 6 chassis, 12 powers).
(function (E) {
  'use strict';
  const h = E.h;

  class TechUI {
    constructor(game) {
      this.g = game; this.tab = 'organs';
      this.tabsEl = E.$('tech-tabs'); this.body = E.$('tech-body'); this.resEl = E.$('tech-res');
      this.cards = [];
    }
    open() { this.build(); }
    build() {
      const tabs = [['organs', 'Organs'], ['chassis', 'Chassis'], ['powers', 'Powers'], ['queue', 'Queue']];
      this.tabsEl.innerHTML = '';
      for (const [id, label] of tabs) this.tabsEl.appendChild(h('button', { role: 'tab', 'aria-selected': String(this.tab === id), onclick: () => { this.tab = id; this.build(); } }, label));
      this.body.innerHTML = ''; this.cards = [];
      const p = this.g.me(); if (!p) return;
      const queue = h('div', { class: 'card', style: 'margin-bottom:12px' }, h('div', { class: 'lbl', style: 'margin-bottom:6px' }, 'Evolving'), this.queueEl = h('div', { style: 'display:grid;gap:6px' }));
      this.body.appendChild(queue);
      if (this.tab === 'organs') {
        const cols = h('div', { class: 'tech-cols five' });
        for (const cls of E.CLASS_IDS) {
          const C = E.CLASSES[cls];
          const col = h('div', { class: 'tech-col' }, h('h4', null, C.name, h('small', null, C.role)));
          const tiers = h('div', { class: 'tiers' });
          for (let l = 0; l < 4; l++) {
            const key = l ? `tier:${cls}:${l}` : null;
            const el = h('button', { class: 'tier', onclick: () => key && this.buy(key), title: key ? E.TECHS[key].desc : 'Innate' }, ['I', 'II', 'III', 'IV'][l], h('i', { class: 'p' }));
            tiers.appendChild(el); this.cards.push({ el, key, tierOf: cls, lvl: l });
          }
          col.appendChild(tiers);
          for (const o of E.organsOf(cls)) col.appendChild(this.card(o.form === 1 ? null : 'form:' + o.id, o.name, o.blurb, cv => E.drawOrganThumb(cv, o.id, E.TIER_V[p.tier[cls]], p.culture, 0.6), o.form === 1));
          cols.appendChild(col);
        }
        this.body.appendChild(cols);
      } else if (this.tab === 'chassis') {
        const cols = h('div', { class: 'tech-cols three' });
        for (const ch of E.CHASSIS_LIST) cols.appendChild(this.card(ch.id === 'serpent' ? null : 'chassis:' + ch.id, ch.name, ch.blurb + ' ' + ch.slots + ' organ slots · ' + ch.trait + '.', cv => E.drawChassisThumb(cv, ch.id, p.culture, 0.5), ch.id === 'serpent'));
        this.body.appendChild(cols);
      } else if (this.tab === 'powers') {
        const cols = h('div', { class: 'tech-cols three' });
        for (const pw of E.POWER_LIST) cols.appendChild(this.card('power:' + pw.id, pw.name + (pw.kind === 'active' ? ' · active' : ' · passive'), pw.desc + (pw.cd ? ` Cooldown ${pw.cd}s.` : ''), null, false, pw));
        this.body.appendChild(cols);
      } else {
        this.body.appendChild(h('p', { class: 'prose' }, 'Research runs one lane at a time, plus one more lane for each finished Bud (up to three). You can queue up to six evolutions. Cancelling refunds the full cost.'));
      }
      this.update();
    }
    card(key, name, desc, draw, innate, power) {
      const cv = draw ? h('canvas') : h('span', { class: 'glyph', style: `--gc:${power.color}` }, power.glyph);
      const cost = h('div', { class: 'cost' });
      const el = h('button', { class: 'tcard', onclick: () => key && this.buy(key) }, cv, h('div', null, h('b', null, name), h('small', null, desc), cost), h('span', { class: 'state' }), h('i', { class: 'p' }));
      if (draw) requestAnimationFrame(() => draw(cv));
      this.cards.push({ el, key, innate, cost });
      return el;
    }
    buy(key) {
      const p = this.g.me(), t = E.TECHS[key]; if (!p || !t) return;
      if (t.have(p)) return;
      const r = p.research.find(r => r.key === key);
      if (r) { this.g.send({ c: 'unresearch', key }); E.Audio.play('tap'); return; }
      if (!t.req(p)) { E.toast(t.reqText || 'Not yet available'); E.Audio.play('deny'); return; }
      const c = this.g.world.techCost(p, t);
      if (p.lumen < c.l || p.spore < c.s) { E.toast('Not enough resources'); E.Audio.play('deny'); return; }
      this.g.send({ c: 'research', key }); E.Audio.play('order');
    }
    update() {
      const p = this.g.me(); if (!p) return;
      const w = this.g.world;
      this.resEl.textContent = `◆ ${Math.floor(p.lumen)}  ✦ ${Math.floor(p.spore)}`;
      for (const c of this.cards) {
        if (c.tierOf) {
          const have = p.tier[c.tierOf] >= c.lvl, r = c.key && p.research.find(r => r.key === c.key);
          c.el.classList.toggle('have', have);
          c.el.classList.toggle('can', !have && !!c.key && E.TECHS[c.key].req(p));
          c.el.querySelector('.p').style.width = r ? (r.t / r.dur * 100) + '%' : '0';
          continue;
        }
        if (c.innate) { c.el.classList.add('have'); c.el.querySelector('.state').textContent = 'INNATE'; c.cost.textContent = ''; continue; }
        const t = E.TECHS[c.key], have = t.have(p), r = p.research.find(r => r.key === c.key), ready = t.req(p);
        const cost = w.techCost(p, t);
        c.el.classList.toggle('have', have); c.el.classList.toggle('can', !have && ready); c.el.classList.toggle('locked', !have && !ready);
        c.el.querySelector('.state').textContent = have ? 'EVOLVED' : r ? 'CANCEL' : '';
        c.el.querySelector('.p').style.width = r ? (r.t / r.dur * 100) + '%' : '0';
        c.cost.textContent = have ? '' : !ready ? t.reqText : `◆ ${cost.l}${cost.s ? '  ✦ ' + cost.s : ''} · ${Math.round(t.time * E.CULTURES[p.culture].mods.research)}s` + (p.lumen < cost.l || p.spore < cost.s ? ' · need more' : '');
      }
      // queue
      const q = this.queueEl; if (!q) return;
      const sig = p.research.map(r => r.key).join();
      if (q._sig !== sig) {
        q._sig = sig; q.innerHTML = '';
        if (!p.research.length) q.appendChild(h('span', { style: 'color:var(--ink-dim);font-size:.86em' }, 'Nothing evolving. Tap a card to start.'));
        for (const r of p.research) {
          const row = h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('span', { style: 'flex:1;font-size:.88em' }, E.TECHS[r.key].name), h('div', { class: 'bar-l', style: 'flex:2' }, h('i')), h('button', { class: 'btn small ghost', onclick: () => this.g.send({ c: 'unresearch', key: r.key }) }, '✕'));
          row.dataset.key = r.key; q.appendChild(row);
        }
      }
      for (const row of q.children) { const r = p.research.find(x => x.key === row.dataset.key); const b = row.querySelector('.bar-l i'); if (r && b) b.style.width = (r.t / r.dur * 100) + '%'; }
    }
  }
  E.TechUI = TechUI;
})(window.E);
