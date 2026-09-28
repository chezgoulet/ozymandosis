// Online services (play.ozymandosis.com): account, membership, announcements,
// quick match, lobby connections, match tickets and reports. Matches still run
// peer to peer (js/net/net.js); this module only talks to the matchmaking service.
(function (E) {
  'use strict';
  E.VERSION = '0.5.0';
  const O = E.Online = { me: null, ent: null, config: null, announcements: [], chatLog: [], listeners: new Set() };
  const TOKEN = 'efl.session';

  // Where this copy came from decides whether it may sell anything. App stores and
  // Steam require their own payment systems for digital goods, so store builds never
  // show prices, checkout or code redemption; memberships bought on the web still apply.
  O.store = (() => {
    const q = new URLSearchParams(location.search).get('store');
    if (q) return q;
    if (E.Native && E.Native.is) return E.Native.platform; // 'ios' | 'android'
    return 'web';
  })();
  // Android sells through Google Play Billing (PlayBillingPlugin); the service
  // verifies every purchase with Google and binds it to the account. Other store
  // builds (iOS, Steam) do not sell yet, and no store build redeems codes.
  O.play = () => O.store === 'android' && window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.PlayBilling;
  O.canPurchase = () => O.store === 'web' || O.store === 'direct' || !!O.play();
  O.canRedeem = () => O.store === 'web' || O.store === 'direct';
  O.platform = () => (E.Native && E.Native.is ? E.Native.platform : 'web');
  const PLAY_PLAN = { month: 'monthly', year: 'annual' };
  O.playPlans = null;
  // Prices from the store on mobile (Play formats them), from the service (Stripe) elsewhere; tax included.
  O.price = plan => {
    if (O.play()) { const p = (O.playPlans || []).find(x => x.plan === PLAY_PLAN[plan || 'month']); return p ? p.price : null; }
    const p = O.config && (O.config.plans || []).find(x => x.plan === (plan || 'month'));
    if (!p) return plan === 'year' ? null : '$2';
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency.toUpperCase(), minimumFractionDigits: p.amount % 100 ? 2 : 0 }).format(p.amount / 100); } catch (e) { return '$' + (p.amount / 100); }
  };
  O.priceLabel = () => O.price('month') ? `${O.price('month')}/month` + (O.price('year') ? ` or ${O.price('year')}/year` : '') : 'prices in Google Play';

  // Chat words blocked in local-network games (online chat is filtered by the service).
  const BLOCK = ['fuck', 'shit', 'nigg', 'fagot', 'faggot', 'retard', 'hitler', 'kike', 'trany', 'whore', 'motherfuck'];
  const BLOCK_WORDS = ['cunt', 'rape', 'rapist', 'nazi', 'spic', 'chink', 'slut', 'cock', 'dick', 'pusy', 'porn', 'kys', 'fag', 'twat', 'wank'];
  const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'i' };
  const skel = w => w.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[0-9@$!|]/g, c => LEET[c] || c).replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
  E.filterChat = text => String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 140).replace(/\S+/g, w => { const k = skel(w); return BLOCK.some(b => k.includes(skel(b))) || BLOCK_WORDS.includes(k) ? '•'.repeat(Math.min(8, w.length)) : w; });
  // Quick chat phrases (the service sends its list; this is the offline copy).
  E.QUICK_CHAT = ['Hello!', 'Good luck, have fun', 'Good game', 'Well played', 'Nice!', 'Oops', 'Thanks', 'Sorry', 'One moment', 'Let’s go', 'Help!', 'Attack here', 'Defend here', 'Rematch?'];
  O.quickChat = () => (O.hello && O.hello.config && O.hello.config.quickChat) || E.QUICK_CHAT;
  O.chatMode = () => (O.hello && O.hello.config && O.hello.config.chat) || (O.me && O.me.chat) || 'all';

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
      try { const r = await O.api('GET', '/api/me?platform=' + O.platform()); O.me = r.user; O.ent = r.entitlements; O.notice = r.notice; } catch (e) { if (e.status === 401) { O.me = null; O.ent = null; } }
    }
    try { O.announcements = (await O.api('GET', '/api/announcements')).announcements || []; } catch (e) { /* offline */ }
    if (O.play()) {
      if (!O.playPlans) O.play().products({}).then(r => { O.playPlans = r.plans || []; changed(); }).catch(() => {});
      if (O.signedIn() && O.me && !O.restored) { O.restored = true; O.restorePlay().catch(() => {}); }
    }
    changed();
    return O;
  };
  // Hand every purchase Play knows about to the service (a reinstall, a new phone, a
  // purchase that finished while the game was closed). The service decides; this never grants.
  O.restorePlay = async function () {
    const P = O.play(); if (!P || !O.signedIn()) return;
    const r = await P.restore(); let any = false;
    for (const p of r.purchases || []) { try { await O.api('POST', '/api/billing/play/verify', { purchaseToken: p.purchaseToken }); any = true; } catch (e) { /* another account's, or not a membership */ } }
    if (any) { const m = await O.api('GET', '/api/me?platform=' + O.platform()); O.me = m.user; O.ent = m.entitlements; changed(); }
  };
  O.login = async function (email, password) {
    const r = await O.api('POST', '/api/auth/login', { email, password, client: 'game' });
    if (r.mfa) return { mfa: r.challenge };
    O.setToken(r.token); await O.refresh(); return { ok: true };
  };
  O.signup = async function (email, password, name, birthYear, birthMonth) {
    let r;
    try { r = await O.api('POST', '/api/auth/signup', { email, password, name: name || undefined, client: 'game', birthYear, birthMonth }); }
    catch (e) { if (e.code === 'underage') E.LS.set(AGE_BLOCK, Date.now()); throw e; }
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
  // Promo codes: a month, a year or a lifetime of membership.
  O.redeemDialog = async function () {
    if (!O.signedIn() && !(await O.signInDialog())) return false;
    const code = await E.prompt('Redeem a code', '');
    if (!code) return false;
    try {
      const r = await O.api('POST', '/api/billing/redeem', { code });
      await O.refresh();
      E.modal('Welcome, member', r.lifetime ? 'Your code gives you membership for life. Online matches have no time limit.' : `Your code gives you membership until ${new Date(r.until).toLocaleDateString()}. Online matches have no time limit.`);
      return true;
    } catch (e) { E.toast(e.message, 4000); return false; }
  };
  O.accountUrl = (path) => O.base() + (path || '/account');
  O.subscribe = async function (plan) {
    if (!O.canPurchase()) throw new Error('Membership is not sold in this version of the game.');
    if (!O.signedIn()) throw new Error('Sign in first.');
    if (O.play()) {
      const acct = await O.api('GET', '/api/billing/play/account');
      const r = await O.play().purchase({ productId: acct.productId, plan: PLAY_PLAN[plan || 'month'], obfuscatedAccountId: acct.obfuscatedAccountId });
      if (r.cancelled) return;
      if (r.owned) { await O.restorePlay(); return; }
      if (r.pending) { E.toast('Google Play is waiting for your payment. Membership starts when it goes through.', 5000); return; }
      await O.api('POST', '/api/billing/play/verify', { purchaseToken: r.purchaseToken });
      await O.refresh();
      E.toast('Welcome, member. Thank you.', 4000);
      return;
    }
    const r = await O.api('POST', '/api/billing/checkout', { plan: plan || 'month' });
    O.openExternal(r.url);
  };

  // ── age ─────────────────────────────────────────────────────────
  // A neutral question (no default answer). Under 13: no account; this device
  // does not ask again for a day, so the answer is not simply changed.
  const AGE_BLOCK = 'efl.agegate';
  O.ageBlocked = () => { const t = E.LS.get(AGE_BLOCK, 0); return !!t && Date.now() - t < 864e5; };
  O.agePicker = function () {
    const h = E.h, y = new Date().getFullYear();
    const month = h('select', { 'aria-label': 'Birth month', required: true }, h('option', { value: '' }, 'Month'), ...Array.from({ length: 12 }, (_, i) => h('option', { value: i + 1 }, new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' }))));
    const year = h('select', { 'aria-label': 'Birth year', required: true }, h('option', { value: '' }, 'Year'), ...Array.from({ length: 100 }, (_, i) => h('option', { value: y - i }, String(y - i))));
    const el = h('fieldset', { class: 'age-pick' }, h('legend', null, 'When were you born?'), h('div', { class: 'row' }, month, year), h('small', { class: 'hint-s' }, 'We keep only an age range, never the date.'));
    return { el, value: () => month.value && year.value ? { birthMonth: +month.value, birthYear: +year.value } : null };
  };
  // For accounts made through Google, Apple or Steam: asked once before online play.
  O.ageDialog = async function () {
    if (O.ageBlocked()) { E.modal('Online play', 'Online play is for players 13 and older. You can still play offline and on your local network.'); return false; }
    const pick = O.agePicker();
    const ok = await E.modal('One question first', pick.el, [{ label: 'Not now', value: false }, { label: 'Continue', value: true, primary: true }]);
    if (!ok) return false;
    const v = pick.value(); if (!v) { E.toast('Choose a month and a year.'); return O.ageDialog(); }
    try { await O.api('POST', '/api/me/age', v); await O.refresh(); return true; }
    catch (e) {
      if (e.code === 'underage') { E.LS.set(AGE_BLOCK, Date.now()); O.setToken(null); O.me = null; O.ent = null; changed(); E.modal('Online play', e.message); return false; }
      E.toast(e.message); return false;
    }
  };

  // ── lobby connection (one per lobby, authenticated) ──────────────
  O.openRelay = async function () {
    if (!O.signedIn()) { const e = new Error('Sign in to play online.'); e.code = 'signin'; throw e; }
    const r = new E.Relay();
    await r.connect(O.wsUrl());
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('The server did not answer. Try again.')), 8000);
      r.on('hello', m => { clearTimeout(to); O.me = m.user; O.ent = m.ent; O.key = m.key; O.announcements = m.announcements || O.announcements; O.hello = m; changed(); res(r); });
      const fail = m => { clearTimeout(to); r.close(); const e = new Error(m.msg || 'Could not connect.'); e.code = m.code || m.op; if (m.code === 'unauthorized') { O.setToken(null); changed(); } rej(e); };
      r.on('error', fail); r.on('upgrade', fail); r.on('maintenance', fail); r.on('kicked', fail);
      r.raw({ op: 'auth', token: O.token(), version: E.VERSION, proto: E.PROTOCOL, platform: (E.Native && E.Native.is ? E.Native.platform : 'web') });
    });
  };
  // Reattach a host's existing relay (its peers stay connected) after its signaling
  // dropped mid-match: authenticate a new socket and resume the lobby.
  O.reattach = async function (r) {
    const keep = r.handlers; r.handlers = {};
    try {
      await r.connect(O.wsUrl());
      await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('The server did not answer.')), 8000);
        const fail = m => { clearTimeout(to); const e = new Error(m.msg || 'Could not resume.'); e.code = m.code || m.op; rej(e); };
        r.on('error', fail); r.on('upgrade', fail); r.on('maintenance', fail); r.on('kicked', fail);
        r.on('hello', m => { O.me = m.user; O.ent = m.ent; O.key = m.key; changed(); r.raw({ op: 'host', resume: r.room }); });
        r.on('hosted', () => { clearTimeout(to); res(); });
        r.raw({ op: 'auth', token: O.token(), version: E.VERSION, proto: E.PROTOCOL, platform: (E.Native && E.Native.is ? E.Native.platform : 'web') });
      });
    } catch (e) { if (r.ws) { const ws = r.ws; r.ws = null; ws.onclose = null; try { ws.close(); } catch (x) { /* */ } } throw e; }
    finally { r.handlers = keep; }
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
    // any key in the service's ring (tickets issued just before a rotation still verify)
    const ring = [].concat((O.hello && O.hello.keys) || [], O.key || [], (O.config && O.config.ticketKeys) || [], (O.config && O.config.ticketKey) || []);
    const key = ring.find(k => k && k.kid === kid);
    if (!key) return null;
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
        const age = O.agePicker();
        const go = h('button', { class: 'btn primary', type: 'submit' }, mode === 'in' ? 'Sign in' : 'Create account');
        const form = mode === 'up' && O.ageBlocked() ? h('p', { class: 'si-note' }, 'Online play is for players 13 and older. You can still play offline and on your local network.')
          : h('form', { class: 'si-form' }, email, pass, mode === 'up' ? name : null, mode === 'up' ? age.el : null, go);
        form.onsubmit = async e => {
          e.preventDefault(); go.disabled = true; say('');
          try {
            const a = age.value();
            if (mode === 'up' && !a) { say('Tell us the month and year you were born.'); go.disabled = false; return; }
            const r = mode === 'in' ? await O.login(email.value, pass.value) : await O.signup(email.value, pass.value, name.value, a.birthYear, a.birthMonth);
            if (r.mfa) return mfaStep(r.mfa);
            if (r.verifyEmail) E.toast('Check your email to confirm your address.', 4000);
            close(true);
          } catch (x) { say(x.message); go.disabled = false; }
        };
        const provs = ((O.config && O.config.providers) || []).filter(p => p !== 'dev' || /localhost/.test(O.base()));
        const names = { google: 'Google', apple: 'Apple', steam: 'Steam', dev: 'Dev' };
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
    if (O.play() && !O.playPlans) { try { O.playPlans = (await O.play().products({})).plans || []; } catch (e) { O.playPlans = []; } }
    if (O.play() && !O.price('month')) { await E.modal('Membership', 'Google Play is not answering right now. Try again in a moment.'); return; }
    if (!O.canPurchase()) { await E.modal('The match has ended', `${why ? why + ' ' : ''}Free online matches last ${mins} minutes.`); return; }
    const year = O.price('year');
    const v = await E.modal('Keep the bloom going', `${why ? why + ' ' : ''}Free online matches last ${mins} minutes. Membership removes the limit for ${O.price('month')} a month${year ? ` (or ${year} a year)` : ''} and pays for the servers that introduce players.`,
      [{ label: 'Not now', value: false }].concat(year ? [{ label: `${year} a year`, value: 'year' }] : [], [{ label: `${O.price('month')} a month`, value: 'month', primary: true }]));
    if (v) { try { await O.subscribe(v); } catch (e) { E.toast(e.message); } }
  };
})(window.E);
