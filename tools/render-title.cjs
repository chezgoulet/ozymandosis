#!/usr/bin/env node
// Renders a still of the living title (transparent PNG) for places that cannot
// animate: emails and native splash screens.
//   node tools/render-title.cjs [out.png] [width] [moment-in-seconds]
'use strict';
const path = require('path');
const { chromium } = require(process.env.PW || '/home/c/git/chezgoulet/veil/client/node_modules/playwright-core');
const ROOT = path.join(__dirname, '..');
const out = process.argv[2] || path.join(ROOT, 'apps/site/public/img/ozymandosis-title.png'), W = +(process.argv[3] || 1416), moment = process.argv[4] || '6.2';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || (process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome') });
  const p = await b.newPage({ viewport: { width: W, height: Math.round(W * 120 / 708) }, deviceScaleFactor: 1 });
  await p.goto('file://' + path.join(ROOT, 'title.html') + '?still=' + moment);
  await p.waitForFunction(() => document.title === 'ready');
  await p.screenshot({ path: out, omitBackground: true });
  await b.close(); console.log('title still:', out);
})().catch(e => { console.error(e); process.exit(1); });
