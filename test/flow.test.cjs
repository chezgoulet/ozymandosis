// Desktop UI flow: every major panel driven through clicks.
const { chromium } = require(process.env.PW || '/home/c/git/chezgoulet/veil/client/node_modules/playwright-core');
const path = require('path'); const assert = require('assert');
process.env.PORT = process.env.PORT || '8098'; process.env.QUIET = '1';
const server = require('../server/server.js');
const URL0 = `http://localhost:${process.env.PORT}/?nosw=1`;
const OUT = path.join(__dirname, 'shots');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message + '\n' + e.stack));
  const step = async (n) => { for (let i = 0; i < n; i++) await p.evaluate(() => { const g = E.game; g.world.step(); g.handleEvents(g.world.drainEvents()); }); };
  const ff = async (sec) => p.evaluate(s => { const g = E.game; for (let i = 0; i < s * 30; i++) { g.world.step(); g.handleEvents(g.world.drainEvents()); } }, sec);
  await p.goto(URL0); await p.waitForTimeout(600);
  await p.click('#m-skirmish');
  await p.selectOption('#slots .slot-row:nth-child(2) select:nth-child(2)', 'bot:easy');
  await p.click('#map-size button:first-child');
  await p.click('#setup-start'); await p.waitForTimeout(800);
  await p.evaluate(() => { const m = E.game.me(); m.lumen = 5000; m.spore = 1000; });
  // 1. hatch via card
  await p.keyboard.press('Space'); await p.waitForTimeout(200);
  await p.click('.hcard >> nth=1'); await step(2);
  let q = await p.evaluate(() => E.game.selStruct().queue.length); console.log('queue', q); assert(q === 1);
  // 2. evolve: chassis tab → carapace, organs → pincers
  await p.keyboard.press('t'); await p.click('#tech-tabs button:nth-child(2)'); await p.waitForTimeout(200);
  await p.click('#tech-body .tcard:has-text("Carapace")'); await step(2);
  await p.click('#tech-tabs button:nth-child(1)'); await p.waitForTimeout(200);
  await p.click('#tech-body .tcard:has-text("Pincers")'); await step(2);
  let rs = await p.evaluate(() => E.game.me().research.map(r => r.key)); console.log('research', rs); assert(rs.length === 2);
  await p.screenshot({ path: OUT + '/f-01-tech.png' });
  await p.keyboard.press('Escape'); await ff(40);
  let have = await p.evaluate(() => [E.game.me().chassis.includes('carapace'), E.game.me().forms.includes('pincers')]); console.log('evolved', have); assert(have[0] && have[1]);
  // 3. forge a design and add it
  await p.keyboard.press('g'); await p.waitForTimeout(400);
  await p.click('#forge-game .chassis-pick button:has-text("Carapace")');
  await p.selectOption('#forge-game .oslot >> nth=0 >> select', 'pincers');
  await p.fill('#forge-game input[type=text]', 'Crab Knight');
  await p.click('#forge-game button:has-text("Add to hatchery")'); await step(2);
  const des = await p.evaluate(() => E.game.me().designs.map(d => d.name)); console.log('designs', des); assert(des.includes('Crab Knight'));
  await p.screenshot({ path: OUT + '/f-02-forge.png' });
  await p.click('#ov-forge [data-close]');
  // hatch the new design
  await p.keyboard.press('Space'); await p.waitForTimeout(200);
  await p.click('.hcard:has-text("Crab Knight")'); await ff(12);
  const crab = await p.evaluate(() => { const g = E.game; const d = g.me().designs.find(d => d.name === 'Crab Knight'); const u = g.world.s.units.find(u => u.o === g.local && u.d === d.id); return u && u.id; });
  console.log('crab id', crab); assert(crab);
  // 4. ability via sheet button (Harden from the carapace)
  await p.evaluate(id => E.game.select([id]), crab); await p.waitForTimeout(200);
  await p.click('#sh-body .cmd:has-text("Harden")'); await step(3);
  const cd = await p.evaluate(id => E.game.world.byId.get(id).cds.harden, crab); console.log('harden cd', cd); assert(cd > 0);
  // 5. build a bud: select a forager, B, choose Bud, click a free spot
  await p.evaluate(() => { const g = E.game; const f = g.world.s.units.find(u => u.o === g.local && u.d === 'forager'); g.select([f.id]); });
  await p.keyboard.press('b'); await p.waitForTimeout(150);
  await p.click('#sh-body .cmd:has-text("Bud")');
  const spot = await p.evaluate(() => { const g = E.game, w = g.world, n = w.s.structs.find(b => b.o === g.local); for (let a = 0; a < 6.28; a += 0.3) { const x = n.x + Math.cos(a) * 420, y = n.y + Math.sin(a) * 420; if (w.canPlace(g.local, 'bud', x, y)) { g.jump(x, y); const s = g.renderer.w2s(x, y); return [s.x, s.y]; } } });
  await p.waitForTimeout(100);
  await p.mouse.click(spot[0], spot[1]); await ff(45);
  const buds = await p.evaluate(() => E.game.world.s.structs.filter(b => b.o === E.game.local && b.kind === 'bud').length); console.log('buds', buds); assert(buds === 1);
  // 6. colony power button
  await p.evaluate(() => E.game.world.complete(E.game.me(), 'power:frenzy'));
  await p.keyboard.press('Escape'); await p.evaluate(() => { E.game.selection.clear(); E.game.sheetSig = ''; E.game.renderSheet(); });
  await p.click('#sh-body .cmd:has-text("Frenzy")'); await step(2);
  const fever = await p.evaluate(() => E.game.me().fever); console.log('fever', fever.toFixed(2)); assert(fever > 0.25);
  await p.screenshot({ path: OUT + '/f-03-colony.png' });
  // 7. save through the pause menu, quit, load
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.click('#p-save'); await p.fill('.modal input', 'Flow save'); await p.click('.modal .btn.primary');
  await p.waitForTimeout(200); await p.click('.modal .btn:not(.primary)');
  await p.click('#p-quit'); await p.click('.modal .btn.primary'); await p.waitForTimeout(300);
  await p.click('#m-load'); await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/f-04-load.png' });
  await p.click('.save-item:has-text("Flow save") .btn.primary'); await p.waitForTimeout(600);
  const back = await p.evaluate(() => ({ designs: E.game.me().designs.map(d => d.name), buds: E.game.world.s.structs.filter(b => b.kind === 'bud').length }));
  console.log('loaded', JSON.stringify(back)); assert(back.designs.includes('Crab Knight') && back.buds >= 1);
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await b.close(); server.close(); process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
