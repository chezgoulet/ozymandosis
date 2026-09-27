// Menus: main menu, skirmish & multiplayer lobby setup, load, settings,
// codex, forge lab, and the living backdrop.
(function (E) {
  'use strict';
  const h = E.h, $ = E.$;
  const DIFF_KEYS = ['easy', 'normal', 'hard', 'brutal'];
  const game = new E.Game();
  E.game = game;

  // ── backdrop: the seed pack, unmodified ─────────────────────────
  const bg = $('bg'), bgx = bg.getContext('2d');
  let bgT = 0, bgLast = performance.now();
  function bgFrame(now) {
    requestAnimationFrame(bgFrame);
    if (bg.hidden || document.hidden || now - bgLast < 32) return; // 30 fps is plenty for a backdrop
    const dt = Math.min(0.05, (now - bgLast) / 1000); bgLast = now;
    bgT += dt;
    const r = bg.getBoundingClientRect(), dpr = 1;
    if (bg.width !== Math.round(r.width * dpr)) { bg.width = Math.round(r.width * dpr); bg.height = Math.round(r.height * dpr); }
    bgx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const load = 0.45 + 0.35 * Math.sin(bgT * 0.09) + 0.12 * Math.sin(bgT * 0.31);
    BioluminescentDreamscape.render(bgx, r.width, r.height, { lowPowerMode: false, isProcessing: load > 0.4, inferenceLoad: E.clamp(load, 0, 1), queueDepth: load * 14, isHealthy: true, isCharging: false, batteryLevel: 80, batteryTemperature: 33 }, bgT, dt);
    if (forgeLab && !$('scr-forge').hidden) forgeLab.frame(dt);
  }

  // ── setup state (skirmish & lobby) ──────────────────────────────
  let setup = null, lobby = null, forgeLab = null;
  function defaultSetup() {
    const last = E.Settings.lastSetup;
    if (last && last.slots && last.map) return E.deepCopy(last);
    return { map: Object.assign({}, E.DEFAULT_MAP, { seed: 1 + Math.floor(Math.random() * 99999) }),
      slots: [{ kind: 'you', culture: 'verdant', team: 0, diff: 'normal' }, { kind: 'bot', culture: 'bloom', team: 0, diff: 'normal' }] };
  }
  function playerName() { return (E.Settings.name || '').trim() || 'Tender'; }
  function freeCulture(except) { const used = new Set(setup.slots.filter(s => s !== except).map(s => s.culture)); return E.CULTURE_LIST.find(c => !used.has(c.id)).id; }
  function setCulture(slot, cid) {
    const other = setup.slots.find(s => s !== slot && s.culture === cid);
    if (other) other.culture = slot.culture;
    slot.culture = cid;
  }

  function renderSetup() {
    const isHost = lobby && lobby.role === 'host', isGuest = lobby && lobby.role === 'guest';
    $('setup-title').textContent = lobby ? (lobby.save ? 'Resume together' : 'Lobby') : 'Skirmish';
    $('setup-room').textContent = lobby ? 'ROOM ' + lobby.room : '';
    $('lobby-chat-card').hidden = !lobby;
    const host = $('slots'); host.innerHTML = '';
    setup.slots.forEach((s, i) => {
      const c = E.CULTURES[s.culture];
      const mine = (!lobby && s.kind === 'you') || (isHost && s.kind === 'you') || (isGuest && s.peer === lobby.id);
      const editable = !lobby || isHost || mine;
      const cult = h('select', { disabled: !editable || (lobby && lobby.save), 'aria-label': 'Culture' }, E.CULTURE_LIST.map(k => h('option', { value: k.id }, k.name)));
      cult.value = s.culture;
      cult.onchange = () => { if (isGuest) { lobby.relay.toHost({ k: 'pick', culture: cult.value, team: s.team }); return; } setCulture(s, cult.value); changed(); };
      const ctrlOpts = [];
      if (s.kind === 'you') ctrlOpts.push(['you', playerName() + ' (you)']);
      else if (s.kind === 'human') ctrlOpts.push(['human', (s.name || 'Player') + ' (online)']);
      else if (s.kind === 'open') ctrlOpts.push(['open', 'Open: waiting for a player']);
      if (s.kind !== 'you' && s.kind !== 'human') for (const d of DIFF_KEYS) ctrlOpts.push(['bot:' + d, 'Bot · ' + E.DIFFS[d].name]);
      if (lobby && s.kind !== 'you' && s.kind !== 'human' && !lobby.save) ctrlOpts.push(['open', 'Open for a player']);
      if (s.kind !== 'you' && (!lobby || !lobby.save)) ctrlOpts.push(['remove', s.kind === 'human' ? 'Kick' : 'Remove slot']);
      const ctrl = h('select', { disabled: !(!lobby || isHost) || s.kind === 'you', 'aria-label': 'Controller' }, ctrlOpts.filter((o, k, a) => a.findIndex(x => x[0] === o[0]) === k).map(([v, l]) => h('option', { value: v }, l)));
      ctrl.value = s.kind === 'bot' ? 'bot:' + s.diff : s.kind;
      ctrl.onchange = () => {
        const v = ctrl.value;
        if (v === 'remove') { if (s.kind === 'human' && lobby) lobby.relay.kick(s.peer); setup.slots.splice(i, 1); }
        else if (v.startsWith('bot:')) { if (s.kind === 'human' && lobby) lobby.relay.kick(s.peer); s.kind = 'bot'; s.diff = v.slice(4); delete s.peer; }
        else if (v === 'open') { s.kind = 'open'; }
        changed();
      };
      const team = h('select', { disabled: !editable || (lobby && lobby.save), 'aria-label': 'Team' }, [['0', 'Free-for-all'], ['1', 'Team 1'], ['2', 'Team 2'], ['3', 'Team 3']].map(([v, l]) => h('option', { value: v }, l)));
      team.value = String(s.team || 0);
      team.onchange = () => { if (isGuest) { lobby.relay.toHost({ k: 'pick', culture: s.culture, team: +team.value }); return; } s.team = +team.value; changed(); };
      const spec = h('span', { class: 'mono', style: 'color:var(--ink-dim);align-self:center', title: c.rule }, c.spec);
      host.appendChild(h('div', { class: 'slot-row', style: `--c0:${c.hex[0]};--c1:${c.hex[1]}` }, h('div', { class: 'sw' }), h('div', null, h('div', { class: 'ctl' }, cult, ctrl, team, spec),
        h('div', { style: 'font-size:.8em;color:var(--ink-soft);margin-top:6px' }, `${c.epithet}. ${c.rule}. Starts with ${E.ORGANS[c.startForm].name} and the ${E.CHASSIS[c.startChassis].name}.`))));
    });
    $('slot-add').hidden = setup.slots.length >= 6 || isGuest || (lobby && lobby.save);
    $('slot-note').textContent = `${setup.slots.length}/6 cultures`;
    // map controls
    const seg = (id, opts, key, fmt) => {
      const el = $(id); el.innerHTML = '';
      for (const [v, l] of opts) el.appendChild(h('button', { 'aria-pressed': String(setup.map[key] === v), disabled: isGuest || (lobby && lobby.save), onclick: () => { setup.map[key] = v; changed(); } }, l));
    };
    seg('map-size', Object.entries(E.MAP_SIZES).map(([k, v]) => [k, v.name]).concat([['custom', 'Custom']]), 'size');
    seg('map-layout', [['ring', 'Ring'], ['scatter', 'Scattered']], 'layout');
    $('map-custom').hidden = setup.map.size !== 'custom';
    $('map-w').value = setup.map.w || 4000; $('map-h').value = setup.map.h || 3000;
    $('map-w').disabled = $('map-h').disabled = isGuest || !!(lobby && lobby.save);
    seg('map-rich', [[0.6, 'Scarce'], [1, 'Normal'], [1.5, 'Lush']], 'richness');
    seg('map-pu', [[0, 'Off'], [1, 'Normal'], [2, 'Frequent']], 'powerups');
    seg('map-start', [[150, '150'], [220, '220'], [500, '500'], [1000, '1000']], 'startLumen');
    $('map-seed').value = setup.map.seed; $('map-seed').disabled = isGuest || !!(lobby && lobby.save);
    $('map-reseed').disabled = isGuest || !!(lobby && lobby.save);
    $('map-fog').checked = !!setup.map.fog; $('map-cur').checked = !!setup.map.currents;
    $('map-fog').disabled = $('map-cur').disabled = isGuest || !!(lobby && lobby.save);
    $('setup-start').hidden = isGuest;
    $('setup-start').textContent = lobby ? 'Start the match' : 'Begin the bloom';
    drawMapPreview();
  }
  function changed() {
    if (!lobby || lobby.role === 'host') { if (!lobby) { E.Settings.lastSetup = setup; E.saveSettings(); } }
    renderSetup();
    if (lobby && lobby.role === 'host') broadcastLobby();
  }
  function drawMapPreview() {
    const cv = $('map-preview'), r = cv.getBoundingClientRect(); if (!r.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = r.width * dpr; cv.height = r.height * dpr;
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const slots = setup.slots.filter(s => s.kind !== 'closed');
    const m = E.generateMap(setup.map, slots.map(s => ({ team: s.team })));
    const k = Math.min(r.width / m.w, r.height / m.h), ox = (r.width - m.w * k) / 2, oy = (r.height - m.h * k) / 2;
    ctx.fillStyle = '#020a0e'; ctx.fillRect(0, 0, r.width, r.height);
    ctx.save(); ctx.translate(ox, oy); ctx.scale(k, k);
    ctx.fillStyle = '#041218'; ctx.fillRect(0, 0, m.w, m.h);
    for (const c of m.currents) { ctx.strokeStyle = 'rgba(96,240,255,.12)'; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, E.TAU); ctx.stroke(); }
    for (const p of m.pools) { ctx.fillStyle = p.kind === 'spore' ? 'rgba(255,224,102,.8)' : 'rgba(160,250,255,.55)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.great ? 90 : 50, 0, E.TAU); ctx.fill(); }
    for (const v of m.vents) { ctx.fillStyle = 'rgba(255,180,120,.7)'; ctx.fillRect(v.x - 40, v.y - 40, 80, 80); }
    m.starts.forEach((s, i) => { const c = E.CULTURES[slots[i].culture]; ctx.fillStyle = c.hex[1]; ctx.shadowColor = c.hex[0]; ctx.shadowBlur = 30; ctx.beginPath(); ctx.arc(s.x, s.y, 110, 0, E.TAU); ctx.fill(); ctx.shadowBlur = 0; });
    ctx.restore();
    ctx.fillStyle = 'rgba(212,236,231,.6)'; ctx.font = '10px "Martian Mono", monospace'; ctx.fillText(`${m.w}×${m.h} · ${m.pools.length} pools · ${m.vents.length} vents`, 8, r.height - 8);
  }
  function bindSetup() {
    $('slot-add').onclick = () => {
      if (setup.slots.length >= 6) return;
      setup.slots.push({ kind: lobby ? 'open' : 'bot', culture: freeCulture(), team: 0, diff: 'normal' }); changed();
    };
    $('map-w').onchange = () => { setup.map.w = E.clamp(+$('map-w').value || 4000, 1600, 9600); changed(); };
    $('map-h').onchange = () => { setup.map.h = E.clamp(+$('map-h').value || 3000, 1200, 6400); changed(); };
    $('map-seed').onchange = () => { setup.map.seed = Math.max(1, Math.min(999999, +$('map-seed').value || 1)); changed(); };
    $('map-reseed').onclick = () => { setup.map.seed = 1 + Math.floor(Math.random() * 999998); changed(); };
    $('map-fog').onchange = () => { setup.map.fog = $('map-fog').checked; changed(); };
    $('map-cur').onchange = () => { setup.map.currents = $('map-cur').checked; changed(); };
    $('setup-start').onclick = () => startFromSetup();
    $('lobby-chat').onsubmit = e => {
      e.preventDefault(); const v = $('lobby-msg').value.trim(); $('lobby-msg').value = ''; if (!v || !lobby) return;
      if (lobby.role === 'host') { lobbyLog(playerName(), v); lobby.relay.send('all', { k: 'chat', from: playerName(), text: v }); }
      else lobby.relay.toHost({ k: 'chat', text: v });
    };
  }
  function lobbyLog(from, text) {
    const log = $('lobby-log'); log.appendChild(h('div', null, h('b', null, from + ': '), text)); log.scrollTop = 1e9; E.Audio.play('chat');
  }
  function buildCfg() {
    const slots = setup.slots;
    const players = slots.map(s => ({
      name: s.kind === 'you' ? playerName() : s.kind === 'human' ? s.name : E.CULTURES[s.culture].short,
      culture: s.culture, team: s.team || 0, kind: s.kind === 'you' ? 'human' : s.kind === 'human' ? 'remote' : 'bot', diff: s.diff || 'normal',
      designs: s.kind === 'you' ? E.Library.all().slice(0, 12) : [],
    }));
    return { map: Object.assign({}, setup.map), players };
  }
  function startFromSetup() {
    E.Audio.init();
    if (setup.slots.length < 2) { E.toast('Add at least one rival.'); return; }
    const teams = new Set(setup.slots.map((s, i) => s.team ? 't' + s.team : 'solo' + i));
    if (teams.size < 2) { E.toast('Everyone is on the same team. Put someone on another team.'); return; }
    if (lobby) {
      for (const s of setup.slots) if (s.kind === 'open') { s.kind = 'bot'; s.diff = 'normal'; }
      const peers = new Map();
      setup.slots.forEach((s, i) => { if (s.kind === 'human') peers.set(s.peer, { slot: i, name: s.name }); });
      const local = setup.slots.findIndex(s => s.kind === 'you');
      const relay = lobby.relay;
      if (lobby.save) {
        const st = JSON.parse(lobby.save.state);
        st.players.forEach((p, i) => { const s = setup.slots[i]; if (s.kind === 'human') { p.kind = 'remote'; p.name = s.name; p.dropped = false; } else if (s.kind === 'you') { p.kind = 'human'; } else if (p.kind !== 'bot') { p.kind = 'bot'; p.dropped = true; p.diff = p.diff || 'normal'; } });
        lobby = null;
        game.start({ mode: 'host', save: st, local, relay, peers });
      } else {
        const cfg = buildCfg(); lobby = null;
        game.start({ mode: 'host', cfg, local, relay, peers });
      }
      return;
    }
    const cfg = buildCfg();
    E.Settings.lastSetup = setup; E.saveSettings();
    game.start({ mode: 'local', cfg, local: setup.slots.findIndex(s => s.kind === 'you') });
  }

  // ── multiplayer lobby ───────────────────────────────────────────
  function lobbyView() { return { k: 'lobby', setup, room: lobby.room, save: !!lobby.save }; }
  function broadcastLobby() { if (lobby && lobby.role === 'host') lobby.relay.send('all', lobbyView()); }
  async function connect() {
    const url = $('mp-server').value.trim() || E.Relay.defaultUrl();
    E.Settings.server = $('mp-server').value.trim(); E.Settings.name = $('mp-name').value.trim(); E.saveSettings();
    $('mp-status').textContent = 'Connecting to ' + url + '…';
    const r = new E.Relay();
    try { await r.connect(url); } catch (e) { $('mp-status').textContent = e.message + '. Is the server running?'; return null; }
    $('mp-status').textContent = 'Connected.';
    return r;
  }
  async function hostGame(save) {
    const r = await connect(); if (!r) return;
    r.on('hosted', m => {
      lobby = { role: 'host', relay: r, room: m.room, id: 0, save: save || null };
      if (save) {
        const st = JSON.parse(save.state), local = save.extra && save.extra.local !== undefined ? save.extra.local : 0;
        setup = { map: Object.assign({}, st.cfg.map), slots: st.players.map((p, i) => ({ kind: i === local ? 'you' : p.kind === 'bot' ? 'bot' : 'open', culture: p.culture, team: p.team, diff: p.diff || 'normal', name: p.name })) };
      } else {
        setup = defaultSetup();
        const mine = setup.slots[0].culture;
        setup.slots = [{ kind: 'you', culture: mine, team: 0, diff: 'normal' }, { kind: 'open', culture: E.CULTURE_LIST.find(c => c.id !== mine).id, team: 0, diff: 'normal' }];
      }
      $('lobby-log').innerHTML = ''; lobbyLog('Room', `Share code ${m.room}. Friends open this page, choose Multiplayer, and enter the code.`);
      E.Screens.show('scr-setup'); renderSetup();
    });
    r.on('peer', m => {
      if (!lobby) return;
      let s = setup.slots.find(s => s.kind === 'open' && (!lobby.save || s.name === m.name)) || setup.slots.find(s => s.kind === 'open');
      if (!s && setup.slots.length < 6 && !lobby.save) { s = { kind: 'open', culture: freeCulture(), team: 0, diff: 'normal' }; setup.slots.push(s); }
      if (!s) { r.kick(m.id); return; }
      s.kind = 'human'; s.peer = m.id; s.name = m.name;
      lobbyLog('Room', `${m.name} joined`); changed();
    });
    r.on('left', m => { if (!lobby) return; const s = setup.slots.find(s => s.peer === m.id); if (s) { s.kind = 'open'; delete s.peer; lobbyLog('Room', `${s.name} left`); changed(); } });
    r.on('msg', m => {
      if (!lobby) return;
      const d = m.data, s = setup.slots.find(s => s.peer === m.from);
      if (d.k === 'pick' && s) { if (!lobby.save) { setCulture(s, d.culture); s.team = d.team || 0; } changed(); }
      else if (d.k === 'chat' && s) { lobbyLog(s.name, String(d.text).slice(0, 140)); r.send('all', { k: 'chat', from: s.name, text: String(d.text).slice(0, 140) }); }
      else if (d.k === 'hello') broadcastLobby();
    });
    r.on('close', () => { if (lobby) { E.toast('Disconnected from relay'); lobby = null; E.Screens.show('scr-mp'); } });
    r.host(playerName());
  }
  async function joinGame() {
    const code = $('mp-code').value.trim().toUpperCase(); if (code.length < 4) { $('mp-status').textContent = 'Enter the 4-letter room code.'; return; }
    const r = await connect(); if (!r) return;
    r.on('joined', m => { lobby = { role: 'guest', relay: r, room: m.room, id: m.id }; setup = { map: E.deepCopy(E.DEFAULT_MAP), slots: [] }; $('lobby-log').innerHTML = ''; r.toHost({ k: 'hello' }); E.Screens.show('scr-setup'); renderSetup(); });
    r.on('error', m => { $('mp-status').textContent = m.msg; E.toast(m.msg); });
    r.on('msg', m => {
      const d = m.data;
      if (d.k === 'lobby' && lobby) { setup = d.setup; lobby.save = d.save; renderSetup(); }
      else if (d.k === 'chat') lobbyLog(d.from, d.text);
      else if (d.k === 'init') { const rl = lobby ? lobby.relay : r; lobby = null; game.start({ mode: 'guest', init: d, relay: rl }); }
    });
    r.on('closed', () => { E.toast('The host closed the room.'); lobby = null; E.Screens.show('scr-mp'); });
    r.join(code, playerName());
  }

  // ── load screen ─────────────────────────────────────────────────
  function renderLoad() {
    const list = $('save-list'); list.innerHTML = '';
    const saves = E.Saves.list();
    if (!saves.length) list.appendChild(h('p', { style: 'color:var(--ink-dim)' }, 'No saved games yet. Games autosave while you play.'));
    for (const m of saves) {
      const dots = h('div', { class: 'dots' }, m.players.map(p => h('i', { style: `background:${E.CULTURES[p.c].hex[1]};opacity:${p.a ? 1 : 0.3}`, title: p.n })));
      const humans = m.players.filter(p => p.k === 'remote' || p.k === 'human').length;
      list.appendChild(h('div', { class: 'save-item' },
        h('div', null, h('b', null, m.name || (m.id === 'auto' ? 'Autosave' : m.id)), h('small', null, `${new Date(m.date).toLocaleString()} · ${E.fmtTime(m.time)} · ${E.MAP_SIZES[m.size] ? E.MAP_SIZES[m.size].name : 'Custom'} · ${m.players.length} cultures`), dots),
        h('div', { class: 'row', style: 'flex-wrap:nowrap' },
          h('button', { class: 'btn small primary', onclick: () => loadSave(m.id) }, 'Play'),
          humans > 1 ? h('button', { class: 'btn small', onclick: () => { const d = E.Saves.read(m.id); if (d) { E.Screens.show('scr-mp'); hostGame(d); } } }, 'Host') : null,
          h('button', { class: 'btn small', onclick: () => exportSave(m.id) }, '⤓'),
          h('button', { class: 'btn small ghost', 'aria-label': 'Delete', onclick: async () => { if (await E.confirm('Delete save?', m.name || m.id, 'Delete')) { E.Saves.remove(m.id); renderLoad(); } } }, '✕'))));
    }
  }
  function loadSave(id, data) {
    data = data || E.Saves.read(id);
    if (!data) { E.toast('Save not found'); return; }
    let st;
    try { st = typeof data.state === 'string' ? JSON.parse(data.state) : data.state; } catch (e) { E.toast('That save is damaged'); return; }
    const local = data.extra && data.extra.local !== undefined ? data.extra.local : Math.max(0, st.players.findIndex(p => p.kind === 'human'));
    st.players.forEach((p, i) => { if (i === local) p.kind = 'human'; else if (p.kind !== 'bot') { p.kind = 'bot'; p.diff = p.diff || 'normal'; p.dropped = true; } });
    E.Audio.init();
    game.start({ mode: 'local', save: st, local });
    E.toast('Resumed');
  }
  function exportSave(id) {
    const d = E.Saves.read(id); if (!d) return;
    const blob = new Blob([JSON.stringify(Object.assign({ efflorescent: 1 }, d))], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `efflorescent-${id}.json` }); document.body.appendChild(a); a.click(); a.remove();
  }

  // ── settings ────────────────────────────────────────────────────
  function renderSettings() {
    const S = E.Settings, body = $('settings-body'); body.innerHTML = '';
    const seg = (label, key, opts, after) => {
      const el = h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { 'aria-pressed': String(S[key] === v), onclick: () => { S[key] = v; E.saveSettings(); if (after) after(); renderSettings(); } }, l)));
      return h('div', { class: 'field' }, h('label', null, label), el);
    };
    const tog = (label, key) => { const i = h('input', { type: 'checkbox' }); i.checked = !!S[key]; i.onchange = () => { S[key] = i.checked; E.saveSettings(); }; return h('div', { class: 'toggle-row' }, h('span', null, label), h('label', { class: 'switch' }, i, h('i'))); };
    const slider = (label, key) => { const i = h('input', { type: 'range', min: 0, max: 100, value: Math.round(S[key] * 100) }); i.oninput = () => { S[key] = i.value / 100; E.saveSettings(); E.Audio.apply(); }; return h('div', { class: 'field' }, h('label', null, label), i); };
    const nameIn = h('input', { type: 'text', maxlength: 18, value: S.name, placeholder: 'Tender' }); nameIn.onchange = () => { S.name = nameIn.value.trim(); E.saveSettings(); };
    body.appendChild(h('div', { class: 'card' }, h('h3', null, 'Display & sound'),
      h('div', { class: 'field' }, h('label', null, 'Your name'), nameIn),
      seg('Graphics quality', 'quality', [['auto', 'Auto'], ['high', 'High'], ['low', 'Low (battery saver)']], () => { game.renderer.quality = S.quality === 'low' ? 'low' : 'high'; game.resize(); }),
      seg('Interface size', 'uiScale', [[0.9, 'S'], [1, 'M'], [1.15, 'L'], [1.3, 'XL']], applyUi),
      slider('Music', 'music'), slider('Effects', 'sfx'), tog('Health bars on damaged creatures', 'showHp'), tog('Vibration (touch)', 'haptics')));
    body.appendChild(h('div', { class: 'card' }, h('h3', null, 'Controls'),
      tog('Tap ground to command (touch)', 'tapCommand'), tog('Pan at screen edges (mouse)', 'edgePan'), tog('Invert wheel zoom', 'invertZoom'),
      seg('Right-click / tap on ground', 'rightClick', [['amove', 'Attack-move'], ['move', 'Move']]),
      tog('Show first-game tips', 'tips'),
      h('button', { class: 'btn small', style: 'margin-top:8px', onclick: () => { S.guideStep = 0; S.tips = true; E.saveSettings(); E.toast('Tips will start again next match'); renderSettings(); } }, 'Restart tips'),
      h('div', { style: 'height:12px' }),
      h('button', { class: 'btn danger small', onclick: async () => { if (await E.confirm('Erase all data?', 'Deletes settings, saves and your design library on this device.', 'Erase')) { localStorage.clear(); location.reload(); } } }, 'Erase all local data')));
  }
  function applyUi() { document.documentElement.style.setProperty('--ui', E.Settings.uiScale || 1); }

  // ── screen routing ──────────────────────────────────────────────
  E.Menus = {
    home() {
      lobby = null;
      $('bg').hidden = false; E.Screens.stack = []; E.Screens.show('scr-menu');
      $('m-continue').hidden = !E.Saves.read('auto');
    },
    openCodex(fromGame) { overGame('scr-codex', fromGame); E.Codex.render($('codex-tabs'), $('codex-body')); },
    openSettings(fromGame) { overGame('scr-settings', fromGame); renderSettings(); },
  };
  function overGame(id, fromGame) {
    const el = $(id);
    if (fromGame) { el.hidden = false; el.style.zIndex = 30; el.dataset.overGame = '1'; el.scrollTop = 0; }
    else { el.style.zIndex = ''; delete el.dataset.overGame; E.Screens.show(id); }
  }
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => {
    const scr = b.closest('.screen');
    if (scr.dataset.overGame) { scr.hidden = true; scr.style.zIndex = ''; delete scr.dataset.overGame; return; }
    if (scr.id === 'scr-setup' && lobby) { lobby.relay.close(); lobby = null; }
    E.Screens.back();
  }));

  $('m-continue').onclick = () => loadSave('auto');
  $('m-skirmish').onclick = () => { E.Audio.init(); lobby = null; setup = defaultSetup(); E.Screens.show('scr-setup'); renderSetup(); };
  $('m-mp').onclick = () => { E.Audio.init(); $('mp-name').value = E.Settings.name || ''; $('mp-server').value = E.Settings.server || ''; $('mp-server').placeholder = E.Relay.defaultUrl(); $('mp-status').textContent = location.protocol === 'file:' ? 'Tip: open the game from the server URL for multiplayer.' : ''; E.Screens.show('scr-mp'); };
  $('m-load').onclick = () => { E.Screens.show('scr-load'); renderLoad(); };
  $('m-settings').onclick = () => E.Menus.openSettings(false);
  $('m-codex').onclick = () => E.Menus.openCodex(false);
  $('m-forge').onclick = () => { E.Screens.show('scr-forge'); if (!forgeLab) forgeLab = new E.Forge($('forge-lab'), { mode: 'lab' }); else forgeLab.renderAll(); };
  $('mp-host').onclick = () => hostGame(null);
  $('mp-join').onclick = () => joinGame();
  $('load-import').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const d = JSON.parse(await f.text()); if (!d.state) throw new Error('bad'); loadSave(null, d); } catch (err) { E.toast('That file is not an Efflorescent save'); }
  };
  window.addEventListener('resize', () => { if (!$('scr-setup').hidden && setup) drawMapPreview(); });
  bindSetup();

  // ── boot ────────────────────────────────────────────────────────
  applyUi();
  if (E.Settings.backend === 'webgpu' || /[?&]bench/.test(location.search)) E.loadWebGPU();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !/[?&]nosw/.test(location.search)) navigator.serviceWorker.register('sw.js').catch(() => {});
  requestAnimationFrame(bgFrame);
  E.Menus.home();
  $('loading').remove();
  // Let tests and power users start directly: ?quick=1
  const q = new URLSearchParams(location.search);
  if (q.get('quick')) { setup = defaultSetup(); if (q.get('size')) setup.map.size = q.get('size'); if (q.get('n')) { const n = +q.get('n'); while (setup.slots.length < n) setup.slots.push({ kind: 'bot', culture: freeCulture(), team: 0, diff: 'normal' }); } startFromSetup(); }
})(window.E);
