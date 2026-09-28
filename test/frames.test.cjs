// The frame-rate instrument (work order §5): a match produces p50/p95/p99 frame
// times, a tier-change count and the device class, kept on the device and shown in
// Settings; and two runs of the same match agree closely enough to mean something.
// (The phone proof is a person's: docs/PERFORMANCE.md, "Measuring on a device".)
const pw = require('../tools/pw.cjs');
const path = require('path');
const assert = require('assert');
process.env.PORT = process.env.PORT || '8098'; process.env.QUIET = '1';
const files = require('../server/server.js');
const SECONDS = +(process.env.FRAMES_SECONDS || 32);
(async () => {
  const b = await pw.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  // no service here: the run is kept on the device whatever happens to the upload
  await p.goto(`http://localhost:${process.env.PORT}/?nosw=1&play=http://127.0.0.1:9`); await p.waitForTimeout(600);
  const once = async () => {
    await p.evaluate(() => document.getElementById('m-skirmish').click());
    await p.waitForSelector('#scr-setup:not([hidden])');
    await p.evaluate(() => { const s = E.Settings; s.quality = 'auto'; }); await p.click('#setup-start');
    await p.waitForSelector('#game:not([hidden])');
    await p.waitForTimeout(SECONDS * 1000);
    return p.evaluate(() => { E.game.stop(); return E.game.perfRun; });
  };
  try {
    const a = await once(), c = await once();
    for (const r of [a, c]) { assert(r, 'a run was recorded'); console.log(JSON.stringify({ fps: r.fps, p50: r.p50, p95: r.p95, p99: r.p99, below30: r.below30, tierChanges: r.tierChanges, tiers: `${r.tierStart}→${r.tierEnd}`, deviceClass: r.deviceClass, renderer: r.renderer, seconds: r.seconds, frames: r.frames })); }
    for (const k of ['p50', 'p95', 'p99', 'fps', 'tierChanges', 'deviceClass', 'renderer', 'seconds']) assert(a[k] !== undefined, k);
    assert(a.p50 <= a.p95 && a.p95 <= a.p99, 'percentiles are ordered');
    // Under vsync, frame times sit on 16.7 / 33.3 ms steps, so over 30 s the tail
    // percentiles flip a whole step when a few more frames miss. The typical frame
    // and the frame rate are stable; those must agree here. (A phone run lasts 15 min.)
    const close = (x, y, f) => Math.abs(x - y) <= f * Math.max(x, y);
    console.log(`agreement: p50 ${a.p50} vs ${c.p50}, fps ${a.fps} vs ${c.fps}, p95 ${a.p95} vs ${c.p95}, below-30 ${a.below30}% vs ${c.below30}%`);
    assert(close(a.p50, c.p50, 0.1) && close(a.fps, c.fps, 0.1), 'two runs agree');
    // readable by a person on the device
    await p.evaluate(() => E.Menus.openSettings(false));
    const shown = await p.textContent('#perf-runs');
    assert(/p95/.test(shown) && /tier change/.test(shown), 'Settings shows the runs'); console.log('settings:', shown.replace(/\s+/g, ' ').slice(0, 220));
  } catch (e) { console.error(e); errs.push(e.message); }
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await b.close(); files.close(); process.exit(errs.length ? 1 : 0);
})();
