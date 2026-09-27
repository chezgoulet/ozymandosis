// Browser smoke test: boots the server, drives menus and a match, screenshots.
const { chromium } = require(process.env.PW || '/home/c/git/chezgoulet/veil/client/node_modules/playwright-core');
const path = require('path');
process.env.PORT = process.env.PORT || '8093'; process.env.QUIET = '1';
const server = require('../server/server.js');
const URL0 = `http://localhost:${process.env.PORT}/`;
const OUT = path.join(__dirname, 'shots');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome' });
  const errs = [];
  const mk = async (vp, touch) => {
    const ctx = await b.newContext({ viewport: vp, hasTouch: !!touch, isMobile: !!touch, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`[${vp.width}] PAGEERR ${e.message}\n${e.stack}`));
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errs.push(`[${vp.width}] CONSOLE ${m.text()}`); });
    return p;
  };
  const p = await mk({ width: 1440, height: 900 });
  await p.goto(URL0); await p.waitForTimeout(800);
  await p.screenshot({ path: OUT + '/01-menu.png' });
  await p.click('#m-skirmish'); await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/02-setup.png' });
  await p.click('#slot-add'); await p.click('#setup-start');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + '/03-game-start.png' });
  // fast forward the sim
  await p.evaluate(() => { const g = E.game; for (let i = 0; i < 30 * 150; i++) { g.world.step(); g.handleEvents(g.world.drainEvents()); } });
  await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/04-game-2m30.png' });
  // select home, open tech, forge
  await p.keyboard.press('Space'); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/05-nucleus-selected.png' });
  await p.keyboard.press('t'); await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/06-tech.png' });
  await p.click('#tech-tabs button:nth-child(3)'); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/07-tech-powers.png' });
  await p.keyboard.press('Escape'); await p.keyboard.press('g'); await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/08-forge.png' });
  await p.keyboard.press('Escape');
  // box select army with F2 and zoom out
  await p.keyboard.press('F2'); await p.waitForTimeout(200);
  await p.mouse.move(720, 450); for (let i = 0; i < 6; i++) await p.mouse.wheel(0, 400);
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/09-zoomed-out.png' });
  // save / load round trip
  const saved = await p.evaluate(() => { E.Saves.write('s1', E.game.world, { local: E.game.local, name: 'Test save' }); return E.Saves.list().length; });
  await p.evaluate(() => { for (let i = 0; i < 30 * 600; i++) { E.game.world.step(); E.game.handleEvents(E.game.world.drainEvents()); if (E.game.world.s.over) break; } });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: OUT + '/10-late.png' });
  const info = await p.evaluate(() => ({ t: E.game.world.s.t, over: E.game.world.s.over, units: E.game.world.s.units.length }));
  console.log('late', JSON.stringify(info), 'saves', saved);
  // mobile portrait
  const m = await mk({ width: 390, height: 844 }, true);
  await m.goto(URL0 + '?quick=1&size=s'); await m.waitForTimeout(1500);
  await m.evaluate(() => { const g = E.game; for (let i = 0; i < 30 * 90; i++) { g.world.step(); g.handleEvents(g.world.drainEvents()); } });
  await m.waitForTimeout(500);
  await m.screenshot({ path: OUT + '/11-mobile.png' });
  await m.tap('#f-home'); await m.waitForTimeout(400);
  await m.screenshot({ path: OUT + '/12-mobile-nucleus.png' });
  const ml = await mk({ width: 844, height: 390 }, true);
  await ml.goto(URL0 + '?quick=1&size=s'); await ml.waitForTimeout(1500);
  await ml.tap('#f-home'); await ml.waitForTimeout(400);
  await ml.screenshot({ path: OUT + '/13-mobile-landscape.png' });
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await b.close(); server.close(); process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
