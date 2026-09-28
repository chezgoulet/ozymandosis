// Online end to end: the play service (in-memory Postgres) introduces two browsers,
// who play over WebRTC with a signed ticket; the free time limit ends the match.
const pw = require('../tools/pw.cjs');
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
process.env.PORT = process.env.PORT || '8095'; process.env.QUIET = '1';
const lan = require('../server/server.js');
const PLAY = 8791, PLAY_URL = `http://localhost:${PLAY}`, GAME = `http://localhost:${process.env.PORT}/?nosw=1&play=${encodeURIComponent(PLAY_URL)}`;
const OUT = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const play = spawn(process.execPath, [require.resolve('tsx/cli'), 'src/index.ts'], { cwd: path.join(__dirname, '../apps/play'), env: Object.assign({}, process.env, { NODE_ENV: 'test', PORT: String(PLAY), LOG_LEVEL: 'warn', PGLITE_DIR: '', PUBLIC_URL: PLAY_URL }), stdio: ['ignore', 'inherit', 'inherit'] });
  const stopAll = code => { try { play.kill(); } catch (e) { /* */ } lan.close(); process.exit(code); };
  for (let i = 0; i < 60; i++) { try { if ((await fetch(PLAY_URL + '/healthz')).ok) break; } catch (e) { /* booting */ } await sleep(500); }
  const b = await pw.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const errs = [];
  const page = async (name, vp) => {
    const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`[${name}] ${e.message}`));
    p.on('console', m => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errs.push(`[${name}] ${m.text()}`); });
    await p.goto(GAME); await p.waitForTimeout(600); return p;
  };
  const account = async (p, email, name) => {
    await p.click('#m-mp'); await p.waitForSelector('#mp-account button');
    await p.click('#mp-account button');
    await p.click('.modal.signin .seg button:nth-child(2)');
    await p.fill('.modal.signin input[type=email]', email); await p.fill('.modal.signin input[type=password]', 'a long enough password'); await p.fill('.modal.signin input[type=text]', name);
    await p.selectOption('.modal.signin select[aria-label="Birth month"]', '6'); await p.selectOption('.modal.signin select[aria-label="Birth year"]', '1990');
    await p.click('.modal.signin button[type=submit]');
    await p.waitForSelector('.modal.signin', { state: 'detached', timeout: 20000 }).catch(async e => { throw new Error('sign-up did not finish: ' + (await p.textContent('.modal.signin .form-err').catch(() => '?'))); });
    const mail = (await (await fetch(PLAY_URL + '/api/dev/outbox')).json()).mail.filter(m => m.to === email).pop();
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)[1];
    assert((await fetch(PLAY_URL + '/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })).ok);
    await p.click('#scr-mp [data-back]'); await p.click('#m-mp'); await p.waitForSelector('#mp-online-play:not([hidden])');
  };
  try {
    const host = await page('host', { width: 1280, height: 800 }), guest = await page('guest', { width: 1024, height: 720 });
    await account(host, `host${Date.now()}@example.com`, 'Hostling');
    await account(guest, `guest${Date.now()}@example.com`, 'Guestling');
    await host.screenshot({ path: OUT + '/online-01-mp.png' });
    await host.click('#mp-host-online'); await host.waitForSelector('#scr-setup:not([hidden])');
    const room = (await host.textContent('#setup-room')).replace('ROOM ', '').trim();
    assert.match(room, /^[A-Z]{5}$/); console.log('online room', room);
    // the public lobby shows up in the guest's browser
    await guest.click('#mp-refresh'); await guest.waitForSelector(`#mp-lobbies .lobby-item`);
    await guest.fill('#mp-code-online', room); await guest.click('#mp-join-online');
    await guest.waitForSelector('#scr-setup:not([hidden])'); await host.waitForTimeout(800);
    const hostSeesGuest = await host.evaluate(() => [...document.querySelectorAll('#slots .slot-row select:nth-child(2)')].map(s => s.selectedOptions[0].textContent));
    console.log('host slots', hostSeesGuest); assert(hostSeesGuest.some(t => /Guestling/.test(t)));
    // lobby chat goes through the service, filtered
    await guest.fill('#lobby-msg', 'what the fuck, hello'); await guest.click('#lobby-chat button');
    await host.waitForFunction(() => /hello/.test(document.getElementById('lobby-log').textContent), null, { timeout: 5000 });
    const heard = await host.textContent('#lobby-log');
    assert(/•+/.test(heard) && !/fuck/.test(heard), 'chat filtered by the service'); console.log('lobby chat filtered');
    await host.screenshot({ path: OUT + '/online-02-lobby.png' });
    await host.click('#setup-start');
    await guest.waitForSelector('#game:not([hidden])', { timeout: 10000 }); await guest.waitForTimeout(2000);
    const tk = await Promise.all([host, guest].map(p => p.evaluate(() => E.game.ticket && { n: E.game.ticket.players.length, until: E.game.ticket.players.map(x => x.until), unverified: !!E.game.ticket.unverified })));
    console.log('tickets', JSON.stringify(tk)); assert(tk[0] && tk[1] && tk[0].n === 2 && tk[0].until.every(Boolean), 'free players carry deadlines');
    assert(await guest.evaluate(() => !document.getElementById('h-limit').hidden), 'free time chip shows');
    const g = await guest.evaluate(() => ({ local: E.game.local, mode: E.game.netMode, units: E.game.world.s.units.length }));
    console.log('guest', JSON.stringify(g)); assert.strictEqual(g.mode, 'guest'); assert(g.units > 5);
    await guest.screenshot({ path: OUT + '/online-03-guest.png' });
    // reports reach the service
    const rep = await host.evaluate(() => E.Online.reportPlayer(E.game.rivals()[0].uid, 'other', 'e2e check').then(() => 'ok', e => e.message));
    assert.strictEqual(rep, 'ok');
    assert(await host.evaluate(() => E.Crash.send({ kind: 'bug', description: 'e2e bug report', message: 'e2e' })), 'bug report accepted');
    // the host's free time runs out: the match ends for both
    await host.evaluate(() => { E.game.ticketOffset += 16 * 60e3; });
    await guest.waitForSelector('#scr-menu:not([hidden])', { timeout: 10000 });
    await host.waitForSelector('#scr-menu:not([hidden])', { timeout: 10000 });
    assert(await guest.evaluate(() => !!document.querySelector('.modal')), 'membership prompt offered');
    await guest.screenshot({ path: OUT + '/online-04-limit.png' });
    console.log('limit enforced on both sides');
    await sleep(500);
    await Promise.all([host, guest].map(p => p.evaluate(() => { document.querySelectorAll('.modal-bg, .modal').forEach(m => m.remove()); })));
    await guest.screenshot({ path: OUT + '/online-04b-before.png' });
    // a second match plays to the end: both report, the guest checks the host, the server confirms
    await host.click('#m-mp'); await host.waitForSelector('#mp-online-play:not([hidden])');
    await host.click('#mp-host-online'); await host.waitForSelector('#scr-setup:not([hidden])');
    const room2 = (await host.textContent('#setup-room')).replace('ROOM ', '').trim();
    await guest.click('#m-mp'); await guest.waitForSelector('#mp-online-play:not([hidden])');
    await guest.waitForSelector('#mp-join-online', { state: 'visible' });
    await guest.fill('#mp-code-online', room2); await guest.click('#mp-join-online');
    await guest.waitForSelector('#scr-setup:not([hidden])'); await host.waitForTimeout(800);
    await host.click('#setup-start');
    await guest.waitForSelector('#game:not([hidden])', { timeout: 10000 }); await guest.waitForTimeout(1500);
    // the guest gives a few orders (they must show up in the host's log)
    await guest.evaluate(() => { const g = E.game, ids = g.world.s.units.filter(u => u.o === g.local).map(u => u.id); for (let i = 0; i < 3; i++) g.send({ c: 'move', ids, x: 500 + i * 20, y: 500 }); });
    await host.waitForTimeout(800);
    // the host's link to the service drops mid-match: it reattaches by itself and keeps the lobby
    await host.evaluate(() => { window.__ws = E.game.relay.ws; E.game.relay.ws.close(); });
    await host.waitForFunction(() => E.game.relay.ws && E.game.relay.ws !== window.__ws && E.game.relay.ws.readyState === 1 && !E.game.resuming, null, { timeout: 20000 });
    console.log('host resumed signaling');
    // fast-forward the host's world through a few audit checkpoints, then end it
    await host.evaluate(async () => { const g = E.game, w = g.world; for (let i = 0; i < 1900; i++) { w.step(); g.auditHost.tick(); w.drainEvents(); if (i % 200 === 0) await new Promise(r => setTimeout(r, 30)); } });
    await host.waitForTimeout(1500);
    await host.evaluate(() => { const w = E.game.world; w.s.over = true; w.s.winner = w.teamOf(E.game.local); });
    const confirmed = p => p.waitForFunction(() => /confirmed/i.test(document.getElementById('end-result').textContent), null, { timeout: 40000 });
    await Promise.all([confirmed(host), confirmed(guest)]);
    const audit = await guest.evaluate(() => E.game.lastAudit);
    console.log('guest audit', JSON.stringify(audit), '·', await host.textContent('#end-result'));
    assert(audit && audit.verdict === 'ok' && audit.windows >= 2, 'guest verified the host');
    await guest.screenshot({ path: OUT + '/online-05-result.png' });
    // lineage, designs and saves sync to the account
    const cloud = await guest.evaluate(async () => { await E.Cloud.sync(); return (await E.Online.api('GET', '/api/cloud')).items.map(i => i.key); });
    console.log('cloud items', cloud.join(', ')); assert(cloud.includes('profile'), 'profile synced');
  } catch (e) { console.error(e); errs.push(e.message); }
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await b.close(); stopAll(errs.length ? 1 : 0);
})();
