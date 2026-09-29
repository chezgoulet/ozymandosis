// The Linux Steam build, end to end inside Steam Linux Runtime 3.0 (sniper): the
// packaged app (apps/desktop, `npm run package`) is started by apps/desktop/sniper.sh
// in the same pressure-vessel container Steam uses, and driven over the DevTools
// port. It proves, with nothing taken from the host but the display, the audio
// server and the graphics driver (which the container imports by design):
//   1. every library the build links resolves inside the runtime
//   2. a single-player match plays to its end
//   3. the match has sound: the app's own audio stream is recorded on the host
//   4. a LAN match plays to its end between two copies, each in its own container,
//      found over mDNS and connected directly
// Needs Xvfb (or OZY_DISPLAY=:0 for the real screen and GPU), a PipeWire session
// with its PulseAudio socket, and pw-cli/pw-record/pw-dump.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const assert = require('assert');
const { chromium } = require('playwright');
const DESK = path.join(__dirname, '..', 'apps', 'desktop');
const SNIPER = path.join(DESK, 'sniper.sh');
const OUT = path.join(__dirname, 'shots');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ozy-sniper-'));
const SINK = 'ozy-sniper-test';
const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
const penv = { ...process.env, XDG_RUNTIME_DIR: runtimeDir };
const pwTool = (cmd, args) => execFileSync(cmd, args, { env: penv, encoding: 'utf8' });
const cleanup = [];
const errs = [];

