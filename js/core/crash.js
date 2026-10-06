// SPDX-License-Identifier: AGPL-3.0-only
// Automatic crash reports and the "Report a bug" dialog. Reports carry the
// error, the build, the renderer and a small game summary, never personal
// data; players can turn automatic reports off in Settings.
(function (E) {
  'use strict';
  const C = E.Crash = { log: [], sent: new Set(), count: 0 };
  // a small ring of recent warnings/errors for context
  for (const lvl of ['warn', 'error']) {
    const orig = console[lvl].bind(console);
    console[lvl] = (...a) => { try { C.log.push(`[${lvl}] ` + a.map(x => (x && x.stack) || String(x)).join(' ').slice(0, 500)); if (C.log.length > 40) C.log.shift(); } catch (e) { /* never break logging */ } orig(...a); };
  }
  C.context = function () {
    const g = E.game, w = g && g.world, S = E.Settings || {};
    return {
      settings: { backend: S.backend, quality: S.quality, uiScale: S.uiScale, orientation: S.orientation },
      backend: g && g.renderer ? g.renderer.kind || 'canvas2d' : null, tier: g && g.renderer ? g.renderer.tierName || g.renderer.quality : null,
      fps: g && g.governor ? Math.round(g.governor.fps || 0) : null, mode: g ? g.netMode : 'menu', players: w ? w.s.players.length : null,
      mapSize: w ? w.s.cfg.map.size : null, time: w ? Math.round(w.s.t) : null, units: w ? w.s.units.length : null,
      screen: `${innerWidth}x${innerHeight}@${devicePixelRatio || 1}`, memory: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB' : null,
      lang: navigator.language, url: location.pathname, log: C.log.slice(-25).join('\n'),
    };
  };
  const platform = () => {
    if (E.Native && E.Native.is) return E.Native.platform;
    const ua = navigator.userAgent;
    return (/Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'web') + ' web';
  };
  C.send = async function (report) {
    if (!E.Online) return false;
    const body = Object.assign({ version: E.VERSION || '?', platform: platform(), renderer: (E.game && E.game.renderer && E.game.renderer.kind) || 'n/a', context: C.context() }, report);
    try { await E.Online.api('POST', '/api/reports', body); return true; } catch (e) { return false; }
  };
  C.crash = function (err, where) {
    if (E.Settings && E.Settings.crashReports === false) return;
    const message = String((err && err.message) || err || 'Unknown error').slice(0, 1000), stack = String((err && err.stack) || '').slice(0, 20000);
    const key = message + '|' + stack.split('\n')[1];
    if (C.sent.has(key) || C.count >= 6) return;  // once per distinct error, a few per session
    C.sent.add(key); C.count++;
    C.send({ kind: 'crash', message: (where ? `[${where}] ` : '') + message, stack });
  };
  window.addEventListener('error', e => { if (e.error || e.message) C.crash(e.error || e.message, 'window'); });
  window.addEventListener('unhandledrejection', e => C.crash(e.reason, 'promise'));

  // "Report a bug": description plus an optional screenshot of the game.
  C.dialog = async function () {
    const h = E.h;
    let shot = null;
    if (E.game && E.game.running && E.game.capture) shot = await E.game.capture().catch(() => null);
    const text = h('textarea', { rows: 5, maxlength: 4000, placeholder: 'What happened? What did you expect? Steps to make it happen again help a lot.', 'aria-label': 'Describe the bug' });
    const inc = h('input', { type: 'checkbox' }); inc.checked = !!shot;
    const body = h('div', { class: 'si-form' }, text, shot ? h('label', { class: 'check' }, inc, h('span', null, 'Include a screenshot of the game')) : null,
      h('small', { class: 'hint-s' }, 'We also send the game version, your device type and renderer, and recent warnings. Nothing personal.'));
    setTimeout(() => text.focus(), 30);
    const ok = await E.modal('Report a bug', body, [{ label: 'Cancel', value: false }, { label: 'Send report', value: true, primary: true }]);
    if (!ok) return;
    if (text.value.trim().length < 5) { E.toast('Please describe the problem.'); return; }
    const sent = await C.send({ kind: 'bug', description: text.value.trim(), message: text.value.trim().slice(0, 120), screenshot: shot && inc.checked ? shot : undefined });
    E.toast(sent ? 'Thank you. The report is with the team.' : 'Could not send the report. Check your connection.');
  };
})(window.E);
