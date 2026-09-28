// The verifiable-host audit (js/net/audit.js): an honest host passes; a host that
// edits its world, drops a guest's orders or forges a checkpoint is caught.
const E = require('./load.cjs')(['js/net/audit.js', 'js/net/net.js']);
const assert = require('assert');
let fails = 0;
async function test(name, fn) { const t0 = Date.now(); try { await fn(); console.log('ok  ', name, `(${Date.now() - t0}ms)`); } catch (e) { fails++; console.log('FAIL', name, '\n', e.stack); } }
const cultures = E.CULTURE_LIST.map(c => c.id);
const flush = () => new Promise(r => setTimeout(r, 0));

// A host world (slot 1 is the "guest"), played for `ticks`; `cheat(w, tick)` may tamper.
async function play(ticks, opts = {}) {
  const w = new E.World({ cfg: { map: { size: 's', seed: 5, powerups: 1, currents: true }, players: [0, 1].map(i => ({ culture: cultures[i], kind: i ? 'remote' : 'bot', diff: 'normal', team: 0 })) } });
  const host = new E.AuditHost(w), guest = new E.AuditGuest(1);
  for (let k = 1; k <= ticks; k++) {
    if (k % 90 === 0) {
      // the guest orders its creatures around; the host applies (or drops) them
      const ids = w.s.units.filter(u => u.o === 1).slice(0, 3).map(u => u.id);
      const cmd = guest.stamp({ c: 'move', ids, x: 400 + (k % 300), y: 400 });
      if (!(opts.drop && k > 700)) w.command(1, JSON.parse(JSON.stringify(cmd)));
    }
    w.step(); w.drainEvents(); host.tick();
    if (opts.cheat) opts.cheat(w, w.s.tick);
    if (k % 4 === 0) { await flush(); guest.onSnap({ tick: w.s.tick, au: host.take() }, w); }
  }
  await flush(); await flush(); guest.onSnap({ tick: w.s.tick, au: host.take() }, w);
  return { w, host, guest };
}
const every = g => [...g.commits.keys()].filter(a => g.commits.has(a + E.Audit.EVERY));

(async () => {
  await test('an honest host passes every window', async () => {
    const { host, guest } = await play(2500);
    const w = every(guest); assert(w.length >= 3, 'windows ' + w.length);
    const v = await guest.verify(host.answer({ w: guest.pick() }));
    assert.strictEqual(v.verdict, 'ok', JSON.stringify(v)); assert.strictEqual(v.windows, Math.min(E.Audit.WINDOWS, w.length));
    assert.strictEqual(new Set(guest.order()).size, w.length, 'every window is in the order');
  });
  await test('a host that hands itself lumen is caught', async () => {
    const { host, guest } = await play(2500, { cheat: (w, t) => { if (t === 1000) w.s.players[0].lumen += 3000; } });
    // the guest walks every window in batches, as the game does
    const order = guest.order(), vs = [];
    while (order.length) vs.push(await guest.verify(host.answer({ w: order.splice(0, E.Audit.WINDOWS) })));
    const v = E.Audit.merge(vs);
    assert.strictEqual(v.verdict, 'tamper', JSON.stringify(v)); assert(v.reasons.some(r => /lumen/.test(r)));
  });
  await test('a host that drops the guest’s orders is caught', async () => {
    const { host, guest } = await play(2500, { drop: true });
    const v = await guest.verify(host.answer({ w: every(guest) }));
    assert.strictEqual(v.verdict, 'tamper'); assert(v.reasons.some(r => /orders were never applied/.test(r)), JSON.stringify(v));
  });
  await test('a forged checkpoint does not match the commitment', async () => {
    const { host, guest } = await play(1900);
    const ans = host.answer({ w: every(guest) });
    const s = JSON.parse(ans.w[0].sb); s.players[0].lumen = 99999; ans.w[0].sb = JSON.stringify(s);
    const v = await guest.verify(ans);
    assert.strictEqual(v.verdict, 'tamper'); assert(v.reasons.some(r => /committed/.test(r)));
  });
  await test('no reply is unverified, not an accusation', async () => {
    const { guest } = await play(700);
    assert.strictEqual((await guest.verify(null)).verdict, 'unverified');
  });
  await test('fogged snapshots never throw, never show unseen rivals, and keep rival economies private', async () => {
    const w = new E.World({ cfg: { map: { size: 'm', seed: 11, powerups: 1, currents: true, fog: true }, players: [0, 1, 2, 3].map(i => ({ culture: cultures[i], kind: 'bot', diff: 'hard', team: 0 })) } });
    const memo = [{}, {}, {}, {}];
    for (let k = 0; k < 30 * 600 && !w.s.over; k++) {
      w.step(); const ev = w.drainEvents();
      if (k % 30) continue;
      for (let slot = 0; slot < 4; slot++) {
        const d = E.NetPack.snap(w, slot, ev, memo[slot]);
        if (!d.fog) continue;
        const src = w.visionSources(slot);
        for (const u of d.units) if (u[1] !== slot && !src.some(v => Math.hypot(v.x - u[3], v.y - u[4]) < v.r + 260)) throw new Error(`unit ${u[0]} of ${u[1]} sent to ${slot} out of sight`);
        for (const p of d.players) if (p.idx !== slot && (p.research !== undefined || p.stats !== undefined || p.lumen > 20)) throw new Error('rival economy leaked');
      }
    }
  });
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})();