function xvfb() {
  if (process.env.OZY_DISPLAY) return Promise.resolve(process.env.OZY_DISPLAY);
  return new Promise((res, rej) => {
    const x = spawn('Xvfb', ['-displayfd', '1', '-screen', '0', '1600x900x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'pipe', 'ignore'] });
    cleanup.push(() => x.kill());
    x.on('error', rej);
    x.stdout.once('data', d => res(':' + String(d).trim()));
  });
}
function nullSink() {
  assert(fs.existsSync(path.join(runtimeDir, 'pulse', 'native')), `no PulseAudio socket in ${runtimeDir}: the audio check needs a PipeWire session`);
  pwTool('pw-cli', ['create-node', 'adapter', `{ factory.name=support.null-audio-sink node.name=${SINK} media.class=Audio/Sink object.linger=true audio.position=[FL FR] }`]);
  const id = String(sinkNode().id);
  cleanup.push(() => { try { pwTool('pw-cli', ['destroy', id]); } catch (e) { /* gone */ } });
}
const cdpUp = port => new Promise(res => http.get(`http://127.0.0.1:${port}/json/version`, r => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));

// one copy of the game, in its own container
async function launch(name, port, display) {
  const log = fs.openSync(path.join(TMP, name + '.log'), 'w');
  const env = { ...penv, DISPLAY: display, PULSE_SINK: SINK };
  delete env.WAYLAND_DISPLAY;
  const child = spawn(SNIPER, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(TMP, name)}`], { env, detached: true, stdio: ['ignore', log, log] });
  cleanup.push(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { /* exited */ } });
  for (let i = 0; i < 120 && !(await cdpUp(port)); i++) await new Promise(r => setTimeout(r, 500));
  assert(await cdpUp(port), `${name}: the game did not start in the container (log: ${TMP}/${name}.log)`);
  // the process that answered is the one in the container: its root is the runtime
  const pid = execFileSync('pgrep', ['-f', `remote-debugging-port=${port}`], { encoding: 'utf8' }).split('\n').map(Number)
    .find(p => { try { const a = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').split('\0'); return /\/ozymandosis$/.test(a[0]) && !a.some(x => x.startsWith('--type=')); } catch (e) { return false; } });
  const osr = fs.readFileSync(`/proc/${pid}/root/etc/os-release`, 'utf8');
  const runtime = (osr.match(/^PRETTY_NAME="(.*)"/m) || [])[1], build = (osr.match(/^BUILD_ID="(.*)"/m) || [])[1];
  assert(/sniper/.test(runtime), `${name} runs in ${runtime}, not sniper`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page;
  for (let i = 0; i < 40 && !page; i++) { page = browser.contexts().flatMap(c => c.pages()).find(p => /index\.html/.test(p.url())); if (!page) await new Promise(r => setTimeout(r, 250)); }
  assert(page, name + ': no game page');
  page.on('pageerror', e => errs.push(`[${name}] ${e.message}`));
  await page.waitForFunction(() => window.E && E.game && document.querySelector('#m-skirmish'), null, { timeout: 30000 });
  const gpu = await page.evaluate(() => { try { const g = document.createElement('canvas').getContext('webgl2'), x = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(x.UNMASKED_RENDERER_WEBGL); } catch (e) { return 'none'; } });
  console.log(`${name}: pid ${pid} in ${runtime} ${build}; WebGL2 renderer: ${gpu}`);
  return { page, browser };
}

// record the null sink the game plays into, and measure what arrived
function record(sec) {
  const file = path.join(TMP, 'audio.wav');
  const rec = spawn('pw-record', ['--target', SINK, '-P', '{ stream.capture.sink=true }', '--rate', '48000', '--channels', '2', '--format', 's16', file], { env: penv, stdio: 'ignore' });
  return new Promise(res => setTimeout(() => { rec.kill('SIGINT'); rec.on('exit', () => {
    const b = fs.readFileSync(file), d = b.indexOf('data') + 8; let peak = 0, sq = 0, n = 0;
    for (let i = d; i + 1 < b.length; i += 2) { const v = b.readInt16LE(i); peak = Math.max(peak, Math.abs(v)); sq += v * v; n++; }
    res({ seconds: n / 2 / 48000, peak, rms: Math.sqrt(sq / Math.max(1, n)) });
  }); }, sec * 1000));
}
const sinkNode = (g = JSON.parse(pwTool('pw-dump', []))) => g.find(o => o.info && o.info.props && o.info.props['node.name'] === SINK);
function streamsIntoSink() {
  const g = JSON.parse(pwTool('pw-dump', [])), byId = new Map(g.map(o => [o.id, o])), sink = sinkNode(g);
  return g.filter(o => o.type === 'PipeWire:Interface:Link' && o.info['input-node-id'] === sink.id)
    .map(l => byId.get(l.info['output-node-id'])).filter(Boolean)
    .map(n => `${n.info.props['application.name']} (${n.info.props['application.process.binary']}, ${n.info.props['media.class']})`);
}

async function singlePlayer(display) {
  const { page: p, browser } = await launch('solo', 9361, display);
  await p.click('#m-skirmish');
  await p.selectOption('#slots .slot-row:nth-child(2) select:nth-child(2)', 'bot:easy');
  await p.click('#map-size button:first-child');
  await p.click('#setup-start');
  await p.waitForSelector('#game:not([hidden])', { timeout: 15000 });
  // real time, real frames: the colony works, the bot plays, the score plays
  await p.evaluate(() => { const g = E.game, ids = g.world.s.units.filter(u => u.o === g.local).map(u => u.id); g.send({ c: 'move', ids, x: 700, y: 700 }); });
  await p.waitForTimeout(3000);
  const audio = await p.evaluate(() => ({ on: E.Audio.on, state: E.Audio.ctx && E.Audio.ctx.state, rate: E.Audio.ctx && E.Audio.ctx.sampleRate, muted: E.Settings.muted }));
  console.log('solo audio context', JSON.stringify(audio));
  assert(audio.on && audio.state === 'running' && !audio.muted, 'the audio context runs');
  const heard = await record(4);
  const streams = streamsIntoSink();
  console.log(`solo sound: ${heard.seconds.toFixed(1)} s recorded, peak ${heard.peak}, rms ${heard.rms.toFixed(1)}; streams into the sink: ${streams.join('; ') || 'none'}`);
  assert(streams.some(s => /ozymandosis/i.test(s)), 'the game opened an audio stream from the container');
  assert(heard.peak > 200, 'the game is audible (peak ' + heard.peak + ')');
  await p.screenshot({ path: OUT + '/sniper-01-solo.png' });
  const t = await p.evaluate(async () => { const g = E.game; for (let i = 0; i < 1800; i++) { g.world.step(); g.handleEvents(g.world.drainEvents()); if (i % 300 === 0) await new Promise(r => setTimeout(r, 20)); } return g.world.s.t; });
  console.log('solo match time', t.toFixed(1), 's');
  await p.evaluate(() => { const w = E.game.world; w.s.over = true; w.s.winner = w.teamOf(E.game.local); });
  await p.waitForSelector('#ov-end:not([hidden])', { timeout: 15000 });
  await p.screenshot({ path: OUT + '/sniper-02-solo-end.png' });
  console.log('solo match ended');
  await browser.close();
}

async function lanMatch(display) {
  const [host, guest] = [await launch('host', 9362, display), await launch('guest', 9363, display)];
  const H = host.page, G = guest.page;
  await H.click('#m-mp'); await H.fill('#mp-name', 'Hearth'); await H.click('#mp-host');
  await H.waitForSelector('#scr-setup:not([hidden])');
  console.log('host shows', (await H.textContent('#setup-room')).trim());
  // the guest finds the host over mDNS, from one container to another, and joins what it found
  await G.click('#m-mp'); await G.fill('#mp-name', 'Wanderer');
  assert(await G.isVisible('#mp-find'), 'find nearby is offered: the shell bridge is present');
  await G.click('#mp-find'); await G.waitForSelector('#mp-lan-found .lobby-item', { timeout: 10000 });
  console.log('guest found:', (await G.textContent('#mp-lan-found')).trim());
  await G.click('#mp-lan-found .lobby-item');
  await G.waitForSelector('#scr-setup:not([hidden])', { timeout: 15000 }); await H.waitForTimeout(800);
  const seats = await H.evaluate(() => [...document.querySelectorAll('#slots .slot-row select:nth-child(2)')].map(s => s.selectedOptions[0].textContent));
  assert(seats.some(t => /Wanderer/.test(t)), 'host seats the guest: ' + seats);
  await H.click('#setup-start');
  await G.waitForSelector('#game:not([hidden])', { timeout: 15000 }); await G.waitForTimeout(2500);
  const state = await Promise.all([H, G].map(p => p.evaluate(async () => {
    const r = E.game.relay, peer = [...r.peers.values()][0], stats = await peer.pc.getStats(); let pair = null;
    stats.forEach(s => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
    const kind = id => (stats.get(id) || {}).candidateType;
    return { mode: E.game.netMode, lan: !!r.opts.lan, online: !!E.game.online, pair: pair && [kind(pair.localCandidateId), kind(pair.remoteCandidateId)], audio: E.Audio.ctx && E.Audio.ctx.state };
  })));
  console.log('host', JSON.stringify(state[0])); console.log('guest', JSON.stringify(state[1]));
  for (const s of state) assert(s.lan && !s.online && s.pair && !s.pair.includes('relay'), 'a direct LAN link');
  assert.strictEqual(state[1].mode, 'guest');
  await G.evaluate(() => { const g = E.game, ids = g.world.s.units.filter(u => u.o === g.local).map(u => u.id); g.send({ c: 'move', ids, x: 600, y: 600 }); });
  await H.evaluate(async () => { const w = E.game.world; for (let i = 0; i < 1800; i++) { w.step(); w.drainEvents(); if (i % 200 === 0) await new Promise(r => setTimeout(r, 30)); } });
  await G.waitForFunction(() => E.game.world.s.t > 55, null, { timeout: 15000 }).catch(() => {});
  const t = await G.evaluate(() => E.game.world.s.t); console.log('guest follows to match time', t.toFixed(1), 's'); assert(t > 55, 'the guest follows the host');
  await H.evaluate(() => { const w = E.game.world; w.s.over = true; w.s.winner = w.teamOf(E.game.local); });
  await Promise.all([H, G].map(p => p.waitForSelector('#ov-end:not([hidden])', { timeout: 15000 })));
  await G.screenshot({ path: OUT + '/sniper-03-lan-end.png' });
  console.log('LAN match ended on both sides');
  await host.browser.close(); await guest.browser.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // 1. linkage, in the container
  const ldd = execFileSync(SNIPER, ['bash', '-c', 'grep PRETTY_NAME /etc/os-release; for f in ./ozymandosis ./*.so ./libvulkan.so.1 ./chrome_crashpad_handler; do ldd "$f"; done'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const missing = ldd.split('\n').filter(l => /not found/.test(l));
  console.log(ldd.split('\n')[0], `— libraries resolved: ${(ldd.match(/=> \//g) || []).length}, missing: ${missing.length}`);
  assert.deepStrictEqual(missing, [], 'every linked library resolves in the runtime');
  const display = await xvfb();
  nullSink();
  await singlePlayer(display);
  await lanMatch(display);
})().catch(e => { console.error(e); errs.push(e.message); }).finally(() => {
  for (const f of cleanup.reverse()) f();
  console.log(errs.length ? errs.join('\n') : 'no errors');
  if (!errs.length) fs.rmSync(TMP, { recursive: true, force: true }); else console.log('logs kept in', TMP);
  setTimeout(() => process.exit(errs.length ? 1 : 0), 500);
});
