const pw = require('../tools/pw.cjs');
process.env.PORT = '8096'; process.env.QUIET = '1';
const server = require('../server/server.js');
(async () => {
  const b = await pw.launch({ args: ['--use-gl=swiftshader', '--enable-gpu-rasterization'] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8096/?quick=1&size=l&n=6'); await p.waitForTimeout(1000);
  const r = await p.evaluate(() => {
    const g = E.game, w = g.world;
    w.s.players[g.local].kind = 'bot'; // let a bot play our side too
    const t0 = performance.now(); let steps = 0;
    while (w.s.t < 600 && !w.s.over) { w.step(); w.drainEvents(); steps++; }
    const simMs = (performance.now() - t0) / steps;
    const res = { t: Math.round(w.s.t), units: w.s.units.length, structs: w.s.structs.length, simMs: simMs.toFixed(2) };
    const R = g.renderer; R.local = -1; R.cam.z = 0.3; R.cam.x = w.s.map.w / 2; R.cam.y = w.s.map.h / 2;
    for (const lvl of [0.3, 0.7, 1.2]) {
      R.cam.z = lvl;
      // center on the densest cluster
      let best = null, bn = 0; for (const u of w.s.units) { let n = 0; for (const v of w.s.units) if (Math.abs(u.x - v.x) < 400 && Math.abs(u.y - v.y) < 300) n++; if (n > bn) { bn = n; best = u; } }
      if (best && lvl > 0.3) { R.cam.x = best.x; R.cam.y = best.y; }
      const ui = { selection: new Set(), pings: [] };
      for (let i = 0; i < 10; i++) R.frame(w, 1, w.s.t + i / 60, 1 / 60, ui);
      const f0 = performance.now(); for (let i = 0; i < 60; i++) R.frame(w, 1, w.s.t + i / 60, 1 / 60, ui);
      res['frameMs@' + lvl] = ((performance.now() - f0) / 60).toFixed(2);
    }
    const prof = {};
    for (const k of ['drawCurrents', 'drawPools', 'drawVents', 'drawClouds', 'drawStruct', 'drawUnits', 'drawShots', 'drawFx', 'drawFog', 'drawOverlays', 'updateVision']) {
      const orig = R[k].bind(R); prof[k] = 0; R[k] = (...a) => { const t = performance.now(); const r = orig(...a); prof[k] += performance.now() - t; return r; };
    }
    const ui = { selection: new Set(), pings: [] };
    R.cam.z = 1.2; const f0 = performance.now(); for (let i = 0; i < 60; i++) R.frame(w, 1, w.s.t + i / 60, 1 / 60, ui);
    const tot = (performance.now() - f0) / 60;
    for (const k in prof) prof[k] = (prof[k] / 60).toFixed(2);
    res.prof = prof; res.tot = tot.toFixed(2);
    return res;
  });
  console.log(JSON.stringify(r)); console.log(errs.join('\n') || 'no errors');
  await p.screenshot({ path: __dirname + '/shots/perf.png' });
  await b.close(); server.close(); process.exit(0);
})();
