// Persistence: settings, save slots (with autosave), and the design library.
(function (E) {
  'use strict';
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  E.LS = LS;

  const DEFAULTS = {
    quality: 'auto', backend: 'auto', markers: 'auto', orientation: 'auto', muted: false, organIcons: true, music: 0.5, sfx: 0.7, uiScale: 1, edgePan: true, showHp: true, tapCommand: true,
    rightClick: 'amove', invertZoom: false, tips: true, guideStep: 0, name: '', server: '', lastSetup: null, mmCollapsed: false, speed: 1, haptics: true, fullscreen: true,
  };
  E.Settings = Object.assign({}, DEFAULTS, LS.get('efl.settings', {}));
  E.saveSettings = () => LS.set('efl.settings', E.Settings);

  // Saves: index + one key per slot. slot ids: 'auto', 's1'..'s8'
  const SAVE_SLOTS = ['auto', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
  E.Saves = {
    slots: SAVE_SLOTS,
    list() {
      return SAVE_SLOTS.map(id => { const m = LS.get('efl.meta.' + id, null); return m ? Object.assign({ id }, m) : null; }).filter(Boolean)
        .sort((a, b) => b.date - a.date);
    },
    meta(world, extra) {
      const s = world.s;
      return Object.assign({ date: Date.now(), time: s.t, size: s.cfg.map.size, seed: s.cfg.map.seed,
        players: s.players.map(p => ({ c: p.culture, k: p.kind, n: p.name, a: p.alive })), v: s.v }, extra || {});
    },
    write(id, world, extra) {
      const data = { v: 1, state: world.serialize(), extra: extra || {} };
      const ok = LS.set('efl.save.' + id, data);
      if (ok) LS.set('efl.meta.' + id, this.meta(world, extra));
      return ok;
    },
    read(id) { return LS.get('efl.save.' + id, null); },
    remove(id) { LS.del('efl.save.' + id); LS.del('efl.meta.' + id); },
    freeSlot() { const used = new Set(this.list().map(m => m.id)); return SAVE_SLOTS.slice(1).find(s => !used.has(s)) || SAVE_SLOTS[1]; },
    exportBlob(world, extra) { return new Blob([JSON.stringify({ ozymandosis: 1, v: 1, state: world.serialize(), extra: extra || {} })], { type: 'application/json' }); },
  };

  // Design library shared across games (player-authored designs).
  E.Library = {
    all() { return LS.get('efl.designs', []); },
    save(list) { LS.set('efl.designs', list.slice(0, 30)); },
    add(d) { const l = this.all().filter(x => x.name !== d.name); l.unshift({ name: d.name, chassis: d.chassis, organs: d.organs.slice(), role: d.role }); this.save(l); },
    remove(name) { this.save(this.all().filter(x => x.name !== name)); },
  };
})(window.E);
