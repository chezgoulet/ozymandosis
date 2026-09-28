// Admin console for play.ozymandosis.com. Plain script, same-origin session.
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const k in attrs || {}) { const v = attrs[k]; if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  };
  const RANK = { player: 0, support: 1, moderator: 2, admin: 3, owner: 4 };
  let me = null;
  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-ozy': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = {}; try { j = await r.json(); } catch (e) { /* */ }
    if (!r.ok) { const e = new Error(j.error || r.statusText); e.status = r.status; throw e; }
    return j;
  }
  function toast(text, kind) { const t = $('#toast'); t.replaceChildren(h('div', { class: 'msg ' + (kind || 'ok') }, text)); clearTimeout(toast.t); toast.t = setTimeout(() => t.replaceChildren(), 3500); }
  const act = async (btn, fn, ok) => { if (btn) btn.disabled = true; try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message, 'error'); } finally { if (btn) btn.disabled = false; } };
  const when = d => d ? new Date(d).toLocaleString() : '—';
  const ago = d => { if (!d) return '—'; const s = (Date.now() - new Date(d).getTime()) / 1000; return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
  const fmt = n => Number(n || 0).toLocaleString();
  const main = (...n) => $('#main').replaceChildren(...n);
  const can = role => RANK[me.user.role] >= RANK[role];

  const SECTIONS = [
    ['dashboard', 'Dashboard', 'support', dashboard], ['issues', 'Crashes & bugs', 'support', issues], ['reports', 'Player reports', 'moderator', reports],
    ['players', 'Players', 'support', players], ['announce', 'Announcements', 'moderator', announcements], ['matches', 'Matches', 'support', matches], ['balance', 'Balance', 'support', balance], ['perf', 'Performance', 'support', perf],
    ['promos', 'Promo codes', 'admin', promos], ['config', 'Live config', 'admin', config], ['ops', 'Operations', 'admin', ops], ['audit', 'Audit log', 'admin', audit],
  ];
  function nav(counts) {
    $('#nav').replaceChildren(...SECTIONS.filter(s => can(s[2])).map(([id, label]) => h('button', { 'aria-current': location.hash.slice(1).split('/')[0] === id || (!location.hash && id === 'dashboard') ? 'page' : null, onclick: () => { location.hash = id; } }, label, counts && counts[id] ? h('span', { class: 'count' }, counts[id]) : null)));
  }
  async function route() {
    const [id, arg] = location.hash.slice(1).split('/');
    const s = SECTIONS.find(x => x[0] === (id || 'dashboard')) || SECTIONS[0];
    nav(route.counts);
    if (!can(s[2])) return main(h('p', null, 'You do not have access to this section.'));
    try { await s[3](arg ? decodeURIComponent(arg) : null); } catch (e) { main(h('div', { class: 'msg error' }, e.message)); }
  }

  // ── dashboard ──────────────────────────────────────────────────
  // Single-series line: one accent hue, recessive grid, crosshair + readout on hover.
  function lineChart(title, points, unit) {
    const W = 320, H = 110, P = { l: 30, r: 6, t: 8, b: 18 };
    const max = Math.max(1, ...points.map(p => p.v)), n = Math.max(1, points.length - 1);
    const x = i => P.l + (W - P.l - P.r) * i / n, y = v => H - P.b - (H - P.t - P.b) * v / max;
    const ns = 'http://www.w3.org/2000/svg', S = (t, a) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${title}, last 30 days` });
    for (const f of max >= 4 ? [0, 0.5, 1] : [0, 1]) { svg.append(S('line', { class: 'grid', x1: P.l, x2: W - P.r, y1: y(max * f), y2: y(max * f) })); const tx = S('text', { class: 'axis', x: P.l - 6, y: y(max * f) + 4, 'text-anchor': 'end' }); tx.textContent = fmt(Math.round(max * f * 10) / 10); svg.append(tx); }
    if (points.length) {
      const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
      svg.append(S('path', { class: 'area', d: `${d}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z` }), S('path', { class: 'line', d }));
      for (const [i, anchor] of [[0, 'start'], [points.length - 1, 'end']]) { const tx = S('text', { class: 'axis', x: x(i), y: H - 3, 'text-anchor': anchor }); tx.textContent = points[i].label; svg.append(tx); }
    }
    const cross = S('line', { class: 'cross', y1: P.t, y2: H - P.b, visibility: 'hidden' }), dot = S('circle', { class: 'dot', r: 4, visibility: 'hidden' });
    svg.append(cross, dot);
    const last = points[points.length - 1];
    const now = h('div', { class: 'now' }, last ? `${fmt(last.v)} ${unit} on ${last.label}` : 'No data yet');
    svg.addEventListener('pointermove', e => {
      if (!points.length) return;
      const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W, i = Math.max(0, Math.min(points.length - 1, Math.round((px - P.l) / (W - P.l - P.r) * n)));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(points[i].v)); dot.setAttribute('visibility', 'visible');
      now.textContent = `${fmt(points[i].v)} ${unit} on ${points[i].label}`;
    });
    svg.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); now.textContent = last ? `${fmt(last.v)} ${unit} on ${last.label}` : 'No data yet'; });
    return h('div', { class: 'chart' }, h('h3', null, title), now, svg);
  }
  async function dashboard() {
    const d = await api('GET', '/api/admin/dashboard');
    route.counts = { issues: d.openIssues, reports: d.openReports, matches: d.disputed }; nav(route.counts);
    const tile = (k, v, sub) => h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, sub ? h('small', null, ' ' + sub) : null));
    const series = key => d.series.filter(s => s.key === key).map(s => ({ label: new Date(s.day + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }), v: Number(s.value) }));
    main(
      h('div', { class: 'tiles' }, tile('Online now', fmt(d.live.online), `${d.live.queued} queued`), tile('Live lobbies', fmt(d.live.lobbies), `${d.live.matches} in match`),
        tile('Daily active', fmt(d.dau), `${fmt(d.wau)} weekly`), tile('Monthly active', fmt(d.mau)), tile('Members', fmt(d.subscribers), `$${fmt(d.mrrUsd)}/mo`),
        tile('Players', fmt(d.users)), tile('Matches, 24 h', fmt(d.matches24), d.disputed ? `${d.disputed} disputed (30 d)` : ''), tile('Open crashes', fmt(d.openIssues), d.regressed ? `${d.regressed} regressed` : ''), tile('Open reports', fmt(d.openReports))),
      h('div', { class: 'charts' }, lineChart('New players', series('signups'), 'sign-ups'), lineChart('Matches started', series('matches_started'), 'matches'),
        lineChart('Crashes', series('crashes'), 'crashes'), lineChart('Memberships started', series('subscriptions_started'), 'new members')),
      h('div', { class: 'card' }, h('h2', null, 'Recent crashes'), issueTable(d.topIssues)));
  }

  // ── issues ─────────────────────────────────────────────────────
  function issueTable(list) {
    if (!list.length) return h('p', { class: 'muted' }, 'Nothing here. Quiet seas.');
    return h('div', { class: 'scroll' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Issue'), h('th', null, 'Status'), h('th', { class: 'num' }, 'Events'), h('th', null, 'Last version'), h('th', null, 'Last seen'))),
      h('tbody', null, list.map(i => h('tr', { class: 'click', onclick: () => { location.hash = 'issues/' + i.id; } }, h('td', null, h('span', { class: 'pill' + (i.kind === 'bug' ? '' : ' bad') }, i.kind || 'crash'), ' ', i.title), h('td', null, statusPill(i.status)), h('td', { class: 'num' }, fmt(i.count)), h('td', { class: 'mono' }, i.last_version || '—'), h('td', null, ago(i.last_seen)))))));
  }
  const statusPill = s => h('span', { class: 'pill ' + ({ open: 'warn', regressed: 'bad', resolved: 'good' }[s] || '') }, s);
  // frame-rate runs from devices (the game's frame-rate instrument)
  async function perf() {
    const r = await api('GET', '/api/admin/perf?days=30');
    const n = v => v == null ? '—' : Math.round(v * 10) / 10;
    const table = (head, rows) => h('div', { style: 'overflow-x:auto' }, h('table', null, h('thead', null, h('tr', null, head.map(x => h('th', null, x)))), h('tbody', null, rows)));
    main(h('div', { class: 'card' }, h('h2', null, 'Performance (last 30 days)'),
      h('p', { class: 'muted' }, 'Medians per device class. Frame times in ms: p50 is typical, p99 is the worst 1%. Below 30 = share of frames slower than 33 ms.'),
      table(['Device', 'Renderer', 'Platform', 'Runs', 'fps', 'p50', 'p95', 'p99', 'Below 30 %', 'Tier changes'], r.summary.map(s => h('tr', null, [s.device_class, s.renderer, s.platform, s.runs, n(s.fps), n(s.p50), n(s.p95), n(s.p99), n(s.below30), n(s.tier_changes)].map(v => h('td', null, String(v))))))),
      h('div', { class: 'card' }, h('h2', null, 'Recent runs'),
        table(['When', 'Version', 'Device', 'Renderer', 'Mode', 'Minutes', 'fps', 'p50', 'p95', 'p99', 'Tiers'], r.runs.map(x => h('tr', null, [when(x.created_at), x.version, x.device_class, x.renderer, x.mode, n(x.seconds / 60), n(x.fps), n(x.p50), n(x.p95), n(x.p99), `${x.tier_changes} (${x.tier_start || '?'}→${x.tier_end || '?'})`].map(v => h('td', null, String(v))))))));
  }
  async function issues(id) {
    if (id) return issueDetail(id);
    const st = h('select', null, ['open', 'resolved', 'ignored', 'all'].map(s => h('option', { value: s }, s)));
    const kind = h('select', null, [['all', 'Crashes and bugs'], ['crash', 'Crashes'], ['bug', 'Bug reports']].map(([v, l]) => h('option', { value: v }, l)));
    const ver = h('input', { placeholder: 'Version, e.g. 0.5.0' });
    const box = h('div');
    const load = async () => { const r = await api('GET', `/api/admin/issues?status=${st.value}&kind=${kind.value}${ver.value ? '&version=' + encodeURIComponent(ver.value) : ''}`); box.replaceChildren(issueTable(r.issues)); };
    st.onchange = kind.onchange = load; ver.onchange = load;
    main(h('div', { class: 'card' }, h('h2', null, 'Crashes & bug reports'), h('div', { class: 'filters' }, st, kind, ver), box));
    await load();
  }
  async function issueDetail(id) {
    const { issue, reports } = await api('GET', '/api/admin/issues/' + id);
    const status = h('select', null, ['open', 'resolved', 'ignored'].map(s => h('option', { value: s, selected: s === issue.status || (issue.status === 'regressed' && s === 'open') }, s)));
    const fixed = h('input', { placeholder: 'Fixed in version', value: issue.resolved_in || '' });
    const notes = h('textarea', { rows: 4 }, issue.notes || '');
    const save = h('button', { class: 'btn small primary' }, 'Save');
    save.onclick = () => act(save, () => api('PATCH', '/api/admin/issues/' + id, { status: status.value, resolvedIn: fixed.value || undefined, notes: notes.value }), 'Saved');
    const dist = obj => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} (${v})`).join(', ') || '—';
    main(h('p', null, h('a', { href: '#issues' }, '← All issues')),
      h('div', { class: 'two' },
        h('div', { class: 'card' }, h('h2', null, issue.title), h('dl', { class: 'kv' }, h('dt', null, 'Status'), h('dd', null, statusPill(issue.status)), h('dt', null, 'Events'), h('dd', null, fmt(issue.count)), h('dt', null, 'First seen'), h('dd', null, when(issue.first_seen)), h('dt', null, 'Last seen'), h('dd', null, when(issue.last_seen)), h('dt', null, 'Versions'), h('dd', null, dist(issue.versions)), h('dt', null, 'Platforms'), h('dd', null, dist(issue.platforms))),
          reports[0] && reports[0].stack ? [h('h3', { style: 'margin-top:16px' }, 'Latest stack'), h('pre', { class: 'stack' }, reports[0].message + '\n' + reports[0].stack)] : null),
        h('div', { class: 'card stack' }, h('h2', null, 'Triage'), h('label', null, 'Status'), status, h('label', null, 'Fixed in'), fixed, h('label', null, 'Notes'), notes, save)),
      h('div', { class: 'card' }, h('h2', null, `Sample reports (${reports.length})`), h('div', { class: 'list' }, reports.map(r => h('details', { class: 'item', style: 'display:block' },
        h('summary', null, `${when(r.created_at)} · ${r.version} · ${r.platform} · ${r.renderer}${r.player ? ' · ' + r.player : ''}`),
        r.description ? h('p', null, r.description) : null, r.stack ? h('pre', { class: 'stack' }, r.message + '\n' + r.stack) : null,
        h('pre', { class: 'stack' }, JSON.stringify(r.context, null, 2)),
        r.has_screenshot ? h('img', { class: 'shot', loading: 'lazy', alt: 'Screenshot attached to the report', src: '/api/admin/reports/' + r.id + '/screenshot' }) : null)))));
  }

  // ── player reports ─────────────────────────────────────────────
  async function reports() {
    const st = h('select', null, ['open', 'actioned', 'dismissed'].map(s => h('option', { value: s }, s)));
    const box = h('div', { class: 'list' });
    const load = async () => {
      const r = await api('GET', '/api/admin/player-reports?status=' + st.value);
      if (!r.reports.length) return box.replaceChildren(h('p', { class: 'muted' }, 'No reports.'));
      box.replaceChildren(...r.reports.map(rep => {
        const res = h('input', { placeholder: 'Resolution note (sent to the log)' });
        const hours = h('select', null, [['', 'Length'], ['1', '1 hour'], ['24', '1 day'], ['72', '3 days'], ['168', '1 week'], ['720', '30 days']].map(([v, l]) => h('option', { value: v }, l)));
        const actions = st.value !== 'open' ? null : h('div', { class: 'row', style: 'margin-top:10px' }, res, hours,
          ...[['warn', 'Warn'], ['mute', 'Mute'], ['suspend', 'Suspend'], ['rename', 'Force rename'], ...(can('admin') ? [['ban', 'Ban']] : [])].map(([k, l]) => {
            const b = h('button', { class: 'btn small' + (k === 'ban' || k === 'suspend' ? ' danger' : '') }, l);
            b.onclick = () => { if ((k === 'suspend') && !hours.value) return toast('Choose a length first.', 'error'); act(b, async () => { await api('POST', `/api/admin/player-reports/${rep.id}/resolve`, { status: 'actioned', action: k, hours: hours.value ? +hours.value : undefined, resolution: res.value }); await load(); }, 'Done'); };
            return b;
          }),
          (() => { const b = h('button', { class: 'btn small' }, 'Dismiss'); b.onclick = () => act(b, async () => { await api('POST', `/api/admin/player-reports/${rep.id}/resolve`, { status: 'dismissed', resolution: res.value }); await load(); }, 'Dismissed'); return b; })());
        return h('div', { class: 'card', style: 'margin:0' },
          h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', null, h('b', null, h('a', { href: '#players/' + rep.target_id }, rep.target_name)), ' ', h('span', { class: 'pill warn' }, rep.reason), ' ', rep.target_status !== 'active' ? h('span', { class: 'pill bad' }, rep.target_status) : null), h('span', { class: 'muted' }, ago(rep.created_at))),
          h('p', { class: 'soft', style: 'margin:6px 0' }, `Reported by ${rep.reporter_name || 'a deleted account'} · ${rep.target_reports} reports and ${rep.target_sanctions} sanctions on record`),
          rep.details ? h('p', null, rep.details) : null,
          rep.chat && rep.chat.length ? h('div', { class: 'chatlog' }, rep.chat.map(c => h('div', null, h('b', null, c.from + ': '), c.text))) : null,
          rep.resolution ? h('p', { class: 'muted' }, 'Resolution: ' + rep.resolution) : null, actions);
      }));
    };
    st.onchange = load;
    main(h('div', { class: 'card' }, h('h2', null, 'Player reports'), h('p', { class: 'muted' }, 'Chat excerpts are supplied by the reporter from their own client; weigh them with the player\'s history.'), h('div', { class: 'filters' }, st)), box);
    await load();
  }

  // ── players ────────────────────────────────────────────────────
  async function players(id) {
    if (id) return player(id);
    const qin = h('input', { placeholder: can('admin') ? 'Name, id or email' : 'Name or id', type: 'search' });
    const st = h('select', null, [['', 'Any status'], ['active', 'Active'], ['suspended', 'Suspended'], ['banned', 'Banned']].map(([v, l]) => h('option', { value: v }, l)));
    const box = h('div');
    const load = async () => {
      const r = await api('GET', `/api/admin/users?q=${encodeURIComponent(qin.value)}${st.value ? '&status=' + st.value : ''}`);
      box.replaceChildren(h('div', { class: 'scroll' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Role'), h('th', null, 'Status'), h('th', { class: 'num' }, 'Rating'), h('th', { class: 'num' }, 'Open reports'), h('th', null, 'Last seen'))),
        h('tbody', null, r.users.map(u => h('tr', { class: 'click', onclick: () => { location.hash = 'players/' + u.id; } }, h('td', null, u.display_name, u.email ? h('div', { class: 'muted', style: 'font-size:.8rem' }, u.email) : null), h('td', null, u.role), h('td', null, statusPill(u.status === 'active' ? 'resolved' : 'regressed'), ' ', u.status), h('td', { class: 'num' }, u.rating), h('td', { class: 'num' }, u.open_reports), h('td', null, ago(u.last_seen_at))))))));
    };
    qin.onchange = load; st.onchange = load;
    main(h('div', { class: 'card' }, h('h2', null, 'Players'), h('div', { class: 'filters' }, qin, st, h('button', { class: 'btn small', onclick: load }, 'Search')), box));
    await load();
  }
  async function player(id) {
    const d = await api('GET', '/api/admin/users/' + id), u = d.user;
    const reason = h('input', { placeholder: 'Reason (shown to the player for warnings)' });
    const hours = h('select', null, [['', 'Length'], ['1', '1 hour'], ['24', '1 day'], ['72', '3 days'], ['168', '1 week'], ['720', '30 days'], ['8760', '1 year']].map(([v, l]) => h('option', { value: v }, l)));
    const sanc = (kind, label, role, danger) => { if (!can(role)) return null; const b = h('button', { class: 'btn small' + (danger ? ' danger' : '') }, label); b.onclick = () => { if (kind === 'suspend' && !hours.value) return toast('Choose a length first.', 'error'); if (['ban', 'reset_mfa'].includes(kind) && !confirm(`${label} ${u.name}?`)) return; act(b, async () => { await api('POST', `/api/admin/users/${id}/sanction`, { kind, reason: reason.value, hours: hours.value ? +hours.value : undefined }); player(id); }, 'Done'); }; return b; };
    const role = h('select', null, ['player', 'support', 'moderator', 'admin', 'owner'].map(r => h('option', { value: r, selected: r === u.role }, r)));
    const setRole = h('button', { class: 'btn small' }, 'Set role'); setRole.onclick = () => act(setRole, () => api('POST', `/api/admin/users/${id}/role`, { role: role.value }), 'Role updated');
    const days = h('input', { type: 'number', min: 1, max: 3650, value: 30, style: 'width:100px' });
    const grant = h('button', { class: 'btn small' }, 'Grant membership'); grant.onclick = () => act(grant, () => api('POST', `/api/admin/users/${id}/grant`, { days: +days.value }), 'Granted');
    const del = h('button', { class: 'btn small danger' }, 'Delete account'); del.onclick = () => { if (prompt(`Type DELETE to erase ${u.name}'s account`) !== 'DELETE') return; act(del, () => api('POST', `/api/admin/users/${id}/delete`, { confirm: 'DELETE' }), 'Deleted'); };
    main(h('p', null, h('a', { href: '#players' }, '← Players')),
      h('div', { class: 'two' },
        h('div', { class: 'card' }, h('h2', null, u.name), h('dl', { class: 'kv' },
          h('dt', null, 'Status'), h('dd', null, u.status, u.suspendedUntil ? ' until ' + when(u.suspendedUntil) : ''), h('dt', null, 'Role'), h('dd', null, u.role),
          h('dt', null, 'Email'), h('dd', null, u.email || '—', u.email ? (u.emailVerified ? ' (verified)' : ' (unverified)') : ''), h('dt', null, 'Two-factor'), h('dd', null, u.mfa ? 'on' : 'off'),
          h('dt', null, 'Sign-ins'), h('dd', null, d.identities.map(i => i.provider).join(', ') || 'email'), h('dt', null, 'Membership'), h('dd', null, d.entitlements.subscriber ? `member${d.entitlements.until ? ' until ' + when(d.entitlements.until) : ''}` : 'free'),
          h('dt', null, 'Record'), h('dd', null, `${u.matches} matches, ${u.wins} wins, rating ${u.rating}`), h('dt', null, 'Muted until'), h('dd', null, when(u.mutedUntil)),
          h('dt', null, 'Joined'), h('dd', null, when(u.createdAt)), h('dt', null, 'Last seen'), h('dd', null, ago(u.lastSeenAt)), h('dt', null, 'Reports filed'), h('dd', null, d.reportsFiled))),
        h('div', { class: 'card stack' }, h('h2', null, 'Actions'), reason, hours,
          h('div', { class: 'row' }, sanc('warn', 'Warn', 'moderator'), sanc('mute', 'Mute', 'moderator'), sanc('unmute', 'Unmute', 'moderator'), sanc('suspend', 'Suspend', 'moderator', true), sanc('rename', 'Force rename', 'moderator')),
          h('div', { class: 'row' }, sanc('revoke_sessions', 'Sign out everywhere', 'moderator'), sanc('ban', 'Ban', 'admin', true), sanc('unban', 'Lift ban/suspension', 'admin'), sanc('reset_mfa', 'Reset two-factor', 'admin', true)),
          can('admin') ? [h('div', { class: 'row' }, role, setRole), h('div', { class: 'row' }, days, grant), h('div', { class: 'row' }, del)] : null)),
      h('div', { class: 'two' },
        h('div', { class: 'card' }, h('h2', null, 'Sanctions'), d.sanctions.length ? h('div', { class: 'list' }, d.sanctions.map(s => h('div', { class: 'item' }, h('div', null, h('b', null, s.kind), ' ', s.reason, s.until ? h('div', { class: 'muted' }, 'until ' + when(s.until)) : null), h('span', { class: 'muted' }, (s.by || 'system') + ' · ' + ago(s.created_at))))) : h('p', { class: 'muted' }, 'None.')),
        h('div', { class: 'card' }, h('h2', null, 'Reports against'), d.reportsAgainst.length ? h('div', { class: 'list' }, d.reportsAgainst.map(r => h('div', { class: 'item' }, h('div', null, h('b', null, r.reason), ' ', r.details), h('span', { class: 'muted' }, r.status + ' · ' + ago(r.created_at))))) : h('p', { class: 'muted' }, 'None.'))),
      h('div', { class: 'card' }, h('h2', null, 'Recent matches'), d.matches.length ? h('table', { class: 't' }, h('tbody', null, d.matches.map(m => h('tr', null, h('td', null, when(m.started_at)), h('td', null, m.mode), h('td', null, m.result || '—'), h('td', { class: 'num' }, m.duration_s ? Math.round(m.duration_s / 60) + ' min' : '—'))))) : h('p', { class: 'muted' }, 'None.')));
  }

  // ── announcements ──────────────────────────────────────────────
  async function announcements() {
    const title = h('input', { maxlength: 120, placeholder: 'Title' }), body = h('textarea', { rows: 3, maxlength: 2000, placeholder: 'Message players will see in the game' });
    const sev = h('select', null, [['info', 'Info'], ['warning', 'Warning'], ...(can('admin') ? [['critical', 'Critical']] : [])].map(([v, l]) => h('option', { value: v }, l)));
    const aud = h('select', null, [['all', 'Everyone'], ['subscribers', 'Members'], ['free', 'Free players']].map(([v, l]) => h('option', { value: v }, l)));
    const ends = h('input', { type: 'datetime-local' });
    const post = h('button', { class: 'btn primary' }, 'Publish now');
    const box = h('div', { class: 'list' });
    const load = async () => {
      const r = await api('GET', '/api/admin/announcements');
      box.replaceChildren(...r.announcements.map(a => {
        const live = !a.ends_at || new Date(a.ends_at) > new Date();
        const end = live ? h('button', { class: 'btn small', onclick: e => act(e.target, async () => { await api('DELETE', '/api/admin/announcements/' + a.id); await load(); }, 'Ended') }, 'End now') : null;
        return h('div', { class: 'item' }, h('div', null, h('b', { class: 'sev-' + a.severity }, a.title), h('div', { class: 'soft' }, a.body), h('div', { class: 'muted', style: 'font-size:.85rem' }, `${a.audience} · ${a.severity} · by ${a.author || '—'} · ${when(a.starts_at)}${a.ends_at ? ' → ' + when(a.ends_at) : ''}`)), live ? h('span', { class: 'pill good' }, 'live') : h('span', { class: 'pill' }, 'ended'), end);
      }));
    };
    post.onclick = () => act(post, async () => { await api('POST', '/api/admin/announcements', { title: title.value, body: body.value, severity: sev.value, audience: aud.value, endsAt: ends.value ? new Date(ends.value).toISOString() : undefined }); title.value = body.value = ''; await load(); }, 'Published and pushed to connected players');
    main(h('div', { class: 'card stack' }, h('h2', null, 'New announcement'), h('p', { class: 'muted' }, 'Pushed instantly to everyone online, and shown to players when they next open the game.'), title, body, h('div', { class: 'row' }, sev, aud, h('label', { style: 'margin:0' }, 'Ends (optional)'), ends), post),
      h('div', { class: 'card' }, h('h2', null, 'History'), box));
    await load();
  }

  // ── matches ────────────────────────────────────────────────────
  const STATUS = { open: 'Awaiting results', confirmed: 'Confirmed', disputed: 'Disputed', void: 'Void' };
  async function matches(filter) {
    const r = await api('GET', '/api/admin/matches' + (filter ? '?status=' + filter : ''));
    const tab = (id, label) => h('button', { class: 'btn small' + ((filter || '') === id ? '' : ' ghost'), onclick: () => { location.hash = 'matches' + (id ? '/' + id : ''); } }, label);
    const claimText = (m, p) => {
      const c = (m.claims || {})[p.uid]; if (!c) return 'no report';
      if (c.kind !== 'final') return c.kind;
      const mine = (c.results || []).map(x => { const who = (m.players || []).find(q => q.uid === x.uid); return `${who ? who.name : '?'} ${x.result}`; }).join(', ');
      return mine + (c.audit ? ` · audit ${c.audit.verdict}${c.audit.reasons && c.audit.reasons.length ? ': ' + c.audit.reasons.join('; ') : ''}` : '');
    };
    const row = m => {
      const players = m.players || [];
      const detail = m.status === 'disputed' ? h('tr', { class: 'sub' }, h('td', { colspan: 6 }, h('div', { class: 'claims' }, players.map(p => h('div', { class: 'claim' },
        h('b', null, p.name + ': '), h('span', null, claimText(m, p)),
        (m.claims || {})[p.uid] && m.claims[p.uid].kind === 'final' && can('moderator') ? h('button', { class: 'btn small ghost', onclick: e => act(e.target, async () => { await api('POST', `/api/admin/matches/${m.id}/resolve`, { accept: p.uid }); route(); }, 'Resolved') }, `Accept ${p.name}’s account`) : null))))) : null;
      return [h('tr', null, h('td', null, when(m.started_at)), h('td', null, m.mode), h('td', null, m.host || '—'),
        h('td', null, players.map(p => `${p.name}${p.result ? ' (' + p.result + (p.delta ? (p.delta > 0 ? ' +' : ' ') + p.delta : '') + ')' : ''}${p.until ? ' ⏱' : ''}`).join(', ')),
        h('td', null, h('span', { class: 'pill ' + (m.status === 'disputed' ? 'bad' : m.status === 'confirmed' ? 'good' : '') }, STATUS[m.status] || m.status), m.rated ? ' rated' : '', m.verdict ? ` · ${m.verdict}` : ''),
        h('td', { class: 'num' }, m.duration_s ? Math.round(m.duration_s / 60) + ' min' : m.ended_at ? '—' : 'live')), detail];
    };
    main(h('div', { class: 'tiles' }, h('div', { class: 'tile' }, h('div', { class: 'k' }, 'Lobbies'), h('div', { class: 'v' }, r.live.lobbies)), h('div', { class: 'tile' }, h('div', { class: 'k' }, 'In match'), h('div', { class: 'v' }, r.live.matches)), h('div', { class: 'tile' }, h('div', { class: 'k' }, 'Queued'), h('div', { class: 'v' }, r.live.queued)), h('div', { class: 'tile' }, h('div', { class: 'k' }, 'Disputed (30 d)'), h('div', { class: 'v' }, r.disputed))),
      h('div', { class: 'card' }, h('h2', null, 'Matches'),
        h('p', { class: 'muted' }, 'Matches run peer to peer. Every player reports the result; only results that agree count, and guests check the host’s simulation. Disputed matches change no ratings until a moderator accepts one player’s account.'),
        h('div', { class: 'row' }, tab('', 'All'), tab('disputed', 'Disputed'), tab('open', 'Awaiting results'), tab('void', 'Void')),
        h('div', { class: 'scroll' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Started'), h('th', null, 'Mode'), h('th', null, 'Host'), h('th', null, 'Players'), h('th', null, 'Result'), h('th', { class: 'num' }, 'Length'))),
          h('tbody', null, r.matches.map(row).flat())))));
  }

  // ── promo codes ────────────────────────────────────────────────
  const KIND = { month: '1 month', year: '1 year', life: 'Lifetime' };
  async function promos(id) {
    if (id) return promoDetail(id);
    const kind = h('select', null, Object.entries(KIND).map(([v, l]) => h('option', { value: v }, l)));
    const uses = h('input', { type: 'number', min: 1, max: 100000, value: 1, 'aria-label': 'Uses per code' });
    const count = h('input', { type: 'number', min: 1, max: 1000, value: 1, 'aria-label': 'How many codes' });
    const custom = h('input', { placeholder: 'e.g. BLOOMDAY (optional)', maxlength: 32 });
    const expires = h('input', { type: 'date', 'aria-label': 'Expires' });
    const note = h('input', { placeholder: 'Who or what these are for', maxlength: 200 });
    const make = h('button', { class: 'btn primary' }, 'Create');
    const out = h('div');
    const q = h('input', { type: 'search', placeholder: 'Search codes or notes' });
    const box = h('div');
    const csv = (codes, meta) => { const blob = new Blob(['code,kind,uses_each\n' + codes.map(c => `${c},${meta.kind},${meta.uses}`).join('\n')], { type: 'text/csv' }); const a = h('a', { href: URL.createObjectURL(blob), download: `ozymandosis-codes-${Date.now()}.csv` }); document.body.append(a); a.click(); a.remove(); };
    make.onclick = () => act(make, async () => {
      const body = { kind: kind.value, maxUses: +uses.value, count: +count.value, note: note.value, code: custom.value || undefined, expiresAt: expires.value ? new Date(expires.value + 'T23:59:59Z').toISOString() : undefined };
      const r = await api('POST', '/api/admin/promos', body);
      const meta = { kind: KIND[kind.value], uses: uses.value };
      out.replaceChildren(h('div', { class: 'msg ok' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', null, `${r.codes.length} code${r.codes.length > 1 ? 's' : ''} · ${meta.kind} · ${meta.uses} use${+meta.uses > 1 ? 's' : ''} each`),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => navigator.clipboard.writeText(r.codes.join('\n')).then(() => toast('Copied')) }, 'Copy all'), h('button', { class: 'btn small', onclick: () => csv(r.codes, meta) }, 'Download CSV'))),
        h('pre', { class: 'stack', style: 'max-height:200px' }, r.codes.join('\n'))));
      custom.value = ''; await load();
    }, 'Created');
    const load = async () => {
      const r = await api('GET', '/api/admin/promos?q=' + encodeURIComponent(q.value));
      box.replaceChildren(h('p', { class: 'muted' }, `${fmt(r.totals.codes)} codes, ${fmt(r.totals.redemptions)} redemptions in all`),
        h('div', { class: 'scroll' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Code'), h('th', null, 'Grants'), h('th', { class: 'num' }, 'Used'), h('th', null, 'Expires'), h('th', null, 'Note'), h('th', null, 'State'), h('th', null, ''))),
          h('tbody', null, r.promos.map(p => {
            const left = p.max_uses - p.uses, state = p.disabled ? h('span', { class: 'pill' }, 'disabled') : left <= 0 ? h('span', { class: 'pill' }, 'used up') : p.expires_at && new Date(p.expires_at) < new Date() ? h('span', { class: 'pill' }, 'expired') : h('span', { class: 'pill good' }, 'live');
            const tog = h('button', { class: 'btn small' + (p.disabled ? '' : ' danger') }, p.disabled ? 'Enable' : 'Disable');
            tog.onclick = e => { e.stopPropagation(); act(tog, async () => { await api('PATCH', '/api/admin/promos/' + p.id, { disabled: !p.disabled }); await load(); }, p.disabled ? 'Enabled' : 'Disabled'); };
            return h('tr', { class: 'click', onclick: () => { location.hash = 'promos/' + p.id; } }, h('td', { class: 'mono' }, p.code), h('td', null, KIND[p.kind]), h('td', { class: 'num' }, `${p.uses} / ${p.max_uses}`), h('td', null, p.expires_at ? new Date(p.expires_at).toLocaleDateString() : '—'), h('td', null, p.note || ''), h('td', null, state), h('td', null, tog));
          })))));
    };
    q.onchange = load;
    main(h('div', { class: 'card stack' }, h('h2', null, 'Create promo codes'), h('p', { class: 'muted' }, 'Each code gives free membership and works a set number of times, once per player. Codes stack on a player\'s existing free time.'),
      h('div', { class: 'fields' }, h('div', { class: 'fld' }, h('label', null, 'Grants'), kind), h('div', { class: 'fld' }, h('label', null, 'Uses per code'), uses), h('div', { class: 'fld' }, h('label', null, 'How many codes'), count), h('div', { class: 'fld' }, h('label', null, 'Expires (optional)'), expires)),
      h('div', { class: 'fields two' }, h('div', { class: 'fld' }, h('label', null, 'Custom code (single code only)'), custom), h('div', { class: 'fld' }, h('label', null, 'Note'), note)), h('div', null, make), out),
      h('div', { class: 'card' }, h('h2', null, 'Codes'), h('div', { class: 'filters' }, q), box));
    await load();
  }
  async function promoDetail(id) {
    const { promo: p, redemptions } = await api('GET', '/api/admin/promos/' + id);
    const max = h('input', { type: 'number', min: p.uses || 1, max: 100000, value: p.max_uses });
    const save = h('button', { class: 'btn small' }, 'Save uses'); save.onclick = () => act(save, () => api('PATCH', '/api/admin/promos/' + id, { maxUses: +max.value }), 'Saved');
    main(h('p', null, h('a', { href: '#promos' }, '← Promo codes')),
      h('div', { class: 'card' }, h('h2', { class: 'mono' }, p.code), h('dl', { class: 'kv' }, h('dt', null, 'Grants'), h('dd', null, KIND[p.kind]), h('dt', null, 'Used'), h('dd', null, `${p.uses} of ${p.max_uses}`), h('dt', null, 'Expires'), h('dd', null, when(p.expires_at)), h('dt', null, 'State'), h('dd', null, p.disabled ? 'disabled' : 'enabled'), h('dt', null, 'Note'), h('dd', null, p.note || '—'), h('dt', null, 'Created'), h('dd', null, when(p.created_at))),
        h('div', { class: 'row', style: 'margin-top:12px;flex-wrap:nowrap' }, h('label', { style: 'margin:0' }, 'Uses allowed'), max, save)),
      h('div', { class: 'card' }, h('h2', null, `Redeemed by (${redemptions.length})`), redemptions.length ? h('div', { class: 'list' }, redemptions.map(r => h('div', { class: 'item' }, h('a', { href: '#players/' + r.user_id }, r.display_name), h('span', { class: 'muted' }, when(r.redeemed_at))))) : h('p', { class: 'muted' }, 'Not used yet.')));
  }

  // ── live config ────────────────────────────────────────────────
  async function config() {
    const r = await api('GET', '/api/admin/config');
    const get = k => (r.config.find(c => c.key === k) || {}).value;
    const m = get('maintenance') || { on: false };
    const mOn = h('input', { type: 'checkbox', style: 'width:auto;min-height:0' }); mOn.checked = !!m.on;
    const mMsg = h('input', { value: m.message || '', placeholder: 'Message shown to players' });
    const minV = h('input', { value: get('minClientVersion') || '', placeholder: '0.5.0' });
    const free = h('input', { type: 'number', min: 0, max: 20, value: get('freeMatchesPerDay') ?? 1 });
    const feats = h('textarea', { rows: 4 }, JSON.stringify(get('features') || {}, null, 2));
    const put = (key, value, btn) => act(btn, () => api('PUT', '/api/admin/config/' + key, { value }), 'Saved');
    const b1 = h('button', { class: 'btn small' + (mOn.checked ? '' : ' danger') }, 'Save maintenance'); b1.onclick = () => { if (mOn.checked && !confirm('Turn on maintenance? Players (not staff) will be disconnected from matchmaking. Matches in progress continue peer to peer.')) return; put('maintenance', { on: mOn.checked, message: mMsg.value || undefined }, b1); };
    const b2 = h('button', { class: 'btn small' }, 'Save'); b2.onclick = () => put('minClientVersion', minV.value, b2);
    const b3 = h('button', { class: 'btn small' }, 'Save'); b3.onclick = () => put('freeMatchesPerDay', +free.value, b3);
    const b4 = h('button', { class: 'btn small' }, 'Save'); b4.onclick = () => { let v; try { v = JSON.parse(feats.value); } catch (e) { return toast('Features must be JSON.', 'error'); } put('features', v, b4); };
    main(h('div', { class: 'card stack' }, h('h2', null, 'Maintenance'), h('label', { style: 'display:flex;gap:10px;align-items:center;color:var(--ink)' }, mOn, 'Online play is under maintenance'), mMsg, b1),
      h('div', { class: 'card stack' }, h('h2', null, 'Minimum client version'), h('p', { class: 'muted' }, 'Older clients are asked to update before they can go online.'), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, minV, b2)),
      h('div', { class: 'card stack' }, h('h2', null, 'Free online matches per 24 hours'), h('p', { class: 'muted' }, 'Per account, rolling window, counted when a match starts (docs/MONETIZATION.md). Members are not counted; LAN play never is.'), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, free, b3)),
      h('div', { class: 'card stack' }, h('h2', null, 'Feature flags'), h('p', { class: 'muted' }, 'Sent to every client in /api/config.'), feats, b4));
  }

  // ── balance ────────────────────────────────────────────────────
  // Culture win rates from confirmed online matches: a dot at the rate, a line across
  // the 95% interval, and the 50% line; few games means a wide line, not a verdict.
  const CULTURE_NAMES = { verdant: 'The Verdant', luminant: 'The Luminants', current: 'The Slither', choir: 'The Choir', umbral: 'The Seethe', bloom: 'The Bloom' };
  function rateChart(rows) {
    const W = 520, row = 28, P = { l: 120, r: 70, t: 20, b: 22 }, H = P.t + P.b + rows.length * row;
    const ns = 'http://www.w3.org/2000/svg', S = (t, a) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const x = v => P.l + (W - P.l - P.r) * v;
    const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Win rate by culture with 95% intervals' });
    for (const v of [0, 0.25, 0.5, 0.75, 1]) { svg.append(S('line', { class: v === 0.5 ? 'ref' : 'grid', x1: x(v), x2: x(v), y1: P.t - 6, y2: H - P.b })); const tx = S('text', { class: 'axis', x: x(v), y: H - 6, 'text-anchor': 'middle' }); tx.textContent = Math.round(v * 100) + '%'; svg.append(tx); }
    rows.forEach((r, i) => {
      const cy = P.t + i * row + row / 2, g = S('g', { class: 'rate-row' });
      const title = S('title', {}); title.textContent = `${r.label}: ${r.wins} wins in ${r.games} games (${Math.round(r.rate * 100)}%, 95% interval ${Math.round(r.ci[0] * 100)} to ${Math.round(r.ci[1] * 100)}%)`;
      const lab = S('text', { class: 'label', x: P.l - 10, y: cy + 4, 'text-anchor': 'end' }); lab.textContent = r.label;
      const val = S('text', { class: 'value', x: W - P.r + 10, y: cy + 4 }); val.textContent = `${Math.round(r.rate * 100)}% · ${r.games}`;
      g.append(title, S('rect', { class: 'hit', x: 0, y: cy - row / 2, width: W, height: row }), lab, S('line', { class: 'ci', x1: x(r.ci[0]), x2: x(r.ci[1]), y1: cy, y2: cy }), S('circle', { class: 'pt', cx: x(r.rate), cy, r: 5 }), val);
      svg.append(g);
    });
    return h('div', { class: 'chart rate' }, svg);
  }
  async function balance(arg) {
    const days = Number(arg) || 30, r = await api('GET', '/api/admin/balance?days=' + days);
    const modes = [...new Set(r.cultures.map(c => c.mode))];
    const sum = list => { const by = {}; for (const c of list) { const b = by[c.culture] || (by[c.culture] = { culture: c.culture, games: 0, wins: 0 }); b.games += c.games; b.wins += c.wins; } return Object.values(by); };
    const wilson = (w, n) => { if (!n) return [0, 0]; const z2 = 3.8416, p = w / n, d = 1 + z2 / n, c = p + z2 / (2 * n), m = 1.96 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
    const rows = list => sum(list).map(c => ({ label: CULTURE_NAMES[c.culture] || c.culture, games: c.games, wins: c.wins, rate: c.games ? c.wins / c.games : 0, ci: wilson(c.wins, c.games) })).sort((a, b) => b.rate - a.rate);
    const range = (d, l) => h('button', { class: 'btn small' + (d === days ? '' : ' ghost'), onclick: () => { location.hash = 'balance/' + d; } }, l);
    const all = rows(r.cultures);
    main(h('div', { class: 'card' }, h('h2', null, 'Culture win rates'),
        h('p', { class: 'muted' }, 'Confirmed online matches only. In a fair game every culture sits near 50% in duels (lower in free-for-alls, where most players lose). Look for intervals that clear the 50% line, not single dots.'),
        h('div', { class: 'row' }, range(7, '7 days'), range(30, '30 days'), range(90, '90 days')),
        all.length ? rateChart(all) : h('p', { class: 'muted' }, 'No confirmed online matches in this period yet.'),
        modes.length > 1 ? modes.map(m => h('details', null, h('summary', null, (E_MODES[m] || m)), rateChart(rows(r.cultures.filter(c => c.mode === m))))) : null),
      h('div', { class: 'card' }, h('h2', null, 'Designs in the field'),
        h('p', { class: 'muted' }, 'Creature designs fielded in confirmed matches (three or more alive at the end), with at least five games.'),
        r.designs.length ? h('div', { class: 'scroll' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Chassis'), h('th', null, 'Organs'), h('th', { class: 'num' }, 'Games'), h('th', { class: 'num' }, 'Win rate'), h('th', { class: 'num' }, 'Fielded'))),
          h('tbody', null, r.designs.map(d => h('tr', null, h('td', null, d.chassis), h('td', null, d.organs.join(', ')), h('td', { class: 'num' }, fmt(d.games)), h('td', { class: 'num' }, Math.round(d.rate * 100) + '%'), h('td', { class: 'num' }, fmt(d.hatched))))))) : h('p', { class: 'muted' }, 'Not enough games yet.')));
  }
  const E_MODES = { annihilation: 'Annihilation', tide: 'Hold the Tide', regicide: 'Heartfall', bloom: 'Luminance' };

  // ── operations ─────────────────────────────────────────────────
  async function ops() {
    const r = await api('GET', '/api/admin/ops');
    const hb = r.heartbeats.find(x => x.name === 'backup'), d = (hb && hb.detail) || {};
    const ageH = hb ? (Date.now() - new Date(hb.at).getTime()) / 3600e3 : null;
    const open = r.alerts.filter(a => !a.resolved_at);
    const tile = (k, v, sub, bad) => h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v' + (bad ? ' sev-critical' : '') }, v, sub ? h('small', null, ' ' + sub) : null));
    const check = h('button', { class: 'btn small', onclick: e => act(e.target, async () => { const x = await api('POST', '/api/admin/ops/check'); toast(x.firing.length ? `${x.firing.length} alert(s) firing` : 'All clear'); route(); }) }, 'Run checks now');
    main(h('div', { class: 'tiles' },
        tile('Open alerts', open.length, '', open.length > 0),
        tile('Last backup', hb ? ago(hb.at) : 'never', hb ? (hb.ok ? (d.remote === true ? 'off-site ✓' : d.remote === false ? 'off-site failed' : 'local only') : 'failed') : '', !hb || !hb.ok || ageH > 13),
        tile('Disk', d.disk != null ? d.disk + '%' : '—', '', d.disk >= 85),
        tile('Service', r.revision, `up ${Math.round(r.uptimeS / 3600)} h · ${r.memoryMb} MB · p99 lag ${Math.round(r.lag.p99)} ms`)),
      h('div', { class: 'card' }, h('h2', null, 'Alerts'),
        h('p', { class: 'muted' }, `Checked every minute. Sent to ${[r.alerting.email ? 'email' : null, r.alerting.webhook ? 'the webhook' : null].filter(Boolean).join(' and ') || 'nobody yet: set ALERT_EMAIL or ALERT_WEBHOOK_URL'}; repeated every 6 hours while they last.`),
        h('div', { class: 'row' }, check),
        r.alerts.length ? h('div', { class: 'scroll' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Alert'), h('th', null, 'Since'), h('th', null, 'Last'), h('th', { class: 'num' }, 'Checks'), h('th', null, 'State'))),
          h('tbody', null, r.alerts.map(a => h('tr', null, h('td', null, h('b', null, a.title), h('div', { class: 'muted' }, a.body)), h('td', null, when(a.first_at)), h('td', null, ago(a.last_at)), h('td', { class: 'num' }, a.count),
            h('td', null, h('span', { class: 'pill ' + (a.resolved_at ? 'good' : 'bad') }, a.resolved_at ? 'resolved ' + ago(a.resolved_at) : 'firing'))))))) : h('p', { class: 'muted' }, 'No alerts yet.')),
      h('div', { class: 'card' }, h('h2', null, 'Keys'),
        h('p', { class: 'muted' }, `Match tickets are signed with the newest key; ${r.keyring} key(s) currently verify. Rotate with \`npm run admin -- keys:rotate\`; rotate SECRET_KEY as described in docs/OPERATIONS.md.`),
        h('table', { class: 't' }, h('tbody', null, r.keys.map(k => h('tr', null, h('td', { class: 'mono' }, k.id), h('td', null, 'created ' + when(k.created_at)), h('td', null, k.retired_at ? 'retired ' + ago(k.retired_at) : 'signing')))))),
      h('div', { class: 'card' }, h('h2', null, 'Metrics'), h('p', { class: 'muted' }, r.alerting.metrics ? 'Prometheus metrics are served at /metrics to requests carrying METRICS_TOKEN.' : '/metrics is off. Set METRICS_TOKEN (24+ characters) to let a scraper read it.')));
  }

  async function audit() {
    const r = await api('GET', '/api/admin/audit?limit=200');
    main(h('div', { class: 'card' }, h('h2', null, 'Audit log'), h('div', { class: 'scroll' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'Who'), h('th', null, 'Action'), h('th', null, 'Target'), h('th', null, 'Detail'))),
      h('tbody', null, r.log.map(l => h('tr', null, h('td', null, when(l.at)), h('td', null, l.actor || 'system'), h('td', { class: 'mono' }, l.action), h('td', { class: 'mono' }, l.target ? h('a', { href: '#players/' + l.target }, String(l.target).slice(0, 8)) : '—'), h('td', { class: 'mono' }, JSON.stringify(l.detail)))))))));
  }

  (async function boot() {
    try { me = await api('GET', '/api/me'); } catch (e) { location.href = '/login'; return; }
    if (!can('support')) { main(h('div', { class: 'card' }, h('h2', null, 'Staff only'), h('p', null, 'Your account does not have access to the admin console.'), h('a', { class: 'btn', href: '/account' }, 'Back to your account'))); return; }
    $('#who').textContent = `${me.user.name} · ${me.user.role}`;
    addEventListener('hashchange', route);
    route();
  })();
})();
