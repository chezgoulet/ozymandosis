// Local-network play (docs/MONETIZATION.md, "The LAN boundary"; D19). Two devices
// on one network find each other and play directly: no relay, no account, and no
// call to the service. This is a base-game feature, outside the purchase and the
// subscription both, so nothing here may touch E.Online.
//
// The hosting device runs the signaling endpoint itself (server/signal.cjs has the
// protocol) and advertises it as _ozymandosis._tcp:
//   • Android: LanPlugin (NsdManager). Hosting needs ACCESS_LOCAL_NETWORK from API 37
//     (NEARBY_WIFI_DEVICES on 33–36); joining uses the system picker, which needs no
//     broad permission and whose grant persists.
//   • iOS: LanPlugin (Network.framework, Bonjour); the plist carries NSBonjourServices
//     and NSLocalNetworkUsageDescription.
//   • Desktop: the Electron shell's main process (window.ozyLan); no permission model.
// Discovery is the convenience; the join code is the guarantee. Guest, hotel and
// office networks often isolate clients, and a person may refuse the permission,
// so every host shows a code (its address and port) that joins with no discovery.
(function (E) {
  'use strict';
  const SERVICE = '_ozymandosis._tcp';
  // Join codes: IPv4 + port, 48 bits in ten Crockford base-32 characters.
  // Same scheme as server/signal.cjs (test/content.test.cjs holds them together).
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function encode(ip, port) {
    const o = String(ip).split('.').map(Number);
    if (o.length !== 4 || o.some(x => !(x >= 0 && x <= 255)) || !(port > 0 && port < 65536)) return null;
    // 48 bits do not fit a 32-bit integer: split into the address (32) and the port (16)
    let hi = ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3], lo = port, s = '';
    for (let i = 0; i < 10; i++) { s = B32[lo & 31] + s; lo = (lo >>> 5) | ((hi & 31) << 11); hi = Math.floor(hi / 32); }
    return s.slice(0, 5) + '-' + s.slice(5);
  }
  function decode(code) {
    const s = String(code || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(s)) return null;
    let hi = 0, lo = 0;
    for (const ch of s) { const v = B32.indexOf(ch); hi = hi * 32 + (lo >>> 11); lo = ((lo << 5) & 0xffff) | v; }
    const port = lo, ip = [(hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255].join('.');
    return port ? { ip, port } : null;
  }
  const isPrivate = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(ip);
  const pickAddr = addrs => (addrs || []).find(a => /^192\.168\./.test(a)) || (addrs || []).find(isPrivate) || (addrs || []).find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || null;
  const wsUrl = (host, port) => `ws://${host.includes(':') ? '[' + host + ']' : host}:${port}/ws`;

  function backend() {
    const P = window.Capacitor && Capacitor.Plugins;
    if (E.Native && E.Native.is && P && P.LanPlugin) return { kind: E.Native.platform, api: P.LanPlugin };
    if (window.ozyLan) return { kind: 'desktop', api: window.ozyLan };
    return null;
  }

  const L = E.Lan = {
    SERVICE, encode, decode, isPrivate, wsUrl,
    hosting: null,
    // Can this device host a LAN game by itself (without node server/server.js)?
    available: () => !!backend(),
    kind: () => { const b = backend(); return b ? b.kind : null; },
    // Start the in-app signaling endpoint and advertise it. Resolves to
    // { url (for this device), code (for everyone else), addrs, port } or throws
    // an Error with code 'denied' | 'unavailable' | 'failed' and a message for the player.
    async host(name) {
      const b = backend();
      if (!b) { const e = new Error('This version cannot host by itself. Run node server/server.js on a computer, or use the app.'); e.code = 'unavailable'; throw e; }
      let r;
      try { r = await b.api.startHost({ name: String(name || 'Ozymandosis').slice(0, 40), service: SERVICE }); }
      catch (x) { const e = new Error(L.explain(x)); e.code = /denied|permission/i.test(String(x && (x.code || x.message))) ? 'denied' : 'failed'; throw e; }
      const addr = pickAddr(r.addrs);
      L.hosting = { port: r.port, addrs: r.addrs || [], code: addr ? encode(addr, r.port) : null, url: wsUrl('127.0.0.1', r.port) };
      return L.hosting;
    },
    async stopHost() { const b = backend(); L.hosting = null; if (b) try { await b.api.stopHost(); } catch (e) { /* already stopped */ } },
    // Find a host. On Android 37+ the system picker chooses one ({ name, url } or
    // null if the player cancelled); elsewhere this lists what answers within ms.
    async find(ms) {
      const b = backend(); if (!b) return { picker: false, found: [] };
      let r;
      try { r = await b.api.discover({ service: SERVICE, timeoutMs: ms || 3000 }); }
      catch (x) { const e = new Error(L.explain(x)); e.code = /denied|permission/i.test(String(x && (x.code || x.message))) ? 'denied' : 'failed'; throw e; }
      const found = (r.services || []).map(s => { const a = pickAddr(s.addrs) || (s.addrs || [])[0]; return a ? { name: s.name, url: wsUrl(a, s.port) } : null; }).filter(Boolean);
      return { picker: !!r.picker, cancelled: !!r.cancelled, found };
    },
    // Joining by code reaches an address no picker approved, so on Android 17+ it
    // needs the same permission as hosting. Resolves true when allowed.
    async access() {
      const b = backend(); if (!b || !b.api.access) return true;
      try { return !!(await b.api.access()).granted; } catch (e) { return false; }
    },
    // After a refusal: offer the system settings, where the permission can be allowed.
    async denied(msg) {
      const b = backend(), can = !!(b && b.api.openSettings);
      const v = await E.modal('Local network', msg || L.explain({ code: 'denied' }), can ? [{ label: 'Not now', value: false }, { label: 'Open settings', value: true, primary: true }] : undefined);
      if (v && can) b.api.openSettings().catch(() => {});
    },
    // What a person typed into "join": a join code, host:port, or a ws:// URL.
    target(raw) {
      const s = String(raw || '').trim(); if (!s) return null;
      const d = decode(s); if (d) return { url: wsUrl(d.ip, d.port), room: '*' };
      if (/^wss?:\/\//i.test(s) || /^[\w.-]+:\d+$/.test(s) || /^\[[0-9a-f:]+\]:\d+$/i.test(s)) return { url: E.Relay.fromInput(s), room: '*' };
      return null;
    },
    explain(x) {
      const c = String((x && (x.code || x.message)) || x || '');
      if (/denied|permission/i.test(c)) return 'Ozymandosis needs permission to find and connect to devices on your local network. You can allow it in the system settings, or join with a code instead.';
      if (/wifi|network/i.test(c)) return 'Connect to a Wi-Fi network first.';
      return (x && x.message) || 'Local play is not available right now.';
    },
  };
})(window.E);
