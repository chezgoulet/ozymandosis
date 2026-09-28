#!/usr/bin/env node
// Every native/PWA icon and splash, from the living title (Chromium via playwright-core):
//   the app icon is the title's O, a creature curled into a ring (cilia turned outward);
//   splash screens carry the whole living title.
//   node tools/make-icons.cjs
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const { chromium } = require(process.env.PW || '/home/c/git/chezgoulet/veil/client/node_modules/playwright-core');
const ROOT = path.join(__dirname, '..'), RES = path.join(ROOT, 'android/app/src/main/res');
const still = (file, args, env) => execFileSync(process.execPath, [path.join(__dirname, 'render-title.cjs'), file, ...args], { stdio: 'inherit', env: Object.assign({}, process.env, env || {}) });
const O_PNG = path.join(os.tmpdir(), 'ozymandosis-icon-o.png'), TITLE_PNG = path.join(os.tmpdir(), 'ozymandosis-title-splash.png');
still(O_PNG, ['1024', '6.2', 'O', '26', '1024'], { FLIP: '1' });
still(TITLE_PNG, ['1416', '6.2']);
const uri = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const O = uri(O_PNG), TITLE = uri(TITLE_PNG);
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || (process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome') });
  const p = await b.newPage();
  // opts: bg (colour or none), scale (fraction of the box the O fills), round, title (splash)
  const render = async (file, w, h, opts) => {
    opts = opts || {};
    const bg = opts.bg ? `background:${opts.bg};` : '';
    const glow = opts.bg ? `<div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 52%, rgba(56,248,200,.16), rgba(2,7,10,0) 58%)"></div>` : '';
    const inner = opts.title
      ? `${glow}<img src="${TITLE}" style="position:absolute;left:50%;top:50%;width:${Math.round(Math.min(w * 0.86, h * 0.86 * 708 / 120))}px;transform:translate(-50%,-50%)" alt="">`
      : `${glow}<img src="${O}" style="position:absolute;left:50%;top:50%;width:${Math.round(Math.min(w, h) * (opts.scale || 1.12))}px;transform:translate(-50%,-50%)" alt="">`;
    await p.setViewportSize({ width: Math.round(w), height: Math.round(h) });
    await p.setContent(`<html><body style="margin:0;background:transparent"><div style="${bg}width:${w}px;height:${h}px;position:relative;overflow:hidden;${opts.round ? 'border-radius:50%;' : ''}">${inner}</div></body></html>`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await p.waitForFunction(() => [...document.images].every(i => i.complete));
    await p.screenshot({ path: file, omitBackground: true });
  };
  const DARK = '#02070a';
  for (const [d, k] of Object.entries(DENS)) {
    await render(path.join(RES, `mipmap-${d}/ic_launcher.png`), 48 * k, 48 * k, { bg: DARK });
    await render(path.join(RES, `mipmap-${d}/ic_launcher_round.png`), 48 * k, 48 * k, { bg: DARK, round: true, scale: 1.02 });
    // adaptive icon foreground: the O inside the 66% safe zone, on transparency (the background layer is the dark colour)
    await render(path.join(RES, `mipmap-${d}/ic_launcher_foreground.png`), 108 * k, 108 * k, { scale: 0.8 });
  }
  for (const f of fs.readdirSync(RES).filter(f => f.startsWith('drawable'))) {
    const sp = path.join(RES, f, 'splash.png'); if (!fs.existsSync(sp)) continue;
    const land = f.includes('land'), k = DENS[f.split('-').pop()] || 1;
    await render(sp, Math.round((land ? 480 : 320) * k), Math.round((land ? 320 : 480) * k), { bg: DARK, title: true });
  }
  const IOS = path.join(ROOT, 'ios/App/App/Assets.xcassets');
  await render(path.join(IOS, 'AppIcon.appiconset/AppIcon-512@2x.png'), 1024, 1024, { bg: DARK });
  for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) await render(path.join(IOS, 'Splash.imageset', f), 2732, 2732, { bg: DARK, title: true });
  await render(path.join(ROOT, 'icons/icon-192.png'), 192, 192, { bg: DARK });
  await render(path.join(ROOT, 'icons/icon-512.png'), 512, 512, { bg: DARK });
  await render(path.join(ROOT, 'icons/maskable-512.png'), 512, 512, { bg: DARK, scale: 0.86 });
  await render(path.join(ROOT, 'icons/favicon-64.png'), 64, 64, { bg: DARK, scale: 1.2 });
  // icon.svg (manifest "any", favicons) wraps the 512 icon
  fs.writeFileSync(path.join(ROOT, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><image width="192" height="192" href="${uri(path.join(ROOT, 'icons/icon-192.png'))}"/></svg>\n`);
  // the portal serves its own copy
  fs.copyFileSync(path.join(ROOT, 'icons/icon-192.png'), path.join(ROOT, 'apps/play/public/icon-192.png'));
  await b.close(); console.log('icons written');
})();
