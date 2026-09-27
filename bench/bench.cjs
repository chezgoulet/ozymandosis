#!/usr/bin/env node
// Render benchmark. Uses the host GPU through ANGLE/Vulkan with vsync and the
// frame-rate limiter disabled, so frame intervals show real throughput.
//   node bench/bench.cjs [--backends canvas2d,webgl2] [--units 50,100,200,400,700]
//                        [--cpu] (SwiftShader, worst case) [--label name] [--check]
// --check compares against bench/budget.json and exits non-zero on regression.
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require(process.env.PW || '/home/c/git/chezgoulet/veil/client/node_modules/playwright-core');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const backends = String(arg('backends', 'canvas2d,webgl2')).split(',');
const units = String(arg('units', '50,100,200,400,700')).split(',').map(Number);
const cpuMode = !!arg('cpu', false), check = !!arg('check', false);
const label = arg('label', (cpuMode ? 'cpu' : 'gpu') + '-' + new Date().toISOString().slice(0, 10));
process.env.PORT = process.env.PORT || '8120'; process.env.QUIET = '1';
const server = require('../server/server.js');
(async () => {
  const args = ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'];
  if (!cpuMode) args.push('--use-angle=vulkan', '--enable-features=Vulkan');
  const b = await chromium.launch({ executablePath: process.env.CHROME || (process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'), headless: true, args });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${process.env.PORT}/?nosw=1&bench=1`);
  await p.waitForFunction(() => window.E && E.Bench && E.createRenderer);
  const gpu = await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); if (!c) return 'none'; const e = c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  const rows = [];
  for (const be of backends) for (const n of units) {
    const r = await p.evaluate(o => E.Bench.run(o), { backend: be, units: n, frames: 240, warm: 60 });
    rows.push(r);
    console.log(`${r.backend.padEnd(9)} ${String(n).padStart(4)}u  frame avg ${String(r.frame.avg).padStart(6)} ms  p95 ${String(r.frame.p95).padStart(6)}  fps ${String(r.fps).padStart(6)}   js-render ${String(r.cpu.avg).padStart(6)} ms`);
  }
  const out = { label, date: new Date().toISOString(), gpu, cpuMode, viewport: '1440x900@1x', rows };
  fs.writeFileSync(path.join(__dirname, 'results', label + '.json'), JSON.stringify(out, null, 1));
  console.log('GPU:', gpu); if (errs.length) console.log('page errors:', errs);
  let fail = false;
  if (check) {
    const budget = JSON.parse(fs.readFileSync(path.join(__dirname, 'budget.json'), 'utf8'));
    for (const r of rows) {
      const lim = budget[r.backend] && budget[r.backend][r.units]; if (!lim) continue;
      const ok = r.frame.p95 <= lim.p95 && r.cpu.avg <= lim.cpu;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${r.backend} ${r.units}u p95 ${r.frame.p95}/${lim.p95} cpu ${r.cpu.avg}/${lim.cpu}`);
      if (!ok) fail = true;
    }
  }
  await b.close(); server.close(); process.exit(fail || errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
