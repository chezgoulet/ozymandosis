import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { boot, signup, type T } from './helpers.js';
import { Secrets } from '../src/lib/crypto.js';
import { createHash } from 'node:crypto';
import { loadKeys } from '../src/app.js';
import { rotateTicketKey, rewrapSecrets } from '../src/ops/keys.js';
import { recordClaim, settle } from '../src/realtime/results.js';

// a webhook receiver standing in for Discord/Slack
const hooks: any[] = [];
const hookServer = createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { hooks.push(JSON.parse(b)); res.end('ok'); }); });
await new Promise<void>(r => hookServer.listen(0, '127.0.0.1', r));
const hookUrl = `http://127.0.0.1:${(hookServer.address() as any).port}/hook`;

let t: T;
test('boot', async () => { t = await boot({ ALERT_WEBHOOK_URL: hookUrl, ALERT_EMAIL: 'ops@example.com', METRICS_TOKEN: 'a-long-enough-metrics-token-123', TURN_URLS: '' }); }); // TURN has its own tests (turn.test.ts)
after(async () => { await t.app.close(); hookServer.close(); });

test('ticket keys rotate without breaking tickets already issued', async () => {
  const before = t.ctx.signer.sign({ v: 1, mid: 'x' });
  const id = await rotateTicketKey(t.ctx.db, t.ctx.secrets);
  t.ctx.signer.replace(await loadKeys(t.ctx.db, t.ctx.secrets));
  assert.equal(t.ctx.signer.id, id, 'the new key signs');
  assert.ok(t.ctx.signer.verify(before), 'an old ticket still verifies');
  assert.equal((await t.api('GET', '/api/config')).json.ticketKeys.length, 2);
  await t.ctx.db.query(`update server_keys set retired_at = now() - interval '2 days' where id <> $1`, [id]);
  t.ctx.signer.replace(await loadKeys(t.ctx.db, t.ctx.secrets));
  assert.equal(t.ctx.signer.verify(before), null, 'retired over a day ago: gone');
});

test('SECRET_KEY rotation: the old key still opens old secrets until they are rewrapped', async () => {
  const oldKey = Buffer.alloc(32, 1), newKey = Buffer.alloc(32, 2);
  const old = new Secrets(oldKey), box = old.encrypt('totp-secret');
  const legacy = ['v1', ...box.split('.').slice(2)].join('.'); // a pre-key-id ciphertext
  const both = new Secrets(newKey, [oldKey]);
  assert.equal(both.decrypt(box), 'totp-secret'); assert.equal(both.decrypt(legacy), 'totp-secret');
  assert.ok(both.stale(box)); assert.ok(!both.stale(both.encrypt('x')));
  assert.throws(() => new Secrets(newKey).decrypt(box), /unknown key/);
  const u = await signup(t);
  await t.ctx.db.query('update users set totp_secret_enc = $2 where id = $1', [u.id, box]);
  const devKey = createHash('sha256').update('ozymandosis-dev-only-secret').digest(); // what the rest of this test database was sealed with
  const r = await rewrapSecrets(t.ctx.db, new Secrets(newKey, [oldKey, devKey]));
  assert.ok(r.totp >= 1); assert.equal(r.failed, 0);
  assert.ok((await rewrapSecrets(t.ctx.db, new Secrets(newKey))).failed === 0, 'nothing left to rewrap');
  const row = await t.ctx.db.one<any>('select totp_secret_enc from users where id = $1', [u.id]);
  assert.equal(new Secrets(newKey).decrypt(row.totp_secret_enc), 'totp-secret', 'readable with the new key alone');
});

test('the monitor alerts once, repeats only after hours, and resolves', async () => {
  await t.ctx.db.query(`insert into ops_heartbeats (name, at, ok, detail) values ('backup', now() - interval '30 hours', true, '{"disk": 91, "remote": true}')`);
  hooks.length = 0; t.mailer.outbox.length = 0;
  const firing = await t.ctx.monitor.run();
  const keys = firing.map(a => a.key);
  assert.ok(keys.includes('backup.stale') && keys.includes('disk.full'), keys.join());
  assert.equal(hooks.length, 1); assert.match(hooks[0].content, /backup/); assert.match(hooks[0].content, /91% full/);
  assert.ok(t.mailer.outbox.some(m => m.to === 'ops@example.com' && /Ozymandosis/.test(m.subject)));
  await t.ctx.monitor.run();
  assert.equal(hooks.length, 1, 'not sent again straight away');
  await t.ctx.db.query(`update ops_heartbeats set at = now(), detail = '{"disk": 40, "remote": true}' where name = 'backup'`);
  assert.equal((await t.ctx.monitor.run()).length, 0);
  const rows = await t.ctx.db.query<any>(`select key, resolved_at from ops_alerts`);
  assert.ok(rows.every(r => r.resolved_at), 'cleared alerts are resolved');
});

test('metrics need the token', async () => {
  assert.equal((await t.api('GET', '/metrics')).status, 404);
  const r = await t.app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer a-long-enough-metrics-token-123' } });
  assert.equal(r.statusCode, 200); assert.match(r.body, /ozy_online_players \d+/);
});

test('confirmed matches feed the balance numbers (aggregate only)', async () => {
  const a = await signup(t), b = await signup(t), admin = await signup(t);
  await t.ctx.db.query(`update users set role = 'support' where id = $1`, [admin.id]);
  const m = await t.ctx.db.one<any>(`insert into matches (code, mode, host_id, started_at) values ('BAL', 'custom', $1, now() - interval '10 minutes') returning id`, [a.id]);
  for (const [i, u] of [a, b].entries()) await t.ctx.db.query('insert into match_players (match_id, user_id, slot) values ($1, $2, $3)', [m.id, u.id, i]);
  const summary = { mode: 'annihilation', size: 's', players: [{ uid: a.id, culture: 'bloom', designs: [{ chassis: 'serpent', organs: ['sawjaw', 'fins'], count: 7 }] }, { uid: b.id, culture: 'choir', designs: [] }] };
  for (const u of [a, b]) await recordClaim(t.ctx, u.id, { match: m.id, kind: 'final', winnerTeam: 100, results: [{ uid: a.id, result: 'win' }, { uid: b.id, result: 'loss' }], summary });
  await settle(t.ctx, m.id);
  const r = await t.api('GET', '/api/admin/balance?days=7', undefined, admin.token);
  const bloom = r.json.cultures.find((c: any) => c.culture === 'bloom'), choir = r.json.cultures.find((c: any) => c.culture === 'choir');
  assert.equal(bloom.wins, 1); assert.equal(choir.games, 1); assert.equal(choir.wins, 0);
  assert.ok(bloom.ci[0] >= 0 && bloom.ci[1] <= 1);
  const d = await t.ctx.db.one<any>(`select games, wins, hatched from balance_designs where sig = 'serpent:fins+sawjaw'`);
  assert.deepEqual([d.games, d.wins, Number(d.hatched)], [1, 1, 7]);
});
