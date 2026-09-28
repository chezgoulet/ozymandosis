// Cloud sync: lineage, the Spawnforge library and save slots follow a signed-in
// player across devices, and survive browsers that clear site data (Safari
// evicts storage for sites not visited in a week). Local storage stays the
// source of truth while playing; changes are pushed a few seconds later and
// pulled at sign-in and launch.
//
// Every item has a version on the server. A push names the version it started
// from; if another device got there first, the two are merged and pushed again:
//   profile  numbers keep their highest value, honours and records are united
//   designs  united by name (the newer copy of a same-named design wins)
//   saves    the newer save wins, slot by slot
(function (E) {
  'use strict';
  const LS = E.LS, META = 'efl.cloud';
  const C = E.Cloud = { state: 'off', lastSync: 0, error: null, listeners: new Set() };
  const note = (state, error) => { C.state = state; C.error = error || null; if (state === 'ok') C.lastSync = Date.now(); for (const f of C.listeners) try { f(C); } catch (e) { /* */ } };
  const meta = () => Object.assign({ uid: null, versions: {}, dirty: {} }, LS.get(META, {}));
  const setMeta = m => LS.set(META, m);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ── merges ─────────────────────────────────────────────────────
  function mergeMax(a, b) {
    if (a === undefined || a === null) return b;
    if (b === undefined || b === null) return a;
    if (typeof a === 'number' && typeof b === 'number') return Math.max(a, b);
    if (typeof a === 'boolean' || typeof b === 'boolean') return !!(a || b);
    if (Array.isArray(a) && Array.isArray(b)) return [...new Set([...a, ...b].map(x => JSON.stringify(x)))].map(x => JSON.parse(x));
    if (typeof a === 'object' && typeof b === 'object') { const o = {}; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) o[k] = mergeMax(a[k], b[k]); return o; }
    return a;
  }
  function mergeDesigns(a, b) {
    const by = new Map();
    for (const d of [...(b || []), ...(a || [])]) { const o = by.get(d.name); if (!o || (d.at || 0) >= (o.at || 0)) by.set(d.name, d); }
    return [...by.values()].sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, 30);
  }
  const newer = (a, b) => !a ? b : !b ? a : ((b.meta && b.meta.date) || 0) > ((a.meta && a.meta.date) || 0) ? b : a;

  const ITEMS = {
    profile: { read: () => LS.get('efl.profile', null), write: v => LS.set('efl.profile', v), merge: mergeMax },
    // designs travel with the names deleted since (so a deletion is not undone by another device's copy)
    designs: {
      read: () => { const list = LS.get('efl.designs', null); return list ? { list, gone: LS.get('efl.designs.gone', {}) } : null; },
      write: v => { if (!v) return; LS.set('efl.designs', Array.isArray(v) ? v : v.list || []); if (!Array.isArray(v)) LS.set('efl.designs.gone', v.gone || {}); },
      merge: (a, b) => {
        const A = Array.isArray(a) ? { list: a, gone: {} } : a || { list: [], gone: {} }, B = Array.isArray(b) ? { list: b, gone: {} } : b || { list: [], gone: {} };
        const gone = mergeMax(A.gone || {}, B.gone || {});
        return { list: mergeDesigns(A.list, B.list).filter(d => !(gone[d.name] >= (d.at || 0))), gone };
      },
    },
  };
  for (const id of E.Saves.slots) ITEMS['save.' + id] = {
    read: () => { const data = LS.get('efl.save.' + id, null); return data ? { data, meta: LS.get('efl.meta.' + id, null) } : null; },
    write: v => { if (v && v.data) { LS.set('efl.save.' + id, v.data); LS.set('efl.meta.' + id, v.meta); } },
    merge: newer, lazy: id === 'auto',
  };
  C.keys = Object.keys(ITEMS);

  const ready = () => !!(E.Online && E.Online.signedIn() && E.Online.me);
  // A different account on this device: its data is not mixed with the last one's.
  function adopt() {
    const m = meta(), uid = E.Online.me.id;
    if (m.uid === uid) return m;
    if (m.uid) {
      const backup = {}; for (const k of C.keys) { const v = ITEMS[k].read(); if (v) backup[k] = v; }
      LS.set('efl.cloud.previous', { uid: m.uid, at: Date.now(), items: backup });
      m.dirty = {};
    } else for (const k of C.keys) if (ITEMS[k].read()) m.dirty[k] = true; // first sign-in here: offer what this device has
    m.uid = uid; m.versions = {};
    setMeta(m); return m;
  }

  async function syncItem(key, remoteVersion, m) {
    const it = ITEMS[key];
    for (let attempt = 0; attempt < 4; attempt++) {
      let remote = null;
      if (remoteVersion && remoteVersion !== m.versions[key]) {
        try { remote = await E.Online.api('GET', '/api/cloud/' + key); } catch (e) { if (e.status !== 404) throw e; }
      }
      const local = it.read();
      let value = local;
      if (remote) {
        value = m.dirty[key] ? it.merge(local, remote.value) : remote.value;
        if (!same(value, local)) it.write(value);
        m.versions[key] = remote.version;
      }
      if (!m.dirty[key] || value === null || value === undefined || (remote && same(value, remote.value))) { delete m.dirty[key]; setMeta(m); return; }
      try {
        const r = await E.Online.api('PUT', '/api/cloud/' + key, { value, base: m.versions[key] || 0 });
        m.versions[key] = r.version; delete m.dirty[key]; setMeta(m); return;
      } catch (e) {
        if (e.status === 409) { remoteVersion = -1; m.versions[key] = undefined; continue; } // someone else saved first: merge and retry
        if (e.status === 413) { delete m.dirty[key]; setMeta(m); C.error = e.message; return; }
        throw e;
      }
    }
  }

  let running = null;
  C.sync = function () {
    if (!ready()) { note('off'); return Promise.resolve(false); }
    if (running) return running;
    running = (async () => {
      note('syncing');
      try {
        const m = adopt(), list = (await E.Online.api('GET', '/api/cloud')).items || [];
        const remote = Object.fromEntries(list.map(i => [i.key, i.version]));
        for (const key of C.keys) if (m.dirty[key] || (remote[key] && remote[key] !== m.versions[key])) await syncItem(key, remote[key] || 0, m);
        note('ok'); return true;
      } catch (e) { note(e.offline ? 'offline' : 'error', e.message); return false; }
      finally { running = null; }
    })();
    return running;
  };

  // A slot deleted here is deleted everywhere.
  C.removed = function (key) {
    const m = meta(); delete m.dirty[key]; delete m.versions[key]; setMeta(m);
    if (ready() && ITEMS[key]) E.Online.api('DELETE', '/api/cloud/' + key).catch(() => {});
  };
  // Local writes mark items dirty; pushes follow shortly (the autosave only rarely).
  let timer = 0;
  C.dirty = function (key) {
    if (!ITEMS[key]) return;
    const m = meta(); m.dirty[key] = true; setMeta(m);
    if (!ready()) return;
    clearTimeout(timer); timer = setTimeout(C.sync, ITEMS[key].lazy ? 60e3 : 5e3);
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden && Object.keys(meta().dirty).length) C.sync(); });
  if (E.Online) E.Online.on(O => { if (O.me && O.me.id !== C.syncedFor) { C.syncedFor = O.me.id; C.sync(); } if (!O.me) { C.syncedFor = null; note('off'); } });
})(window.E);
