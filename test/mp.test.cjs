// Multiplayer end-to-end: host + guest browsers, introduced by the LAN signaling server, playing over WebRTC.
const { chromium } = require(process.env.PW || '/home/c/git/chezgoulet/veil/client/node_modules/playwright-core');
const path = require('path');
process.env.PORT = process.env.PORT || '8094'; process.env.QUIET = '1';
const server = require('../server/server.js');
const URL0 = `http://localhost:${process.env.PORT}/`;
const OUT = path.join(__dirname, 'shots');
const assert = require('assert');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const errs = [];
  const page = async (name, vp, touch) => {
    const ctx = await b.newContext({ viewport: vp, hasTouch: !!touch, isMobile: !!touch });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`[${name}] ${e.message}\n${e.stack}`));
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errs.push(`[${name}] ${m.text()}`); });
    await p.goto(URL0); await p.waitForTimeout(500);
    return p;
  };
  const host = await page('host', { width: 1280, height: 800 });
  const guest = await page('guest', { width: 390, height: 844 }, true);
  await host.click('#m-mp'); await host.fill('#mp-name', 'Hostess'); await host.click('#mp-host');
  await host.waitForSelector('#scr-setup:not([hidden])');
  const room = (await host.textContent('#setup-room')).replace('ROOM ', '').trim();
  console.log('room', room);
  await guest.click('#m-mp'); await guest.fill('#mp-name', 'Guesto'); await guest.fill('#mp-code', room); await guest.click('#mp-join');
  await guest.waitForSelector('#scr-setup:not([hidden])');
  await host.waitForTimeout(600);
  // guest picks a culture
  await guest.selectOption('#slots .slot-row:nth-child(2) select:first-child', 'current');
  await host.waitForTimeout(600);
  const hostSlots = await host.evaluate(() => [...document.querySelectorAll('#slots .slot-row select:first-child')].map(s => s.value));
  console.log('host sees cultures', hostSlots);
  assert.strictEqual(hostSlots[1], 'current');
  // add a bot, chat
  await host.click('#slot-add'); await host.waitForTimeout(200);
  await host.selectOption('#slots .slot-row:nth-child(3) select:nth-child(2)', 'bot:normal');
  await guest.fill('#lobby-msg', 'hello from guest'); await guest.click('#lobby-chat button'); await host.waitForTimeout(400);
  const log = await host.textContent('#lobby-log'); assert(log.includes('hello from guest'), 'chat relay');
  await host.screenshot({ path: OUT + '/mp-01-lobby-host.png' });
  await guest.screenshot({ path: OUT + '/mp-02-lobby-guest.png' });
  await host.click('#setup-start');
  await guest.waitForSelector('#game:not([hidden])', { timeout: 8000 });
  await guest.waitForTimeout(1500);
  const g1 = await guest.evaluate(() => ({ local: E.game.local, units: E.game.world.s.units.length, t: E.game.world.s.t, mode: E.game.netMode }));
  console.log('guest', JSON.stringify(g1));
  assert.strictEqual(g1.local, 1); assert(g1.units >= 6);
  // fog: the guest only receives rivals its team can see; the host has the whole world
  const hostUnits = await host.evaluate(() => E.game.world.s.units.length);
  const leak = await guest.evaluate(() => { const w = E.game.world, src = w.visionSources(E.game.local); return w.s.units.filter(u => w.isEnemy(E.game.local, u.o) && !src.some(v => Math.hypot(v.x - u.x, v.y - u.y) < v.r + 260)).length; });
  console.log('fog: host units', hostUnits, 'guest units', g1.units, 'unseen rivals sent', leak);
  assert(hostUnits > g1.units && leak === 0, 'snapshots are culled to what the guest can see');
  assert(await host.evaluate(() => [...E.game.relay.peers.values()].every(p => p.z)), 'links are compressed');
  // guest commands: hatch at its nucleus
  await guest.evaluate(() => { const g = E.game, n = g.world.s.structs.find(b => b.o === g.local); g.send({ c: 'hatch', sid: n.id, d: 'warden' }); });
  await host.waitForTimeout(7000);
  const q = await host.evaluate(() => E.game.world.s.players[1].stats.hatched);
  console.log('guest hatched on host:', q); assert(q >= 1, 'guest command reached host');
  await guest.tap('#f-home'); await guest.waitForTimeout(500);
  await guest.screenshot({ path: OUT + '/mp-03-guest-game.png' });
  await host.screenshot({ path: OUT + '/mp-04-host-game.png' });
  // host pause propagates
  await host.keyboard.press('F10'); await guest.waitForTimeout(500);
  const paused = await guest.evaluate(() => !document.getElementById('ov-pause').hidden);
  console.log('guest sees pause', paused); assert(paused);
  await host.click('#p-resume'); await guest.waitForTimeout(400);
  // in-game chat
  await guest.evaluate(() => { E.game.relay.toHost({ k: 'chat', text: 'gg' }); }); await host.waitForTimeout(400);
  assert((await host.textContent('#chat-log')).includes('gg'));
  // the guest's link to the host breaks: it rejoins by itself, same seat
  await guest.evaluate(() => { window.__oldRelay = E.game.relay; E.game.relay.peers.get(0).pc.close(); });
  await guest.waitForFunction(() => E.game.running && E.game.relay !== window.__oldRelay && E.game.netMode === 'guest' && !E.game.reconnecting && document.getElementById('net-banner').hidden && E.game.world.s.units.length > 0, null, { timeout: 30000 });
  await host.waitForTimeout(600);
  const back = await host.evaluate(() => E.game.world.s.players[1].kind);
  console.log('auto-rejoin', back, await guest.evaluate(() => E.game.local)); assert.strictEqual(back, 'remote');
  // guest disconnect -> bot takeover, then rejoin
  await guest.close(); await host.waitForTimeout(800);
  const kind = await host.evaluate(() => E.game.world.s.players[1].kind); console.log('after drop kind', kind); assert.strictEqual(kind, 'bot');
  const guest2 = await page('guest2', { width: 1024, height: 700 });
  await guest2.click('#m-mp'); await guest2.fill('#mp-name', 'Guesto'); await guest2.fill('#mp-code', room); await guest2.click('#mp-join');
  await guest2.waitForTimeout(1500);
  // mid-game join goes straight into the game
  const st = await guest2.evaluate(() => ({ inGame: !document.getElementById('game').hidden, local: E.game && E.game.local }));
  console.log('rejoin', JSON.stringify(st)); assert(st.inGame && st.local === 1);
  const kind2 = await host.evaluate(() => E.game.world.s.players[1].kind); assert.strictEqual(kind2, 'remote');
  await guest2.screenshot({ path: OUT + '/mp-05-rejoin.png' });
  // a build on a different peer protocol is refused with a clear message, and the match carries on
  const old = await page('old', { width: 1024, height: 700 });
  await old.evaluate(() => { E.PROTOCOL = 1; });
  await old.click('#m-mp'); await old.fill('#mp-name', 'Oldie'); await old.fill('#mp-code', room); await old.click('#mp-join');
  await old.waitForFunction(() => /update/i.test(document.getElementById('mp-status').textContent), null, { timeout: 10000 });
  const oldSt = await old.evaluate(() => ({ status: document.getElementById('mp-status').textContent, inGame: !document.getElementById('game').hidden }));
  console.log('old protocol', JSON.stringify(oldSt)); assert(!oldSt.inGame && /update/i.test(oldSt.status));
  assert.strictEqual(await host.evaluate(() => E.game.world.s.players[1].kind), 'remote', 'host match unaffected');
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await b.close(); server.close(); process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
