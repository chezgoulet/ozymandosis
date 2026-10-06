// LAN play end to end (work order §1): two clients on one network play a full match
// with the service unreachable, no account, no match ticket, and a direct (not
// relayed) WebRTC link. The in-app host is the real shared signaling code
// (server/signal.cjs) behind a stand-in for the native bridge (window.ozyLan), so
// this exercises the same path the desktop shell uses; Android and iOS implement
// that bridge natively (LanPlugin).
const pw = require('../tools/pw.cjs');
const http = require('http');
const path = require('path');
const assert = require('assert');
const { createSignal } = require('../server/signal.cjs');
process.env.PORT = process.env.PORT || '8096'; process.env.QUIET = '1';
const files = require('../server/server.js');
// The service these clients would use for online play. It is blocked below; nothing may even try it.
const SERVICE = 'https://play.ozymandosis.com';
const GAME = `http://localhost:${process.env.PORT}/?nosw=1&play=${encodeURIComponent(SERVICE)}`;
const OUT = path.join(__dirname, 'shots');
const TRACES = path.join(__dirname, 'traces');

// the "native" LAN host: one per page that asks, like one per device
const hosts = new Map();
async function startHost(key, name) {
  await stopHost(key);
  const signal = createSignal(), server = http.createServer((q, s) => { s.writeHead(404); s.end(); });
  server.on('upgrade', (req, socket) => signal.upgrade(req, socket));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  hosts.set(key, { signal, server, port, name });
  return { port, addrs: ['127.0.0.1'] };
}
async function stopHost(key) { const h = hosts.get(key); if (!h) return; hosts.delete(key); h.signal.close(); await new Promise(r => h.server.close(r)); }

