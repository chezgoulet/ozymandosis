#!/usr/bin/env node
// Renders icon.svg into every native/PWA icon and splash size (Chromium via playwright-core).
//   node tools/make-icons.cjs
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PW || '/home/c/git/chezgoulet/veil/client/node_modules/playwright-core');
const ROOT = path.join(__dirname, '..'), svg = fs.readFileSync(path.join(ROOT, 'icon.svg'), 'utf8');
const RES = path.join(ROOT, 'android/app/src/main/res');
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || (process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome') });
  const p = await b.newPage();
  const render = async (file, w, h, opts) => {
    opts = opts || {};
    const inner = opts.logo ? `<div style="position:absolute;left:50%;top:50%;width:${opts.logo}px;height:${opts.logo}px;transform:translate(-50%,-50%)">${svg.replace('<svg', '<svg width="100%" height="100%"')}</div>
      <div style="position:absolute;left:0;right:0;top:calc(50% + ${opts.logo * 0.62}px);text-align:center;font:italic 200 ${Math.round(opts.logo * 0.28)}px Georgia,serif;color:#9ff6e4;letter-spacing:-.02em">Efflorescent</div>`
      : `<div style="position:absolute;inset:${opts.pad || 0}px">${svg.replace('<svg', '<svg width="100%" height="100%"')}</div>`;
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(`<html><body style="margin:0;background:${opts.bg || 'transparent'};width:${w}px;height:${h}px;position:relative;overflow:hidden">${inner}</body></html>`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await p.screenshot({ path: file, omitBackground: !opts.bg });
  };
  for (const [d, k] of Object.entries(DENS)) {
    await render(path.join(RES, `mipmap-${d}/ic_launcher.png`), 48 * k, 48 * k);
    await render(path.join(RES, `mipmap-${d}/ic_launcher_round.png`), 48 * k, 48 * k);
    await render(path.join(RES, `mipmap-${d}/ic_launcher_foreground.png`), 108 * k, 108 * k, { pad: 18 * k });
  }
  for (const f of fs.readdirSync(RES).filter(f => f.startsWith('drawable'))) {
    const sp = path.join(RES, f, 'splash.png'); if (!fs.existsSync(sp)) continue;
    const land = f.includes('land'), k = DENS[f.split('-').pop()] || 1;
    const w = Math.round((land ? 480 : 320) * k), h = Math.round((land ? 320 : 480) * k);
    await render(sp, w, h, { bg: '#02070a', logo: Math.round(Math.min(w, h) * 0.38) });
  }
  const IOS = path.join(ROOT, 'ios/App/App/Assets.xcassets');
  await render(path.join(IOS, 'AppIcon.appiconset/AppIcon-512@2x.png'), 1024, 1024, { bg: '#02070a' });
  for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) await render(path.join(IOS, 'Splash.imageset', f), 2732, 2732, { bg: '#02070a', logo: 900 });
  await render(path.join(ROOT, 'icons/icon-192.png'), 192, 192, { bg: '#02070a' });
  await render(path.join(ROOT, 'icons/icon-512.png'), 512, 512, { bg: '#02070a' });
  await render(path.join(ROOT, 'icons/maskable-512.png'), 512, 512, { bg: '#02070a', pad: 60 });
  await b.close(); console.log('icons written');
})();
