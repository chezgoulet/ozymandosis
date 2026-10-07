// SPDX-License-Identifier: AGPL-3.0-only
// Desktop LAN host: the signaling endpoint from server/signal.cjs on an ephemeral
// port, advertised over mDNS as _ozymandosis._tcp, plus discovery of other hosts.
// Desktop operating systems have no local-network permission; the OS firewall may
// ask once when the port opens. No address is ever logged (D16).
'use strict';
const http = require('http'), os = require('os'), path = require('path');
const { Bonjour } = require('bonjour-service');
// packaged: copied next to this file by `npm run web`; in development: the repo copy
const signalPath = [path.join(__dirname, 'lan', 'signal.cjs'), path.join(__dirname, '..', '..', 'server', 'signal.cjs')].find(p => { try { require.resolve(p); return true; } catch (e) { return false; } });
const { createSignal } = require(signalPath);

let bonjour = null, host = null;
const TYPE = 'ozymandosis'; // _ozymandosis._tcp
const addrs = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
const mdns = () => bonjour || (bonjour = new Bonjour());

async function startHost({ name }) {
  if (host) await stopHost();
  const signal = createSignal();
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  server.on('upgrade', (req, socket) => signal.upgrade(req, socket));
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '0.0.0.0', res); });
  const port = server.address().port;
  const ad = mdns().publish({ name: `${String(name || 'Ozymandosis').slice(0, 40)} (${os.hostname().split('.')[0].slice(0, 20)})`, type: TYPE, port, txt: { v: '1' } });
  host = { server, signal, ad, port };
  return { port, addrs: addrs() };
}
async function stopHost() {
  const h = host; host = null; if (!h) return;
  try { h.ad.stop && h.ad.stop(); } catch (e) { /* */ }
  h.signal.close(); await new Promise(res => h.server.close(() => res()));
}
function discover({ timeoutMs }) {
  return new Promise(res => {
    const seen = new Map();
    const b = mdns().find({ type: TYPE }, s => seen.set(s.fqdn || s.name, { name: s.name, port: s.port, addrs: (s.addresses || []).filter(a => /^\d+\.\d+\.\d+\.\d+$/.test(a)) }));
    setTimeout(() => { b.stop(); res({ picker: false, services: [...seen.values()].filter(s => !host || s.port !== host.port || !s.addrs.some(a => addrs().includes(a))) }); }, Math.min(10000, timeoutMs || 3000));
  });
}
async function shutdown() { await stopHost(); if (bonjour) { bonjour.destroy(); bonjour = null; } }

module.exports = { startHost, stopHost, discover, shutdown };
