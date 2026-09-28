// Account portal for play.ozymandosis.com. Plain script, no build step.
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const k in attrs || {}) { const v = attrs[k]; if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  };
  const q = new URLSearchParams(location.search);
  const handoff = q.get('handoff');
  let cfg = { providers: [], billing: false, freeMatchMinutes: 15 }, me = null;
  const PROVIDER = { google: 'Google', apple: 'Apple', steam: 'Steam', dev: 'Dev account' };

  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-ozy': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = {}; try { j = await r.json(); } catch (e) { /* empty */ }
    if (!r.ok) { const e = new Error(j.error || 'Something went wrong.'); e.code = j.code; e.status = r.status; throw e; }
    return j;
  }
  function flash(text, kind) { const f = $('#flash'); f.replaceChildren(text ? h('div', { class: 'msg ' + (kind || '') }, text) : ''); if (text) f.scrollIntoView({ block: 'nearest' }); }
  function show(...nodes) { $('#view').replaceChildren(...nodes); }
  const add = (el, ...kids) => { for (const k of kids.flat()) if (k != null && k !== false) el.append(k); return el; };
  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { flash(e.message, 'error'); } finally { btn.disabled = false; } };
  // Prices from Stripe (tax included), in the reader's number format.
  const price = plan => {
    const p = ((cfg && cfg.plans) || []).find(x => x.plan === plan);
    if (!p) return plan === 'month' ? '$1' : null;
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency.toUpperCase(), minimumFractionDigits: p.amount % 100 ? 2 : 0 }).format(p.amount / 100); } catch (e) { return '$' + p.amount / 100; }
  };
  // The age question: neutral (nothing preselected); only an age range is kept.
  const agePicker = () => {
    const y = new Date().getFullYear();
    const month = h('select', { 'aria-label': 'Birth month', required: true }, h('option', { value: '' }, 'Month'), ...Array.from({ length: 12 }, (_, i) => h('option', { value: i + 1 }, new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' }))));
    const year = h('select', { 'aria-label': 'Birth year', required: true }, h('option', { value: '' }, 'Year'), ...Array.from({ length: 100 }, (_, i) => h('option', { value: y - i }, String(y - i))));
    return { el: [h('label', null, 'When were you born?'), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, month, year), h('p', { class: 'muted', style: 'font-size:.85rem;margin:6px 0 0' }, 'We keep only an age range, never the date. You need to be 13 or older.')],
      value: () => month.value && year.value ? { birthMonth: +month.value, birthYear: +year.value } : null };
  };
  const field = (label, attrs) => { const id = 'f' + Math.random().toString(36).slice(2, 8); return [h('label', { for: id }, label), h('input', Object.assign({ id }, attrs))]; };

  async function boot() {
    try { cfg = await api('GET', '/api/config'); } catch (e) { /* offline config */ }
    const site = location.hostname.replace(/^play\./, '');
    $('#site-link').href = location.protocol + '//' + site; $('#site-link').textContent = site;
    $('#privacy-link').href = location.protocol + '//' + site + '/privacy'; $('#terms-link').href = location.protocol + '//' + site + '/terms';
    const err = q.get('error');
    if (err) flash(err === 'banned' ? 'This account has been banned.' : 'That sign-in did not complete. Please try again.', 'error');
    const path = location.pathname;
    if (path === '/verify') return verify();
    if (path === '/reset') return reset();
    try { me = await api('GET', '/api/me'); } catch (e) { me = null; }
    if (q.get('mfa')) return mfaStep(q.get('mfa'));
    if (q.get('done')) return handoffDone();
    if (me && me.user.needsAge) return askAge();
    if (me && handoff) return approve();
    if (me) return account();
    return signIn(q.get('signup') ? 'up' : 'in');
  }

  // ── sign in / sign up ─────────────────────────────────────────
  function signIn(mode) {
    $('#subtitle').textContent = handoff ? 'Sign in to play online' : 'Sign in to your account';
    const tabIn = h('button', { class: 'btn', role: 'tab', 'aria-selected': String(mode === 'in'), onclick: () => signIn('in') }, 'Sign in');
    const tabUp = h('button', { class: 'btn', role: 'tab', 'aria-selected': String(mode === 'up'), onclick: () => signIn('up') }, 'Create account');
    const [le, email] = field('Email', { type: 'email', autocomplete: 'email', required: true });
    const [lp, pass] = field('Password', { type: 'password', autocomplete: mode === 'in' ? 'current-password' : 'new-password', required: true, minlength: 10 });
    const [ln, name] = field('Display name (optional)', { type: 'text', maxlength: 18, autocomplete: 'nickname', placeholder: 'Choose later if you like' });
    const go = h('button', { class: 'btn primary block', type: 'submit' }, mode === 'in' ? 'Sign in' : 'Create account');
    const age = agePicker();
    const form = h('form', { class: 'stack' }, le, email, lp, pass, mode === 'up' ? [h('p', { class: 'muted', style: 'font-size:.85rem;margin:6px 0 0' }, 'At least 10 characters. We will email you a link to confirm your address.'), ln, name, age.el] : null, go);
    form.onsubmit = e => { e.preventDefault(); busy(go, async () => {
      const body = { email: email.value, password: pass.value, client: 'web', handoff: handoff || undefined };
      if (mode === 'up' && !age.value()) throw new Error('Tell us the month and year you were born.');
      const r = mode === 'in' ? await api('POST', '/api/auth/login', body) : await api('POST', '/api/auth/signup', Object.assign(body, { name: name.value || undefined }, age.value()));
      if (r.mfa) return mfaStep(r.challenge);
      after(mode === 'up' ? 'Welcome. Check your email to confirm your address.' : '');
    }); };
    const provs = cfg.providers.filter(p => PROVIDER[p]);
    show(h('div', { class: 'card' },
      h('div', { class: 'tabs', role: 'tablist' }, tabIn, tabUp),
      provs.length ? [h('div', { class: 'providers' }, provs.map(p => h('a', { class: 'btn', href: `/auth/${p}/start${handoff ? '?handoff=' + encodeURIComponent(handoff) : ''}` }, 'Continue with ' + PROVIDER[p]))), h('div', { class: 'or' }, 'or use email')] : null,
      form,
      mode === 'in' ? h('p', { style: 'margin:14px 0 0;text-align:center' }, h('a', { href: '#', onclick: e => { e.preventDefault(); forgot(); } }, 'Forgot your password?')) : null));
    email.focus();
  }
  async function after(note) {
    me = await api('GET', '/api/me');
    if (handoff) return handoffDone();
    history.replaceState(null, '', '/account'); account(); if (note) flash(note, 'ok');
  }
  function mfaStep(challenge) {
    $('#subtitle').textContent = 'Two-factor sign-in';
    const [lc, code] = field('6-digit code from your authenticator app', { inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9 ]*', maxlength: 7, required: true });
    const go = h('button', { class: 'btn primary block', type: 'submit' }, 'Continue');
    let recovery = false;
    const toggle = h('a', { href: '#' }, 'Use a recovery code instead');
    toggle.onclick = e => { e.preventDefault(); recovery = !recovery; lc.textContent = recovery ? 'Recovery code' : '6-digit code from your authenticator app'; code.removeAttribute('pattern'); code.setAttribute('maxlength', 12); code.setAttribute('inputmode', 'text'); toggle.textContent = recovery ? 'Use my authenticator app' : 'Use a recovery code instead'; code.value = ''; code.focus(); };
    const form = h('form', { class: 'stack' }, lc, code, go, h('p', { style: 'text-align:center;margin:10px 0 0' }, toggle));
    form.onsubmit = e => { e.preventDefault(); busy(go, async () => {
      await api('POST', '/api/auth/mfa', { challenge, handoff: handoff || undefined, [recovery ? 'recovery' : 'code']: code.value });
      history.replaceState(null, '', location.pathname + (handoff ? '?handoff=' + encodeURIComponent(handoff) : '')); after('');
    }); };
    show(h('div', { class: 'card' }, form)); code.focus();
  }
  function forgot() {
    const [le, email] = field('Email', { type: 'email', required: true, autocomplete: 'email' });
    const go = h('button', { class: 'btn primary block', type: 'submit' }, 'Send reset link');
    const form = h('form', { class: 'stack' }, h('p', { class: 'soft', style: 'margin:0' }, 'We will email you a link to choose a new password.'), le, email, go, h('button', { class: 'btn block', type: 'button', onclick: () => signIn('in') }, 'Back to sign in'));
    form.onsubmit = e => { e.preventDefault(); busy(go, async () => { await api('POST', '/api/auth/forgot', { email: email.value }); flash('If that address has an account, a reset link is on its way.', 'ok'); }); };
    show(h('div', { class: 'card' }, h('h2', null, 'Reset your password'), form)); email.focus();
  }
  async function verify() {
    $('#subtitle').textContent = 'Confirm your email';
    try { await api('POST', '/api/auth/verify', { token: q.get('token') || '' }); show(h('div', { class: 'card' }, h('h2', null, 'Email confirmed'), h('p', null, 'You can play online now. Return to the game, or open your account.'), h('a', { class: 'btn primary', href: '/account' }, 'Open my account'))); }
    catch (e) { show(h('div', { class: 'card' }, h('h2', null, 'That link did not work'), h('p', { class: 'soft' }, e.message), h('a', { class: 'btn', href: '/account' }, 'Open my account'))); }
  }
  function reset() {
    $('#subtitle').textContent = 'Choose a new password';
    const [lp, pass] = field('New password (at least 10 characters)', { type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
    const go = h('button', { class: 'btn primary block', type: 'submit' }, 'Save password');
    const form = h('form', { class: 'stack' }, lp, pass, go);
    form.onsubmit = e => { e.preventDefault(); busy(go, async () => { await api('POST', '/api/auth/reset', { token: q.get('token') || '', password: pass.value }); show(h('div', { class: 'card' }, h('h2', null, 'Password saved'), h('p', null, 'You were signed out everywhere. Sign in with your new password.'), h('a', { class: 'btn primary', href: '/login' }, 'Sign in'))); }); };
    show(h('div', { class: 'card' }, form)); pass.focus();
  }
  async function approve() {
    try { await api('POST', '/api/auth/handoff/approve', { handoff }); handoffDone(); }
    catch (e) { flash(e.message, 'error'); account(); }
  }
  function handoffDone() {
    $('#subtitle').textContent = 'Signed in';
    show(h('div', { class: 'card', style: 'text-align:center' }, h('h2', null, 'You are signed in'), h('p', null, 'Return to Ozymandosis. The game will finish signing in by itself in a moment.'), h('p', { class: 'muted' }, 'You can close this tab.'), h('a', { class: 'btn', href: '/account' }, 'Open my account')));
  }

  // ── account ───────────────────────────────────────────────────
  // Accounts made through Google, Apple or Steam answer the age question once.
  function askAge() {
    $('#subtitle').textContent = 'One question first';
    const age = agePicker(), go = h('button', { class: 'btn primary block', type: 'submit' }, 'Continue');
    const form = h('form', { class: 'stack' }, age.el, go);
    form.onsubmit = e => { e.preventDefault(); busy(go, async () => {
      if (!age.value()) throw new Error('Choose a month and a year.');
      try { await api('POST', '/api/me/age', age.value()); }
      catch (x) { if (x.status === 403) { me = null; show(h('div', { class: 'card' }, h('h2', null, 'Sorry'), h('p', null, x.message))); return; } throw x; }
      me = await api('GET', '/api/me'); handoff ? approve() : account();
    }); };
    show(h('div', { class: 'card' }, h('h2', null, 'Before you play online'), form));
  }
  function account() {
    const u = me.user, ent = me.entitlements;
    if (u.needsAge) return askAge();
    $('#subtitle').textContent = 'Your account';
    if (q.get('billing') === 'success') flash('Thank you. Your membership is active; online matches have no time limit now.', 'ok');
    if (q.get('billing') === 'cancelled') flash('Checkout was cancelled. Nothing was charged.');
    const cards = [];
    if (me.notice) cards.push(h('div', { class: 'msg ' + (me.notice.kind === 'warn' ? '' : 'error') }, me.notice.kind === 'warn' ? 'A moderator sent you a warning: ' : me.notice.kind === 'mute' ? 'Your chat is muted' + (u.mutedUntil ? ' until ' + new Date(u.mutedUntil).toLocaleString() : '') + ': ' : 'Your account is suspended: ', me.notice.reason || 'See our community rules.'));
    if (u.email && !u.emailVerified) cards.push(h('div', { class: 'msg' }, 'Confirm your email to play online. ', h('a', { href: '#', onclick: e => { e.preventDefault(); api('POST', '/api/auth/resend-verify').then(() => flash('A new link is on its way.', 'ok'), x => flash(x.message, 'error')); } }, 'Send the link again')));
    // profile
    const name = h('input', { value: u.name, maxlength: 18, 'aria-label': 'Display name' });
    const save = h('button', { class: 'btn small' }, 'Save');
    save.onclick = () => busy(save, async () => { await api('PATCH', '/api/me', { name: name.value }); flash('Name saved.', 'ok'); });
    cards.push(h('div', { class: 'card' }, h('h2', null, 'Profile'),
      h('label', null, 'Display name'), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, name, save),
      h('dl', { class: 'kv', style: 'margin-top:16px' }, h('dt', null, 'Rating'), h('dd', null, u.rating), h('dt', null, 'Matches'), h('dd', null, `${u.matches} played, ${u.wins} won`), h('dt', null, 'Email'), h('dd', null, u.email || 'none'), h('dt', null, 'Sign-ins'), h('dd', null, [u.hasPassword ? 'Email' : null, ...me.identities.map(p => PROVIDER[p] || p)].filter(Boolean).join(', ') || 'none'))));
    // membership
    const mem = h('div', { class: 'card' }, h('h2', null, 'Membership'));
    if (ent.subscriber) {
      const until = ent.lifetime ? 'Lifetime membership' : !ent.until ? null : ent.source === 'stripe' ? (ent.cancelAtPeriodEnd ? 'Ends ' : 'Renews ') + new Date(ent.until).toLocaleDateString() : 'Free membership until ' + new Date(ent.until).toLocaleDateString();
      add(mem, h('p', null, h('span', { class: 'pill good' }, ent.lifetime ? 'Lifetime member' : 'Member'), ' Online matches have no time limit.'), until ? h('p', { class: 'soft' }, until) : null);
      if (cfg.billing && ent.billing) { const b = h('button', { class: 'btn' }, 'Manage billing'); b.onclick = () => busy(b, async () => { location.href = (await api('POST', '/api/billing/portal')).url; }); mem.append(b); }
    } else {
      const year = price('year');
      mem.append(h('p', null, `Free players can play online matches of up to ${ent.freeMatchMinutes} minutes. Membership removes the limit for ${price('month')} a month${year ? ` or ${year} a year` : ''} and keeps the servers running. Prices include any tax.`));
      if (cfg.billing) {
        const buy = (plan, label, primary) => { const b = h('button', { class: 'btn' + (primary ? ' primary' : '') }, label); b.onclick = () => busy(b, async () => { location.href = (await api('POST', '/api/billing/checkout', { plan })).url; }); return b; };
        mem.append(h('div', { class: 'row' }, buy('month', `Become a member · ${price('month')}/month`, true), year ? buy('year', `${year}/year`) : null));
      }
      else mem.append(h('p', { class: 'muted' }, 'Membership is not available on this server.'));
    }
    // promo codes: a month, a year or life
    const code = h('input', { placeholder: 'OZY-XXXX-XXXX-XXXX', maxlength: 40, autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Promo code', style: 'text-transform:uppercase;letter-spacing:.08em' });
    const use = h('button', { class: 'btn small' }, 'Redeem');
    use.onclick = () => busy(use, async () => {
      const r = await api('POST', '/api/billing/redeem', { code: code.value });
      me = await api('GET', '/api/me'); account();
      flash(r.lifetime ? 'Code accepted: you are a member for life.' : `Code accepted: membership until ${new Date(r.until).toLocaleDateString()}.` + (r.stripeActive ? ' Your paid subscription is still active; cancel it under Manage billing if you like.' : ''), 'ok');
    });
    add(mem, h('details', { style: 'margin-top:14px' }, h('summary', null, 'Have a code?'), h('div', { class: 'row', style: 'flex-wrap:nowrap;margin-top:10px' }, code, use)));
    cards.push(mem);
    // security
    const sec = h('div', { class: 'card' }, h('h2', null, 'Security'));
    if (u.email) {
      if (u.mfa) {
        sec.append(h('p', null, h('span', { class: 'pill good' }, 'Two-factor on'), ' Your authenticator app is required to sign in.'));
        const [lc, c] = field('Current code', { inputmode: 'numeric', maxlength: 6 });
        const off = h('button', { class: 'btn danger small' }, 'Turn off'), regen = h('button', { class: 'btn small' }, 'New recovery codes');
        off.onclick = () => busy(off, async () => { await api('POST', '/api/me/mfa/disable', { code: c.value }); me = await api('GET', '/api/me'); account(); flash('Two-factor sign-in is off.', 'ok'); });
        regen.onclick = () => busy(regen, async () => { const r = await api('POST', '/api/me/mfa/recovery', { code: c.value }); showCodes(r.recoveryCodes); });
        sec.append(lc, c, h('div', { class: 'row', style: 'margin-top:10px' }, regen, off));
      } else {
        const b = h('button', { class: 'btn primary' }, 'Turn on two-factor sign-in');
        b.onclick = () => busy(b, setupMfa);
        sec.append(h('p', { class: 'soft' }, 'Add a code from an authenticator app (1Password, Authy, Google Authenticator, Aegis...) to every sign-in.'), b);
      }
    }
    if (u.hasPassword) {
      const [l1, cur] = field('Current password', { type: 'password', autocomplete: 'current-password' });
      const [l2, next] = field('New password', { type: 'password', autocomplete: 'new-password', minlength: 10 });
      const [l3, code] = field('Authenticator code', { inputmode: 'numeric', maxlength: 6 });
      const b = h('button', { class: 'btn small' }, 'Change password');
      b.onclick = () => busy(b, async () => { await api('POST', '/api/me/password', { current: cur.value, next: next.value, code: code.value || undefined }); cur.value = next.value = code.value = ''; flash('Password changed. Other devices were signed out.', 'ok'); });
      add(sec, h('details', { style: 'margin-top:16px' }, h('summary', null, 'Change password'), l1, cur, l2, next, u.mfa ? [l3, code] : null, h('div', { style: 'margin-top:10px' }, b)));
    }
    const linkable = cfg.providers.filter(p => PROVIDER[p] && !me.identities.includes(p) && p !== 'dev');
    if (linkable.length) sec.append(h('details', { style: 'margin-top:12px' }, h('summary', null, 'Link another sign-in'), h('div', { class: 'providers', style: 'margin-top:10px' }, linkable.map(p => h('a', { class: 'btn small', href: `/auth/${p}/start?link=1&return=/account` }, PROVIDER[p])))));
    const sess = h('div', { class: 'list', style: 'margin-top:10px' });
    sec.append(h('details', { style: 'margin-top:12px', ontoggle: e => { if (e.target.open) loadSessions(sess); } }, h('summary', null, 'Devices signed in'), sess));
    cards.push(sec);
    // privacy
    const crash = h('input', { type: 'checkbox', id: 'crash', style: 'width:auto;min-height:0' }); crash.checked = u.crashReports;
    crash.onchange = () => api('PATCH', '/api/me', { crashReports: crash.checked }).then(() => flash('Saved.', 'ok'), e => flash(e.message, 'error'));
    // chat: everyone / quick chat (preset phrases) / off; free chat opens at 16
    const chat = h('select', { 'aria-label': 'Online chat' }, [['all', 'Everyone (filtered)'], ['quick', 'Quick chat only (preset phrases)'], ['off', 'Off']].map(([v, l]) => h('option', { value: v, disabled: v === 'all' && !u.freeChat ? true : null }, l)));
    chat.value = u.chat || 'all';
    chat.onchange = () => api('PATCH', '/api/me', { chat: chat.value }).then(() => flash('Saved.', 'ok'), e => { flash(e.message, 'error'); chat.value = u.chat; });
    const del = h('button', { class: 'btn danger small' }, 'Delete my account');
    del.onclick = () => deleteAccount();
    cards.push(h('div', { class: 'card' }, h('h2', null, 'Privacy'),
      h('label', { style: 'display:flex;gap:10px;align-items:center;color:var(--ink)' }, crash, 'Send automatic crash reports (no personal data)'),
      h('label', null, 'Online chat'), chat,
      u.freeChat ? null : h('p', { class: 'muted', style: 'font-size:.85rem;margin:6px 0 0' }, 'Players under 16 use quick chat.'),
      h('p', { class: 'muted', style: 'font-size:.88rem' }, 'We keep your email for sign-in and recovery, your display name, match results, membership status, and the lineage, designs and saves the game backs up to your account. Logs never contain your email or IP address.'),
      h('div', { class: 'row' }, h('a', { class: 'btn small', href: '/api/me/export', download: 'ozymandosis-account.json' }, 'Download my data'), del)));
    const out = h('button', { class: 'btn' }, 'Sign out');
    out.onclick = () => busy(out, async () => { await api('POST', '/api/auth/logout'); me = null; history.replaceState(null, '', '/login'); signIn('in'); });
    cards.push(h('div', { class: 'row', style: 'justify-content:center' }, out, ['support', 'moderator', 'admin', 'owner'].includes(u.role) ? h('a', { class: 'btn', href: '/admin' }, 'Admin console') : null));
    show(...cards);
  }
  async function setupMfa() {
    const s = await api('POST', '/api/me/mfa/setup');
    const [lc, code] = field('Enter the 6-digit code it shows', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6 });
    const go = h('button', { class: 'btn primary block', type: 'submit' }, 'Turn on');
    const qr = h('div', { class: 'qr' }); qr.innerHTML = s.qr; // server-generated SVG
    const form = h('form', { class: 'stack' }, h('h2', null, 'Two-factor sign-in'), h('p', null, '1. Scan this with your authenticator app.'), qr,
      h('p', { class: 'soft', style: 'font-size:.9rem' }, 'Cannot scan? Enter this key: ', h('span', { class: 'mono' }, s.secret.replace(/(.{4})/g, '$1 ').trim())), h('p', null, '2. Then:'), lc, code, go,
      h('button', { class: 'btn block', type: 'button', onclick: () => account() }, 'Cancel'));
    form.onsubmit = e => { e.preventDefault(); busy(go, async () => { const r = await api('POST', '/api/me/mfa/enable', { code: code.value }); me = await api('GET', '/api/me'); showCodes(r.recoveryCodes); }); };
    show(h('div', { class: 'card' }, form)); code.focus();
  }
  function showCodes(codes) {
    const copy = h('button', { class: 'btn small' }, 'Copy');
    copy.onclick = () => navigator.clipboard.writeText(codes.join('\n')).then(() => { copy.textContent = 'Copied'; });
    show(h('div', { class: 'card' }, h('h2', null, 'Save your recovery codes'), h('p', null, 'Each code works once if you lose your phone. Store them somewhere safe; they will not be shown again.'),
      h('div', { class: 'codes' }, codes.map(c => h('div', null, c))), h('div', { class: 'row', style: 'margin-top:14px' }, copy, h('button', { class: 'btn primary', onclick: () => account() }, 'I saved them'))));
  }
  async function loadSessions(box) {
    const r = await api('GET', '/api/me/sessions');
    box.replaceChildren(...r.sessions.map(s => h('div', { class: 'item' }, h('div', null, h('div', null, s.client || 'Unknown device', s.current ? h('span', { class: 'pill good', style: 'margin-left:8px' }, 'this one') : null), h('div', { class: 'muted', style: 'font-size:.85rem' }, (s.kind === 'game' ? 'Game' : 'Browser') + ' · last used ' + new Date(s.lastUsedAt).toLocaleString())),
      s.current ? null : h('button', { class: 'btn small', onclick: async () => { await api('DELETE', '/api/me/sessions/' + s.id); loadSessions(box); } }, 'Sign out'))));
  }
  function deleteAccount() {
    const u = me.user;
    const [lp, pass] = field(u.mfa ? 'Authenticator code' : 'Password', { type: u.mfa ? 'text' : 'password', inputmode: u.mfa ? 'numeric' : undefined });
    const [lt, typed] = field('Type DELETE to confirm', {});
    const go = h('button', { class: 'btn danger block', type: 'submit' }, 'Delete my account forever');
    const form = h('form', { class: 'stack' }, h('h2', null, 'Delete your account'), h('p', null, 'This erases your email, sign-ins and name, cancels your membership, and cannot be undone. Match records stay, anonymised.'), u.hasPassword || u.mfa ? [lp, pass] : null, lt, typed, go, h('button', { class: 'btn block', type: 'button', onclick: () => account() }, 'Keep my account'));
    form.onsubmit = e => { e.preventDefault(); busy(go, async () => { await api('DELETE', '/api/me', { confirm: typed.value, [u.mfa ? 'code' : 'password']: pass.value || undefined }); show(h('div', { class: 'card' }, h('h2', null, 'Account deleted'), h('p', null, 'Thank you for playing.'))); }); };
    show(h('div', { class: 'card' }, form));
  }
  boot();
})();
