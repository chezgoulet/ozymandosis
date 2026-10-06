// SPDX-License-Identifier: AGPL-3.0-only
// Ozymandosis desktop shell: the same web build, full screen from launch.
// F11 or Alt+Enter toggle fullscreen (handled by the game); links to accounts,
// checkout and sign-in providers open in the system browser.
'use strict';
const { app, BrowserWindow, shell, Menu, ipcMain } = require('electron');
const path = require('path');
const lan = require('./lan.cjs');

app.commandLine.appendSwitch('enable-features', 'Vulkan,WebGPU');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Which storefront this copy came from. The desktop game is sold on Steam only
// (docs/MONETIZATION.md): a Steam build proves ownership with Steam and sells the
// season there. 'direct' is a development build, which cannot play online in production.
function store() {
  if (process.env.OZY_STORE) return process.env.OZY_STORE;
  const fs = require('fs'), dir = app.isPackaged ? path.dirname(process.execPath) : __dirname;
  if (process.env.SteamAppId || fs.existsSync(path.join(dir, 'steam_appid.txt'))) return 'steam';
  return 'direct';
}

function create() {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    fullscreen: true, backgroundColor: '#02070a', show: false, title: 'Ozymandosis',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
  win.loadFile(path.join(__dirname, 'web', 'index.html'), { query: { nosw: '1', store: store() } });
}
// Local-network play: this machine hosts and finds games itself (js/net/lan.js).
ipcMain.handle('lan:host', (_e, opts) => lan.startHost(opts || {}));
ipcMain.handle('lan:stop', () => lan.stopHost());
ipcMain.handle('lan:discover', (_e, opts) => lan.discover(opts || {}));
app.whenReady().then(create);
app.on('window-all-closed', () => { lan.shutdown().finally(() => app.quit()); });
