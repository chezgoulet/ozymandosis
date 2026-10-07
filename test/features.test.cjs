// SPDX-License-Identifier: AGPL-3.0-only
// New systems end to end: backends + fallback, governor, undo, touch build confirm,
// tutorial release, rematch, objective HUD, kill feed.
const pw = require('../tools/pw.cjs');
const assert = require('assert');
process.env.PORT = process.env.PORT || '8130'; process.env.QUIET = '1';
const server = require('../server/server.js');
const URL0 = `http://localhost:${process.env.PORT}/?nosw=1`;
const GPU = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
(async () => {
  const b = await pw.launch({ args: process.env.NOGPU ? [] : GPU });
  const errs = [];
  const page = async (vp, touch) => { const p = await (await b.newContext({ viewport: vp, hasTouch: !!touch, isMobile: !!touch })).newPage(); p.on('pageerror', e => errs.push(e.message + '\n' + e.stack)); return p; };
  const ok = (n, c) => { assert(c, n); console.log('ok  ', n); };
  const p = await page({ width: 1280, height: 800 });
  await p.goto(URL0 + '&quick=1&size=s'); await p.waitForTimeout(1200);
  const kind = await p.evaluate(() => E.game.renderer.kind);
  ok('game uses a GPU backend (' + kind + ')', kind === 'webgl2' || process.env.NOGPU);
  // governor: persistent misses drop one tier
  const tiers = await p.evaluate(() => { const g = E.game, gv = g.governor, t0 = gv.current(); E.Settings.quality = 'auto'; for (let i = 0; i < 130; i++) gv.sample(40, 5, 1 / 30); return [t0, gv.current()]; });
  ok(`governor drops a tier on missed frames (${tiers[0]} → ${tiers[1]})`, tiers[0] !== tiers[1] || tiers[0] === 'low');
  // undo restores the previous order
  const u1 = await p.evaluate(() => { const g = E.game, u = g.world.s.units.find(u => u.o === g.local && u.d === 'warden'); g.select([u.id]); g.order({ c: 'move', ids: [u.id], x: u.x + 300, y: u.y }); for (let i = 0; i < 3; i++) g.world.step(); const t1 = u.order.t; g.doUndo(); for (let i = 0; i < 3; i++) g.world.step(); return [t1, u.order.t]; });
  ok(`undo restores order (${u1[0]} → ${u1[1]})`, u1[0] === 'move' && u1[1] !== 'move');
  // queued waypoints via queue mode
  const q = await p.evaluate(() => { const g = E.game, u = g.world.s.units.find(u => u.o === g.local && u.d === 'warden'); g.order({ c: 'move', ids: [u.id], x: u.x + 200, y: u.y }); g.order({ c: 'move', ids: [u.id], x: u.x, y: u.y + 200 }, true); g.world.step(); return u.q.length; });
  ok('shift/queue adds a waypoint', q === 1);
  // objective HUD + kill feed
  await p.evaluate(() => { E.game.world.s.cfg.map.mode = 'tide'; E.game.updateObjective(); E.game.feed('test entry', 'good'); });
  ok('objective chip shows in tide mode', await p.isVisible('#h-obj'));
  ok('kill feed renders', (await p.textContent('#killfeed')).includes('test entry'));
  // rematch starts a fresh world
  const rm = await p.evaluate(() => { const g = E.game, w0 = g.world; g.world.s.over = true; g.onOver(); document.getElementById('end-rematch').click(); return g.world !== w0 && !g.world.s.over && g.world.s.t === 0; });
  ok('rematch starts a new match', rm);
  // tutorial: rival passive until released
  await p.goto(URL0); await p.waitForTimeout(500); await p.click('#m-tutorial'); await p.waitForTimeout(600);
  const tut = await p.evaluate(() => { const g = E.game, w = g.world, bot = w.s.players[1]; for (let i = 0; i < 30 * 400; i++) w.step(); const passive = !w.s.units.some(u => u.o === 1 && Math.hypot(u.x - w.s.players[0].start.x, u.y - w.s.players[0].start.y) < 500); g.unleashTutor(); return { persona: bot.persona, passive, unleashed: !!bot.ai.unleash }; });
  ok(`tutorial rival stays passive, then unleashes (${JSON.stringify(tut)})`, tut.persona === 'tutor' && tut.passive && tut.unleashed);
  // touch: build needs Confirm, nothing is spent on the first tap
  const m = await page({ width: 390, height: 844 }, true);
  await m.goto(URL0 + '&quick=1&size=s'); await m.waitForTimeout(1200);
  const tb = await m.evaluate(() => {
    const g = E.game, w = g.world, me = g.me(); me.lumen = 1000; g.isTouch = true;
    const n = w.s.structs.find(b => b.o === g.local); let pt = null;
    for (let a = 0; a < 6.28 && !pt; a += 0.3) { const x = n.x + Math.cos(a) * 420, y = n.y + Math.sin(a) * 420; if (w.canPlace(g.local, 'bud', x, y)) pt = { x, y }; }
    g.setMode({ k: 'build', kind: 'bud' }); g.execMode(pt); w.step();
    const before = me.lumen, pendingShown = !document.getElementById('hint-ok').hidden;
    document.getElementById('hint-ok').click(); w.step();
    return { pendingShown, spentBefore: 1000 - before, spentAfter: 1000 - me.lumen };
  });
  ok(`touch build asks to confirm (${JSON.stringify(tb)})`, tb.pendingShown && tb.spentBefore < 5 && tb.spentAfter >= 145);
  // Canvas2D fallback still plays
  const c = await page({ width: 1024, height: 700 });
  await c.goto(URL0); await c.evaluate(() => { E.Settings.backend = 'canvas2d'; E.saveSettings(); });
  await c.goto(URL0 + '&quick=1&size=s'); await c.waitForTimeout(1200);
  const ck = await c.evaluate(() => { const g = E.game; for (let i = 0; i < 90; i++) g.world.step(); return g.renderer.kind; });
  ok('Canvas2D fallback runs a match', ck === 'canvas2d');
  await c.evaluate(() => { E.Settings.backend = 'auto'; E.saveSettings(); });
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await b.close(); server.close(); process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
