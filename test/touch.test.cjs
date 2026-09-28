// Touch gestures + reload/continue on a phone viewport.
const pw = require('../tools/pw.cjs');
const path = require('path'); const assert = require('assert');
process.env.PORT = process.env.PORT || '8095'; process.env.QUIET = '1';
const server = require('../server/server.js');
const URL0 = `http://localhost:${process.env.PORT}/`;
const OUT = path.join(__dirname, 'shots');
(async () => {
  const b = await pw.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message + '\n' + e.stack));
  const cdp = await ctx.newCDPSession(p);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i })) });
  const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await p.waitForTimeout(40); await touch('touchEnd', []); await p.waitForTimeout(120); };
  await p.goto(URL0 + '?quick=1&size=s'); await p.waitForTimeout(1200);
  const w2s = (x, y) => p.evaluate(([x, y]) => { const r = E.game.renderer.w2s(x, y); return [r.x, r.y]; }, [x, y]);
  // tap a unit to select it
  // hold the simulation still so the creature is where we tap
  const u = await p.evaluate(() => { const g = E.game; g.paused = true; const u = g.world.s.units.find(u => u.o === g.local && u.d === 'warden'); g.jump(u.x, u.y); return { id: u.id }; });
  await p.waitForTimeout(200);
  let pos = await p.evaluate(id => { const u = E.game.world.byId.get(id); const r = E.game.renderer.w2s(u.x, u.y); return [r.x, r.y]; }, u.id);
  await tap(pos[0], pos[1]);
  let sel = await p.evaluate(() => [...E.game.selection]);
  console.log('tap-select', sel); assert(sel.includes(u.id), 'tap selects unit');
  await p.evaluate(() => { E.game.paused = false; });
  // tap ground to command (attack-move)
  await p.evaluate(() => { window._cmds = []; const w = E.game.world, orig = w.command.bind(w); w.command = (pi, c) => { window._cmds.push(c); orig(pi, c); }; });
  await tap(200, 300);
  console.log('cmds', JSON.stringify(await p.evaluate(() => window._cmds)), 'sel', await p.evaluate(() => [...E.game.selection]), 'touch', await p.evaluate(() => E.game.isTouch));
  const order = await p.evaluate(id => E.game.world.byId.get(id).order.t, u.id);
  await p.waitForTimeout(150);
  const order2 = await p.evaluate(id => E.game.world.byId.get(id).order.t, u.id);
  console.log('order after tap', order, order2); assert(['amove', 'idle'].includes(order2));
  // drag pans the camera
  const c0 = await p.evaluate(() => ({ ...E.game.renderer.cam }));
  await touch('touchStart', [[200, 400]]); for (let i = 1; i <= 8; i++) { await touch('touchMove', [[200 - i * 15, 400 - i * 10]]); await p.waitForTimeout(16); } await touch('touchEnd', []);
  const c1 = await p.evaluate(() => ({ ...E.game.renderer.cam }));
  console.log('pan', Math.round(c1.x - c0.x), Math.round(c1.y - c0.y)); assert(c1.x > c0.x + 30, 'pan');
  // pinch zoom out
  await touch('touchStart', [[150, 400], [250, 400]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[150 + i * 5, 400], [250 - i * 5, 400]]); await p.waitForTimeout(16); }
  await touch('touchEnd', []);
  const c2 = await p.evaluate(() => E.game.renderer.cam.z);
  console.log('pinch z', c1.z.toFixed(2), '->', c2.toFixed(2)); assert(c2 < c1.z, 'pinch zooms out');
  // long-press box select around home
  await p.evaluate(() => E.game.goHome()); await p.evaluate(() => { E.game.selection.clear(); });
  await touch('touchStart', [[40, 200]]); await p.waitForTimeout(500);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[40 + i * 30, 200 + i * 40]]); await p.waitForTimeout(16); }
  await touch('touchEnd', []); await p.waitForTimeout(100);
  sel = await p.evaluate(() => E.game.selection.size);
  console.log('box-selected', sel); assert(sel >= 1, 'long-press box select');
  // research via the Evolve overlay, then build via sheet
  await p.tap('#f-tech'); await p.waitForTimeout(300);
  await p.tap('#tech-body .tier.can'); await p.waitForTimeout(200);
  await p.tap('#ov-tech [data-close]');
  const rq = await p.evaluate(() => E.game.world.s.pending.length + E.game.me().research.length);
  console.log('research queued', rq); assert(rq >= 1);
  await p.tap('#f-idle').catch(() => {}); 
  await p.evaluate(() => { const g = E.game; g.select(g.world.s.units.filter(u => u.o === g.local).slice(0, 1).map(u => u.id)); });
  await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/t-01-selected.png' });
  // reload → Continue
  await p.evaluate(() => { for (let i = 0; i < 30 * 30; i++) E.game.world.step(); E.game.autosave(); });
  const tBefore = await p.evaluate(() => E.game.world.s.t);
  await p.goto(URL0); await p.waitForTimeout(800);
  const cont = await p.isVisible('#m-continue'); assert(cont, 'continue visible after reload');
  await p.tap('#m-continue'); await p.waitForTimeout(800);
  const tAfter = await p.evaluate(() => E.game.world.s.t);
  console.log('continue', tBefore.toFixed(1), '->', tAfter.toFixed(1)); assert(Math.abs(tAfter - tBefore) < 3);
  await p.screenshot({ path: OUT + '/t-02-continued.png' });
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await b.close(); server.close(); process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
