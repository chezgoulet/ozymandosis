// Ozymandosis desktop shell: the same web build, full screen from launch.
// F11 or Alt+Enter toggle fullscreen (handled by the game); links to accounts,
// checkout and sign-in providers open in the system browser.
'use strict';
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('enable-features', 'Vulkan,WebGPU');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function create() {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    fullscreen: true, backgroundColor: '#02070a', show: false, title: 'Ozymandosis',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
  win.loadFile(path.join(__dirname, 'web', 'index.html'), { query: { nosw: '1' } });
}
app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
