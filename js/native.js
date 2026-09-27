// Native shell integration (Capacitor on iOS/Android). No-op on the web.
// Same codebase: the web build and the app load identical files; this module
// only adds status-bar/notch handling, orientation lock, haptics and the
// Android back button when running inside the native container.
(function (E) {
  'use strict';
  const Cap = window.Capacitor;
  E.Native = { is: !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform()), platform: Cap && Cap.getPlatform ? Cap.getPlatform() : 'web' };
  // Desktop: play fullscreen. Browsers only grant fullscreen from a user gesture,
  // so the first click or key press after launch enters it (installed PWAs start
  // in fullscreen display mode already). Alt+Enter / F11 toggles.
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  E.isDesktop = () => !E.Native.is && matchMedia('(pointer: fine)').matches && matchMedia('(min-width: 900px)').matches;
  E.enterFullscreen = () => {
    const d = document.documentElement, req = d.requestFullscreen || d.webkitRequestFullscreen;
    if (fsEl() || !req) return Promise.resolve();
    try { return Promise.resolve(req.call(d, { navigationUI: 'hide' })).catch(() => {}); } catch (e) { return Promise.resolve(); }
  };
  E.toggleFullscreen = () => { if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document); else E.enterFullscreen(); };
  if (E.isDesktop() && E.Settings.fullscreen !== false && !/[?&](nofs|bench|quick)/.test(location.search) && !navigator.webdriver) {
    const go = e => { if (e.type === 'keydown' && (e.key === 'F11' || (e.altKey && e.key === 'Enter'))) return; E.enterFullscreen(); off(); };
    const off = () => { removeEventListener('pointerdown', go, true); removeEventListener('keydown', go, true); };
    addEventListener('pointerdown', go, true); addEventListener('keydown', go, true);
  }
  if (!E.Native.is) return;
  const P = Cap.Plugins || {};
  document.documentElement.classList.add('native', 'native-' + E.Native.platform);
  // draw under the status bar / notch; CSS uses env(safe-area-inset-*) for padding
  // iOS: draw under the notch and pad with env(safe-area-inset-*) (WKWebView reports real insets).
  // Android: WebView reports a 0 top inset while overlaid, so the status bar gets its own dark band.
  if (P.StatusBar) {
    const ios = E.Native.platform === 'ios';
    P.StatusBar.setOverlaysWebView({ overlay: ios }).catch(() => {});
    P.StatusBar.setStyle({ style: 'DARK' }).catch(() => {});
    if (!ios) P.StatusBar.setBackgroundColor({ color: '#02070a' }).catch(() => {});
  }
  E.Native.lock = o => { if (P.ScreenOrientation) (o === 'auto' ? P.ScreenOrientation.unlock() : P.ScreenOrientation.lock({ orientation: o })).catch(() => {}); };
  E.Native.lock(E.Settings.orientation || 'auto');
  // haptics through the native engine (navigator.vibrate is a no-op on iOS)
  if (P.Haptics) E.haptic = ms => { if (E.Settings.haptics) P.Haptics.impact({ style: ms > 10 ? 'MEDIUM' : 'LIGHT' }).catch(() => {}); };
  // Android back: close overlays → cancel mode → pause → menu back
  if (P.App) P.App.addListener('backButton', () => {
    const g = E.game;
    if (g && g.running && !document.getElementById('game').hidden) {
      const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }); window.dispatchEvent(esc);
    } else if (E.Screens.stack.length > 1) E.Screens.back();
    else P.App.minimizeApp && P.App.minimizeApp();
  });
  // pause and save when the app is backgrounded
  if (P.App) P.App.addListener('appStateChange', s => { if (!s.isActive && E.game) { E.game.autosave(); if (E.game.running && E.game.netMode === 'local' && !E.game.paused) E.game.openPause(); } });
})(window.E);
