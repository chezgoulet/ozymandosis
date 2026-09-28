import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, signup, type T } from './helpers.js';
import { sweep } from '../src/lib/retention.js';

// What js/ui/framestats.js sends at the end of a measured match.
const run = (over: object = {}) => ({ v: 1, at: new Date().toISOString(), version: '0.5.0', platform: 'android', deviceClass: 'mobile', renderer: 'webgl2', mode: 'local', seconds: 900, frames: 45000, fps: 50,
  p50: 16.8, p95: 24.1, p99: 38.5, worst: 140, below30: 1.2, hitches: 4, cpuMs: 6.1, tierStart: 'medium', tierEnd: 'low', tierChanges: 2,
  tierLog: [{ s: 120.5, from: 'medium', to: 'low', why: 'missed 14% of frames' }, { s: 400, from: 'low', to: 'medium', why: 'headroom probe' }], unitsPeak: 310, popCap: 90, players: 4, quality: 'auto', cores: 8, memoryGB: 4, screen: '1080x2400@2.63', ...over });

let t: T;
test('boot', async () => { t = await boot(); });
after(async () => { await t.app.close(); });

test('a measured match is stored without any account or address', async () => {
  assert.equal((await t.api('POST', '/api/perf', run())).status, 200);
  const u = await signup(t);
  assert.equal((await t.api('POST', '/api/perf', run({ p50: 17.2 }), u.token)).status, 200);
  const rows = await t.ctx.db.query<any>('select * from perf_runs');
  assert.equal(rows.length, 2);
  assert.ok(!Object.keys(rows[0]).some(k => /user|ip|addr|email/.test(k)), 'no identifying column');
  assert.equal(rows[0].detail.tierLog.length, 2);
});

test('LAN runs are not accepted (local play does not report), and junk is refused', async () => {
  assert.equal((await t.api('POST', '/api/perf', run({ mode: 'lan' }))).json.skipped, true);
  assert.equal((await t.api('POST', '/api/perf', run({ deviceClass: 'Pixel 8 of Bob' }))).status, 400);
  assert.equal((await t.api('POST', '/api/perf', run({ renderer: '<script>' }))).status, 400);
  assert.equal(Number((await t.ctx.db.one<any>('select count(*)::int as n from perf_runs')).n), 2);
});

test('staff find the runs afterwards: recent runs and medians per device class', async () => {
  const player = await signup(t);
  assert.equal((await t.api('GET', '/api/admin/perf', undefined, player.token)).status, 403);
  const s = await signup(t); await t.ctx.db.query(`update users set role = 'support' where id = $1`, [s.id]);
  const r = await t.api('GET', '/api/admin/perf', undefined, s.token);
  assert.equal(r.status, 200); assert.equal(r.json.runs.length, 2);
  assert.equal(r.json.summary[0].device_class, 'mobile'); assert.equal(r.json.summary[0].runs, 2);
  assert.equal(Math.round(r.json.summary[0].p50 * 10), 170);
});

test('runs are deleted after the retention period', async () => {
  await t.ctx.db.query(`update perf_runs set created_at = now() - interval '181 days'`);
  const swept = await sweep(t.ctx);
  assert.equal(swept.perf_runs, 2);
});
