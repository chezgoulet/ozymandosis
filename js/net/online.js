// Online services (play.ozymandosis.com): account, membership, announcements,
// quick match, lobby connections, match tickets and reports. Matches still run
// peer to peer (js/net/net.js); this module only talks to the matchmaking service.
(function (E) {
  'use strict';
  E.VERSION = '1.1.0';
  const O = E.Online = { me: null, ent: null, config: null, announcements: [], chatLog: [], listeners: new Set() };
  const TOKEN = 'efl.session';

  O.base = function () {
    const q = new URLSearchParams(location.search).get('play');
    if (q) return q.replace(/\/$/, '');
    if (E.Settings.playServer) return E.Settings.playServer.replace(/\/$/, '');
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return 'http://localhost:8787';
    return 'https://play.ozymandosis.com';
  };
  O.wsUrl = () => O.base().replace(/^http/, 'ws') + '/ws';
  O.token = () => E.LS.get(TOKEN, null);
  O.setToken = t => { if (t) E.LS.set(TOKEN, t); else E.LS.del(TOKEN); };
  O.signedIn = () => !!O.token();
  O.on = fn => { O.listeners.add(fn); return () => O.listeners.delete(fn); };
  const changed = () => { for (const fn of O.listeners) try { fn(O); } catch (e) { console.error(e); } };

  O.api = async function (method, path, body) {
    const t = O.token();
    let r;
    try { r = await fetch(O.base() + path, { method, headers: Object.assign({ 'content-type': 'application/json' }, t ? { authorization: 'Bearer ' + t } : {}), body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { const err = new Error('Could not reach the Ozymandosis servers. Check your connection.'); err.offline = true; throw err; }
    let j = {}; try { j = await r.json(); } catch (e) { /* empty body */ }
    if (r.status === 401 && t && !/\/auth\//.test(path)) { O.setToken(null); O.me = null; O.ent = null; changed(); }
    if (!r.ok) { const e = new Error(j.error || 'Something went wrong.'); e.code = j.code; e.status = r.status; throw e; }
    return j;
  };
  O.openExternal = function (url) {
    const B = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Browser;
    if (B && B.open) B.open({ url }).catch(() => window.open(url, '_blank', 'noopener'));
    else window.open(url, '_blank', 'noopener');
  };

  // ── account ──────────────────────────────────────────────────────
  O.refresh = async function () {
    try { O.config = await O.api('GET', '/api/config'); } catch (e) { O.config = O.config || null; }
    if (O.signedIn()) {
      try { const r = await O.api('GET', '/api/me'); O.me = r.user; O.ent = r.entitlements; O.notice = r.notice; } catch (e) { if (e.status === 401) { O.me = null; O.ent = null; } }
    }
    try { O.announcements = (await O.api('GET', '/api/announcements')).announcements || []; } catch (e) { /* offline */ }
    changed();
    return O;
  };
  O.login = async function (email, password) {
    const r = await O.api('POST', '/api/auth/login', { email, password, client: 'game' });
    if (r.mfa) return { mfa: r.challenge };
    O.setToken(r.token); await O.refresh(); return { ok: true };
  };
  O.signup = async function (email, password, name) {
    const r = await O.api('POST', '/api/auth/signup', { email, password, name: name || undefined, client: 'game' });
    O.setToken(r.token); await O.refresh(); return { ok: true, verifyEmail: r.verifyEmail };
  };
  O.mfa = async function (challenge, code, recovery) {
    const r = await O.api('POST', '/api/auth/mfa', recovery ? { challenge, recovery: code } : { challenge, code });
    O.setToken(r.token); await O.refresh(); return { ok: true };
  };
  O.logout = async function () { try { await O.api('POST', '/api/auth/logout'); } catch (e) { /* gone anyway */ } O.setToken(null); O.me = null; O.ent = null; changed(); };
  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // Sign in through the browser (any provider). The client keeps a secret and polls with it.
  O.browserSignIn = async function (provider, onWait) {
    const verifier = b64u(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const r = await O.api('POST', '/api/auth/handoff', { challenge });
    O.openExternal(provider ? `${O.base()}/auth/${provider}/start?handoff=${encodeURIComponent(challenge)}` : r.url);
    const cancel = { done: false };
    if (onWait) onWait(cancel);
    const t0 = Date.now();
    while (!cancel.done && Date.now() - t0 < 10 * 60e3) {
      await new Promise(res => setTimeout(res, 2000));
      if (cancel.done) break;
      let c; try { c = await O.api('POST', '/api/auth/handoff/claim', { verifier }); } catch (e) { if (e.offline) continue; throw e; }
      if (c.token) { O.setToken(c.token); await O.refresh(); return { ok: true }; }
    }
    return { cancelled: true };
  };
  O.accountUrl = (path) => O.base() + (path || '/account');
  O.subscribe = async function () {
    if (!O.signedIn()) throw new Error('Sign in first.');
    const r = await O.api('POST', '/api/billing/checkout');
    O.openExternal(r.url);
  };

  // ── lobby connection (one per lobby, authenticated) ──────────────
  O.openRelay = async function () {
    if (!O.signedIn()) { const e = new Error('Sign in to play online.'); e.code = 'signin'; throw e; }
    const r = new E.Relay({ relayOnly: !!E.Settings.relayOnly });
    await r.connect(O.wsUrl());
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('The server did not answer. Try again.')), 8000);
      r.on('hello', m => { clearTimeout(to); O.me = m.user; O.ent = m.ent; O.key = m.key; O.announcements = m.announcements || O.announcements; O.hello = m; changed(); res(r); });
      const fail = m => { clearTimeout(to); r.close(); const e = new Error(m.msg || 'Could not connect.'); e.code = m.code || m.op; if (m.code === 'unauthorized') { O.setToken(null); changed(); } rej(e); };
      r.on('error', fail); r.on('upgrade', fail); r.on('maintenance', fail); r.on('kicked', fail);
      r.raw({ op: 'auth', token: O.token(), version: E.VERSION, platform: (E.Native && E.Native.is ? E.Native.platform : 'web') });
    });
  };
  // Shared pushes on a lobby connection (announcements, account changes, being kicked).
  O.wire = function (r) {
    r.on('announcement', m => { O.announcements = [m.announcement, ...O.announcements.filter(a => a.id !== m.announcement.id)]; changed(); O.showAnnouncement(m.announcement); });
    r.on('announcement.end', m => { O.announcements = O.announcements.filter(a => a.id !== m.id); changed(); });
    r.on('me', m => { O.me = m.user; O.ent = m.ent; if (O.hello) O.hello.config = Object.assign(O.hello.config || {}, m.config); changed(); });
    r.on('kicked', m => E.modal('Signed out of online play', m.msg));
    r.on('maintenance', m => E.toast(m.msg, 6000));
  };

  // ── match tickets: verify the server's Ed25519 signature ─────────
  O.verifyTicket = async function (ticket) {
    const [kid, body, sig] = String(ticket || '').split('.');
    const dec = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
    let payload; try { payload = JSON.parse(new TextDecoder().decode(dec(body))); } catch (e) { return null; }
    const key = O.key || (O.config && O.config.ticketKey);
    if (!key || key.kid !== kid) return null;
    try {
      const k = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: key.x }, { name: 'Ed25519' }, false, ['verify']);
      const ok = await crypto.subtle.verify({ name: 'Ed25519' }, k, dec(sig), new TextEncoder().encode(body));
      return ok ? payload : null;
    } catch (e) {
      // Browsers without Ed25519 in WebCrypto: accept, but mark unverified (the host still enforces).
      payload.unverified = true; return payload;
    }
  };

  // ── reports ──────────────────────────────────────────────────────
  O.reportPlayer = (target, reason, details, chat, match) => O.api('POST', '/api/player-reports', { target, reason, details, chat: (chat || O.chatLog).slice(-30), match: match || undefined });
  O.logChat = (from, text) => { O.chatLog.push({ from: String(from).slice(0, 40), text: String(text).slice(0, 200) }); if (O.chatLog.length > 60) O.chatLog.shift(); };

  // ── announcements ────────────────────────────────────────────────
  const dismissed = () => new Set(E.LS.get('efl.news.dismissed', []));
  O.dismiss = id => { const d = dismissed(); d.add(id); E.LS.set('efl.news.dismissed', [...d].slice(-50)); changed(); };
  O.visibleNews = () => { const d = dismissed(); return O.announcements.filter(a => !d.has(a.id)); };
  O.showAnnouncement = a => { if (E.game && E.game.running) E.game.notify(`${a.title}: ${a.body}`, a.severity === 'critical' ? 'alert' : 'info'); };

  // Sign-in dialog used from the menus and settings.
  O.signInDialog = async function () {
    if (!O.config) await O.refresh().catch(() => {});
    return new Promise(done => {
      const h = E.h;
      const bg = h('div', { class: 'modal-bg' }), box = h('div', { class: 'modal signin', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'si-t' });
      const close = v => { bg.remove(); done(v); };
      const err = h('p', { class: 'form-err', role: 'alert' });
      const say = m => { err.textContent = m || ''; };
      let mode = 'in';
      const render = () => {
        say('');
        const email = h('input', { type: 'email', autocomplete: 'email', placeholder: 'you@example.com', 'aria-label': 'Email' });
        const pass = h('input', { type: 'password', autocomplete: mode === 'in' ? 'current-password' : 'new-password', placeholder: mode === 'in' ? 'Password' : 'Password (10 characters or more)', 'aria-label': 'Password' });
        const name = h('input', { type: 'text', maxlength: 18, placeholder: 'Display name (optional)', 'aria-label': 'Display name' });
        const go = h('button', { class: 'btn primary', type: 'submit' }, mode === 'in' ? 'Sign in' : 'Create account');
        const form = h('form', { class: 'si-form' }, email, pass, mode === 'up' ? name : null, go);
        form.onsubmit = async e => {
          e.preventDefault(); go.disabled = true; say('');
          try {
            const r = mode === 'in' ? await O.login(email.value, pass.value) : await O.signup(email.value, pass.value, name.value);
            if (r.mfa) return mfaStep(r.mfa);
            if (r.verifyEmail) E.toast('Check your email to confirm your address.', 4000);
            close(true);
          } catch (x) { say(x.message); go.disabled = false; }
        };
        const provs = ((O.config && O.config.providers) || []).filter(p => p !== 'dev' || /localhost/.test(O.base()));
        const names = { google: 'Google', apple: 'Apple', discord: 'Discord', github: 'GitHub', steam: 'Steam', dev: 'Dev' };
        const pbtn = p => h('button', { class: 'btn small', type: 'button', onclick: () => viaBrowser(p) }, names[p] || p);
        box.replaceChildren(
          h('h3', { id: 'si-t' }, 'Play online'),
          h('p', { class: 'si-note' }, 'Matches run directly between players, encrypted. An account finds your rivals and keeps your rating.'),
          h('div', { class: 'seg', role: 'tablist' }, h('button', { type: 'button', 'aria-pressed': String(mode === 'in'), onclick: () => { mode = 'in'; render(); } }, 'Sign in'), h('button', { type: 'button', 'aria-pressed': String(mode === 'up'), onclick: () => { mode = 'up'; render(); } }, 'New account')),
          form,
          provs.length ? h('div', { class: 'si-providers' }, h('span', { class: 'lbl' }, 'Or continue with'), h('div', { class: 'row' }, provs.map(pbtn))) : null,
          err,
          h('div', { class: 'row' }, h('button', { class: 'btn small ghost', type: 'button', onclick: () => O.openExternal(O.accountUrl('/login')) }, 'Forgot password?'), h('button', { class: 'btn small', type: 'button', onclick: () => close(false) }, 'Not now')));
        setTimeout(() => email.focus(), 30);
      };
      const mfaStep = challenge => {
        let rec = false;
        const code = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '6-digit code', maxlength: 12, 'aria-label': 'Authenticator code' });
        const go = h('button', { class: 'btn primary', type: 'submit' }, 'Continue');
        const form = h('form', { class: 'si-form' }, code, go);
        const tog = h('button', { class: 'btn small ghost', type: 'button' }, 'Use a recovery code');
        tog.onclick = () => { rec = !rec; code.placeholder = rec ? 'Recovery code' : '6-digit code'; tog.textContent = rec ? 'Use my authenticator' : 'Use a recovery code'; code.focus(); };
        form.onsubmit = async e => { e.preventDefault(); go.disabled = true; try { await O.mfa(challenge, code.value, rec); close(true); } catch (x) { say(x.message); go.disabled = false; } };
        box.replaceChildren(h('h3', null, 'Two-factor sign-in'), h('p', { class: 'si-note' }, 'Enter the code from your authenticator app.'), form, err, h('div', { class: 'row' }, tog, h('button', { class: 'btn small', type: 'button', onclick: () => close(false) }, 'Cancel')));
        setTimeout(() => code.focus(), 30);
      };
      const viaBrowser = async p => {
        const stop = h('button', { class: 'btn small', type: 'button' }, 'Cancel');
        box.replaceChildren(h('h3', null, 'Finish in your browser'), h('p', { class: 'si-note' }, 'A browser window opened. Sign in there, then come back: the game signs you in by itself.'), h('div', { class: 'spinner', 'aria-hidden': 'true' }), err, h('div', { class: 'row' }, stop));
        try {
          const r = await O.browserSignIn(p, c => { stop.onclick = () => { c.done = true; render(); }; });
          if (r.ok) close(true);
        } catch (x) { say(x.message); }
      };
      render();
      bg.appendChild(box); document.body.appendChild(bg);
      bg.addEventListener('click', e => { if (e.target === bg) close(false); });
    });
  };
  // Membership prompt shown when a free match ends at the limit.
  O.membershipDialog = async function (why) {
    const mins = (O.ent && O.ent.freeMatchMinutes) || (O.config && O.config.freeMatchMinutes) || 15;
    const v = await E.modal('Keep the bloom going', `${why ? why + ' ' : ''}Free online matches last ${mins} minutes. Membership removes the limit for $1 a month and pays for the servers that introduce players.`, [{ label: 'Not now', value: false }, { label: 'Become a member', value: true, primary: true }]);
    if (v) { try { await O.subscribe(); } catch (e) { E.toast(e.message); } }
  };
})(window.E);
