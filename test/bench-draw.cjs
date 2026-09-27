const { chromium } = require(process.env.PW || '/home/c/git/chezgoulet/veil/client/node_modules/playwright-core');
process.env.PORT = '8097'; process.env.QUIET = '1';
const server = require('../server/server.js');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  await p.goto('http://localhost:8097/'); await p.waitForTimeout(600);
  const r = await p.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 800; document.body.appendChild(cv);
    const ctx = cv.getContext('2d'); const out = {};
    const cult = E.CULTURE_LIST[0], pal = E.palette(cult, 0.4, 0, 100, false);
    for (const ch of E.CHASSIS_LIST) {
      const design = { chassis: ch.id, organs: E.ORGAN_LIST.filter((o, i) => i % 7 === E.CHASSIS_LIST.indexOf(ch)).map(o => o.id).slice(0, ch.slots) };
      const vs = []; for (let i = 0; i < 100; i++) { const v = E.makeVis(100 + (i % 10) * 100, 80 + Math.floor(i / 10) * 70, 0, ch.bodyLen, i); vs.push(v); }
      for (const lowq of [false, true]) {
        E.LOWQ = lowq;
        const t0 = performance.now();
        for (let f = 0; f < 5; f++) { ctx.clearRect(0, 0, 1200, 800); for (let i = 0; i < 100; i++) { const v = vs[i]; const x = 100 + (i % 10) * 100, y = 80 + Math.floor(i / 10) * 70; const pts = E.buildPts(v, x, y, f * 0.1, 1); E.drawCreature(ctx, v, pts, { design, tier: {}, hc: cult.colors[0], pal, t: f * 0.1, alpha: 0.9, lod: 0, size: 1 }); } }
        out[ch.id + (lowq ? '-low' : '')] = ((performance.now() - t0) / 500).toFixed(3);
      }
    }
    return out;
  });
  console.log(JSON.stringify(r)); await b.close(); server.close(); process.exit(0);
})();
