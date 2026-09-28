// Codex: how to play, controls, and an encyclopedia of every organ, chassis,
// ability, power, powerup, structure and culture.
(function (E) {
  'use strict';
  const h = E.h;
  const TABS = [['basics', 'How to play'], ['controls', 'Controls'], ['cultures', 'Cultures'], ['chassis', 'Chassis'], ['organs', 'Organs'], ['abilities', 'Abilities'], ['powers', 'Powers'], ['powerups', 'Powerups'], ['structures', 'Structures']];
  E.Codex = {
    tab: 'basics',
    render(tabsEl, body) {
      tabsEl.innerHTML = '';
      for (const [id, label] of TABS) tabsEl.appendChild(h('button', { role: 'tab', 'aria-selected': String(this.tab === id), onclick: () => { this.tab = id; this.render(tabsEl, body); } }, label));
      body.innerHTML = '';
      const grid = h('div', { class: 'codex-grid' });
      const entry = (title, text, meta, draw, glyph, color) => {
        const cv = draw ? h('canvas') : null;
        const el = h('div', { class: 'entry' }, cv, h('div', { class: 'tx' }, h('h4', null, glyph ? h('span', { class: 'glyph', style: `--gc:${color}` }, glyph) : null, title), h('p', null, text), meta ? h('div', { class: 'meta' }, meta) : null));
        grid.appendChild(el); if (draw) requestAnimationFrame(() => draw(cv));
      };
      switch (this.tab) {
        case 'basics':
          body.appendChild(h('div', { class: 'prose', html: `
            <h3>Your goal</h3><p>Destroy every enemy structure (nuclei, buds and spires). Allies on the same team share victory.</p>
            <h3>The economy</h3><p><b>Lumen</b> ◆ comes from drifting caustic pools, carried home by creatures with <b>pili</b>. <b>Spore</b> ✦ comes from golden spore beds, gathered more slowly, and pays for advanced evolution. Every nucleus also filters a trickle of <b>silt</b> lumen from the water.</p>
            <h3>Growing</h3><p>Select a nucleus or bud to hatch creatures. Each creature is a <b>design</b>: one chassis plus organs. Open the <b>Spawnforge</b> to create your own designs, and <b>Evolve</b> to research new organs, chassis, tiers and colony powers. Research lanes grow with every Bud you plant.</p>
            <h3>Wounds and healing</h3><p>Wounded creatures lose pieces: organs tear away and tails wear down, and they regrow as the creature heals. Out of the fight for five seconds, a creature knits slowly on its own. Beside your own Nucleus or Bud it <b>mends</b> fast, paid for in lumen; tap <b>Mend</b> (N) to send the selection home. Structures regrow slowly when left alone.</p>
            <h3>Gatherers and fighters</h3><p>Gatherers are soft and pale, with a glowing harvest sac that fills as they carry. Fighters wear dark war plates, spikes and a spiked crown. A design that can harvest but also bites hard counts as a fighter.</p>
            <h3>Expanding</h3><p>Select any creature, tap <b>Build</b>, and plant a <b>Bud</b> near distant pools. Buds are drop-off points and hatcheries, and add population and research lanes. <b>Spires</b> defend and reveal hidden creatures.</p>
            <h3>Fever</h3><p>Hatching and fighting heat your colony. Fever makes creatures faster and deadlier. Above 60% they start to burn. <b>Frenzy</b> spikes it on purpose. You can read any colony's fever from its color, including your enemies'.</p>
            <h3>Reading the light</h3><p>Colors tell you each colony's state: calm cultures glow in their base tones, busy ones brighten, fevered ones turn amber then red, starving ones fade to cold blue, and a colony whose nucleus is dying pulses red.</p>
            <h3>Powerups</h3><p>Warm vents spawn powerups. Any creature can collect one by swimming over it.</p>
            <h3>Veterancy</h3><p>Creatures that deal damage gain up to three ranks (gold dots). Each rank adds 12% health and bite.</p>` }));
          return;
        case 'controls':
          body.appendChild(h('div', { class: 'grid2' },
            h('div', { class: 'card' }, h('h3', null, 'Touch'), h('div', { class: 'keys', html: `
              <kbd>tap</kbd><span>Select a creature or structure</span>
              <kbd>tap ground</kbd><span>Send the selection there (they fight along the way)</span>
              <kbd>tap enemy</kbd><span>Focus attack</span>
              <kbd>tap pool</kbd><span>Harvest with selected pili creatures</span>
              <kbd>double-tap</kbd><span>Select every creature of that design on screen</span>
              <kbd>drag</kbd><span>Pan the camera</span>
              <kbd>long-press + drag</kbd><span>Box-select</span>
              <kbd>pinch</kbd><span>Zoom</span>
              <kbd>minimap</kbd><span>Tap or drag to jump</span>` })),
            h('div', { class: 'card' }, h('h3', null, 'Mouse & keyboard'), h('div', { class: 'keys', html: `
              <kbd>left-click / drag</kbd><span>Select / box-select (Shift adds)</span>
              <kbd>right-click</kbd><span>Smart command: move, attack, harvest</span>
              <kbd>wheel</kbd><span>Zoom at cursor</span>
              <kbd>W A S D · arrows</kbd><span>Pan the camera (hold Shift to pan faster)</span>
              <kbd>middle-drag · screen edge</kbd><span>Pan</span>
              <kbd>X</kbd><span>Attack-move (then click)</span>
              <kbd>M · Z · H · N</kbd><span>Move · Stop · Hold · Mend (return home to heal)</span>
              <kbd>Q E R F C V</kbd><span>Abilities of the selection</span>
              <kbd>B</kbd><span>Build</span>
              <kbd>T · G</kbd><span>Evolve · Spawnforge</span>
              <kbd>F1 · F2</kbd><span>Idle foragers · Army</span>
              <kbd>Space</kbd><span>Jump to your nucleus / last alert</span>
              <kbd>Ctrl+0–9 · 0–9</kbd><span>Set / recall control group</span>
              <kbd>1–9 (hatchery)</kbd><span>Hatch design</span>
              <kbd>Enter</kbd><span>Chat (multiplayer)</span>
              <kbd>P · Ctrl+Z</kbd><span>Patrol · undo last order</span>
              <kbd>Shift+order</kbd><span>Queue as a waypoint</span>
              <kbd>Esc · F10</kbd><span>Cancel / menu</span>
              <kbd>Alt+Enter · F11</kbd><span>Toggle fullscreen</span>` }))));
          return;
        case 'cultures':
          for (const c of E.CULTURE_LIST) entry(c.name, c.blurb + ' ' + c.rule + '.', `${c.spec.toUpperCase()} · STARTS WITH ${E.ORGANS[c.startForm].name.toUpperCase()} & ${E.CHASSIS[c.startChassis].name.toUpperCase()}`, cv => E.drawPortrait(cv, E.SIGNATURES[c.id], c.id, {}, 0.6));
          break;
        case 'chassis':
          for (const ch of E.CHASSIS_LIST) entry(ch.name, ch.blurb, `${ch.slots} SLOTS · HP ${ch.hp} · SPEED ${ch.speed} · ${ch.trait.toUpperCase()}`, cv => E.drawChassisThumb(cv, ch.id, 'luminant', 0.5));
          break;
        case 'organs':
          for (const o of E.ORGAN_LIST) entry(o.name, o.blurb, `${E.CLASSES[o.cls].name.toUpperCase()} · FORM ${o.form}${o.ability ? ' · ' + E.ABILITIES[o.ability].name.toUpperCase() : ''}`, cv => E.drawOrganThumb(cv, o.id, 6, E.CULTURE_LIST[E.CLASSES[o.cls].idx].id, 0.6));
          break;
        case 'abilities':
          for (const a of E.ABILITY_LIST) {
            const src = E.ORGAN_LIST.find(o => o.ability === a.id) || E.CHASSIS_LIST.find(c => c.ability === a.id);
            entry(a.name, a.desc, `FROM ${src.name.toUpperCase()} · COOLDOWN ${a.cd}s · ${a.target === 'self' ? 'INSTANT' : 'TARGETED'}`, null, a.glyph, a.color);
          }
          break;
        case 'powers':
          for (const p of E.POWER_LIST) entry(p.name, p.desc, `${p.kind.toUpperCase()} · ◆${p.cost.l}${p.cost.s ? ' ✦' + p.cost.s : ''}${p.cd ? ' · COOLDOWN ' + p.cd + 's' : ''}`, null, p.glyph, p.color);
          break;
        case 'powerups':
          for (const p of E.POWERUP_LIST) entry(p.name, p.desc, p.scope.toUpperCase(), null, p.glyph, p.color);
          break;
        case 'structures':
          entry('Nucleus', 'Your heart. Hatchery, drop-off point, 20 population, silt income, and a lance of light that defends itself.', 'HP 6000 · ARMOR 30%', null, '✺', '#60f0ff');
          entry('Bud', E.STRUCTS.bud.desc, `◆${E.STRUCTS.bud.cost.l} · BUILDS IN ${E.STRUCTS.bud.build}s · +1 RESEARCH LANE`, null, '❀', '#38f8c8');
          entry('Spire', E.STRUCTS.spire.desc, `◆${E.STRUCTS.spire.cost.l} ✦${E.STRUCTS.spire.cost.s} · RANGE 240`, null, '✷', '#ffa0d8');
          break;
      }
      body.appendChild(grid);
    },
  };
})(window.E);
