#!/usr/bin/env node
// Renders a still of the living title (transparent PNG) for places that cannot
// animate: emails and native splash screens.
//   node tools/render-title.cjs [out.png] [width] [moment-in-seconds] [word] [pad] [height]
'use strict';
const path = require('path');
const pw = require('./pw.cjs');
const ROOT = path.join(__dirname, '..');
const out = process.argv[2] || path.join(ROOT, 'icons/ozymandosis-title.png'), W = +(process.argv[3] || 1416), moment = process.argv[4] || '6.2';
const word = process.argv[5] || '', pad = process.argv[6] || '', Hh = +(process.argv[7] || 0);
(async () => {
  const b = await pw.launch();
  const p = await b.newPage({ viewport: { width: W, height: Hh || Math.round(W * 120 / 708) }, deviceScaleFactor: 1 });
  await p.goto('file://' + path.join(ROOT, 'title.html') + '?still=' + moment + (word ? '&word=' + word : '') + (pad ? '&pad=' + pad : '') + (process.env.FLIP ? '&flip=1' : ''));
  await p.waitForFunction(() => document.title === 'ready');
  await p.screenshot({ path: out, omitBackground: true });
  await b.close(); console.log('title still:', out);
})().catch(e => { console.error(e); process.exit(1); });