(async () => {
  const b = await pw.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const errs = [], serviceCalls = [];
  let phase = 'boot';
  const page = async (name, vp) => {
    const ctx = await b.newContext({ viewport: vp });
    await ctx.tracing.start({ screenshots: true, snapshots: true });
    // the service is unreachable: every request to it fails, and is counted
    await ctx.route(u => u.origin === SERVICE, route => { serviceCalls.push(`[${name}/${phase}] ${route.request().method()} ${route.request().url()}`); route.abort('internetdisconnected'); });
    await ctx.exposeBinding('__lan', (_src, op, arg) => op === 'host' ? startHost(name, arg.name) : op === 'stop' ? stopHost(name)
      : { picker: false, services: [...hosts.entries()].filter(([k]) => k !== name).map(([, h]) => ({ name: h.name, port: h.port, addrs: ['127.0.0.1'] })) });
    await ctx.addInitScript(() => { window.ozyLan = { startHost: o => window.__lan('host', o), stopHost: () => window.__lan('stop'), discover: o => window.__lan('discover', o) }; });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`[${name}] ${e.message}`));
    // This test aborts every request to the service on purpose, so the browser's
    // complaint about it is expected on every engine. Firefox words the same
    // aborted cross-origin request as "Cross-Origin Request Blocked" where
    // Chromium says "Failed to load resource", so match the engine-neutral fact
    // — the error names the service we deliberately blocked — instead of one
    // engine's phrasing.
    p.on('console', m => {
      const t = m.text();
      const aboutTheServiceWeBlocked = t.includes(SERVICE) || /Cross-Origin Request Blocked/.test(t);
      if (m.type() === 'error' && !aboutTheServiceWeBlocked && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(t)) errs.push(`[${name}] ${t}`);
    });
    await p.goto(GAME); await p.waitForTimeout(600);
    return { p, ctx };
  };
  let host, guest;
  try {
    host = await page('host', { width: 1280, height: 800 }); guest = await page('guest', { width: 1024, height: 720 });
    const H = host.p, G = guest.p;
    phase = 'lan';
    // host: this device opens the game itself and shows a join code
    await H.click('#m-mp'); await H.fill('#mp-name', 'Hearth'); await H.click('#mp-host');
    await H.waitForSelector('#scr-setup:not([hidden])');
    const shown = (await H.textContent('#setup-room')).trim();
    const code = shown.replace('JOIN CODE ', '');
    assert.match(code, /^[0-9A-Z]{5}-[0-9A-Z]{5}$/, 'a join code is shown: ' + shown); console.log('join code', code);
    assert.strictEqual((await H.textContent('#lobby-code')).trim(), code, 'the join code is shown prominently');
    // guest: discovery lists the game…
    await G.click('#m-mp'); await G.fill('#mp-name', 'Wanderer');
    assert(await G.isVisible('#mp-find'), 'find nearby offered when the device can search');
    await G.click('#mp-find'); await G.waitForSelector('#mp-lan-found .lobby-item');
    console.log('found nearby:', await G.textContent('#mp-lan-found'));
    // …but joins with the code, the path that needs no discovery at all
    await G.fill('#mp-code', code.toLowerCase().replace('-', ' ')); await G.click('#mp-join');
    await G.waitForSelector('#scr-setup:not([hidden])'); await H.waitForTimeout(800);
    assert.strictEqual((await G.textContent('#lobby-code')).trim(), code, 'the guest sees the join code too');
    const seats = await H.evaluate(() => [...document.querySelectorAll('#slots .slot-row select:nth-child(2)')].map(s => s.selectedOptions[0].textContent));
    assert(seats.some(t => /Wanderer/.test(t)), 'host seats the guest: ' + seats);
    await H.screenshot({ path: OUT + '/lan-01-lobby.png' });
    await H.click('#setup-start');
    await G.waitForSelector('#game:not([hidden])', { timeout: 10000 }); await G.waitForTimeout(2500);
    // no account, no ticket, direct link
    const state = await Promise.all([H, G].map(p => p.evaluate(async () => {
      const r = E.game.relay, peer = [...r.peers.values()][0], cfg = peer.pc.getConfiguration();
      const stats = await peer.pc.getStats(); let pair = null;
      stats.forEach(s => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
      if (!pair) stats.forEach(s => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
      const kind = id => (stats.get(id) || {}).candidateType;
      return { mode: E.game.netMode, online: !!E.game.online, signedIn: E.Online.signedIn(), ticket: !!E.game.ticket, lan: !!r.opts.lan,
        policy: cfg.iceTransportPolicy, iceServers: (cfg.iceServers || []).length, pair: pair && [kind(pair.localCandidateId), kind(pair.remoteCandidateId)] };
    })));
    console.log('host', JSON.stringify(state[0])); console.log('guest', JSON.stringify(state[1]));
    for (const s of state) {
      assert(s.lan && !s.online && !s.signedIn && !s.ticket, 'a LAN match: no account, no service, no ticket');
      assert.strictEqual(s.policy, 'all'); assert.strictEqual(s.iceServers, 0, 'no STUN or TURN server is even configured');
      assert(s.pair && !s.pair.includes('relay'), 'the selected pair is direct, not relayed: ' + s.pair);
    }
    assert.strictEqual(state[1].mode, 'guest');
    // play: the guest's orders reach the host, and the match runs to its end
    await G.evaluate(() => { const g = E.game, ids = g.world.s.units.filter(u => u.o === g.local).map(u => u.id); g.send({ c: 'move', ids, x: 600, y: 600 }); });
    await H.evaluate(async () => { const w = E.game.world; for (let i = 0; i < 1800; i++) { w.step(); w.drainEvents(); if (i % 200 === 0) await new Promise(r => setTimeout(r, 30)); } });
    await G.waitForFunction(() => E.game.world.s.t > 55, null, { timeout: 15000 }).catch(() => {});
    const t = await G.evaluate(() => E.game.world.s.t); console.log('guest sees match time', t.toFixed(1), 's'); assert(t > 55, 'the guest follows the host');
    await H.evaluate(() => { const w = E.game.world; w.s.over = true; w.s.winner = w.teamOf(E.game.local); });
    await Promise.all([H, G].map(p => p.waitForSelector('#ov-end:not([hidden])', { timeout: 15000 })));
    await G.screenshot({ path: OUT + '/lan-02-end.png' });
    console.log('match ended on both sides');
    phase = 'after';
    assert.deepStrictEqual(serviceCalls.filter(c => /\/lan\]/.test(c)), [], 'no call to the service during LAN play:\n' + serviceCalls.join('\n'));
    console.log(`service calls during LAN play: 0 (at boot, blocked: ${serviceCalls.filter(c => /\/boot\]/.test(c)).length})`);
  } catch (e) { console.error(e); errs.push(e.message); }
  // a trace of every failed run, replayable with `npx playwright show-trace`
  for (const [n, x] of [['host', host], ['guest', guest]]) if (x) await x.ctx.tracing.stop(errs.length ? { path: `${TRACES}/lan-${n}.zip` } : undefined).catch(() => {});
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await b.close(); for (const k of [...hosts.keys()]) await stopHost(k); files.close(); process.exit(errs.length ? 1 : 0);
})();
