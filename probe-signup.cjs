// Isolate the sign-up hang: boot the play service the way the e2e does, then POST
// /api/auth/signup directly. No browser, no TURN. If this hangs, it is the service.
const { spawn } = require('child_process');
const path = require('path');
const PLAY = 8871, PLAY_URL = `http://localhost:${PLAY}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const play = spawn(process.execPath, [require.resolve('tsx/cli'), 'src/index.ts'], {
    cwd: path.join(__dirname, 'apps/play'),
    env: Object.assign({}, process.env, {
      NODE_ENV: 'test', DEV_AUTH: '1', PORT: String(PLAY), LOG_LEVEL: 'info', PGLITE_DIR: '',
      PUBLIC_URL: PLAY_URL,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  play.stdout.on('data', d => process.stdout.write('[svc] ' + d));
  play.stderr.on('data', d => process.stdout.write('[svc!] ' + d));

  let up = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(PLAY_URL + '/healthz')).ok) { up = true; break; } } catch (e) { /* booting */ }
    await sleep(500);
  }
  console.log('healthz up:', up, 'after', up ? 'wait' : 'timeout');

  const body = { email: `probe${Date.now()}@example.com`, password: 'a long enough password', name: 'Probe',
    client: 'web', birthYear: 1990, birthMonth: 6 };
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(PLAY_URL + '/api/auth/signup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: ctl.signal,
    });
    console.log('signup status', r.status, 'in', Date.now() - t0, 'ms');
    console.log('body', (await r.text()).slice(0, 300));
  } catch (e) {
    console.log('signup FAILED after', Date.now() - t0, 'ms:', e.name, e.message);
  } finally { clearTimeout(timer); }
  play.kill();
  process.exit(0);
})();
