#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// One version for the whole product. The root package.json is the source; this
// writes it everywhere else a version is shown or keyed on, and checks that
// nothing has drifted.
//   node tools/version.cjs              print the version and every place it lives
//   node tools/version.cjs check        fail if any place disagrees (run by npm test)
//   node tools/version.cjs patch|minor|major
//   node tools/version.cjs 0.6.0        set an exact version (it must be higher)
// Android's versionCode is derived (major·10000 + minor·100 + patch), so it climbs
// with every release and never has to be remembered; Play refuses a code it has seen.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const wr = (f, s) => fs.writeFileSync(path.join(ROOT, f), s);

const parse = v => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v); if (!m) throw new Error(`Not a version: ${v}`); return m.slice(1).map(Number); };
const code = v => { const [a, b, c] = parse(v); if (b > 99 || c > 99) throw new Error('minor and patch must stay below 100 (the versionCode packs them)'); return a * 10000 + b * 100 + c; };
const cmp = (x, y) => { const a = parse(x), b = parse(y); for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const short = v => v.replace(/\.0$/, '');

// Each place: where it is, how to read it, how to write it.
const json = (file, label) => ({
  label, file,
  get: () => JSON.parse(rd(file)).version,
  set: v => { const s = rd(file); wr(file, s.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`)); },
});
const regex = (file, label, re, fmt) => ({
  label, file,
  get: () => { const m = re.exec(rd(file)); if (!m) throw new Error(`${file}: version not found`); return m[2]; },
  set: v => { const s = rd(file), all = new RegExp(re.source, 'g'); if (!all.test(s)) throw new Error(`${file}: version not found`); wr(file, s.replace(new RegExp(re.source, 'g'), (_, a, _v, b) => a + fmt(v) + b)); },
  fmt,
});
const PLACES = [
  json('package.json', 'root package (the source)'),
  json('apps/play/package.json', 'play service'),
  json('apps/site/package.json', 'website'),
  json('apps/desktop/package.json', 'desktop shell (Steam)'),
  regex('android/app/build.gradle', 'Android versionName', /(versionName = ")([^"]+)(")/, v => v),
  regex('android/app/build.gradle', 'Android versionCode', /(versionCode = )(\d+)()/, v => String(code(v))),
  regex('ios/App/App.xcodeproj/project.pbxproj', 'iOS MARKETING_VERSION', /(MARKETING_VERSION = )([^;]+)(;)/, v => v),
  regex('ios/App/App.xcodeproj/project.pbxproj', 'iOS CURRENT_PROJECT_VERSION', /(CURRENT_PROJECT_VERSION = )([^;]+)(;)/, v => String(code(v))),
  regex('js/net/online.js', 'game (E.VERSION: protocol hello, crash reports, service)', /(E\.VERSION = ')([^']+)(')/, v => v),
  regex('index.html', 'main menu', /(<span id="m-version">v)([^<]+)(<\/span>)/, short),
];
// package-lock.json repeats the root and workspace versions; npm rewrites it, but keep it honest.
function lock(v) {
  const f = 'package-lock.json', j = JSON.parse(rd(f));
  j.version = v;
  for (const k of ['', 'apps/play', 'apps/site']) if (j.packages && j.packages[k]) j.packages[k].version = v;
  wr(f, JSON.stringify(j, null, 2) + '\n');
}
const expected = (p, v) => p.fmt ? p.fmt(v) : v;

const arg = process.argv[2];
const src = PLACES[0].get();
if (!arg || arg === 'check') {
  const bad = [];
  for (const p of PLACES) { const got = p.get(), want = expected(p, src); if (!arg) console.log(`${p.label.padEnd(58)} ${got}  (${p.file})`); if (got !== want) bad.push(`${p.file}: ${p.label} is ${got}, expected ${want}`); }
  if (bad.length) { console.error(`Version drift from package.json (${src}):\n  ${bad.join('\n  ')}\nFix with: node tools/version.cjs ${src}`); process.exit(1); }
  if (arg) console.log(`version ${src} (Android versionCode ${code(src)}) agrees in all ${PLACES.length} places`);
  process.exit(0);
}
let next;
if (['patch', 'minor', 'major'].includes(arg)) {
  const [a, b, c] = parse(src);
  next = arg === 'major' ? `${a + 1}.0.0` : arg === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
} else next = arg;
parse(next);
// The first release is allowed to move down from the placeholder numbers; after
// that the versionCode must only climb, because Play keys every update on it.
const force = process.argv.includes('--allow-lower');
if (!force && code(next) <= code(src)) { console.error(`${next} is not higher than ${src}; Play would refuse versionCode ${code(next)}. (--allow-lower overrides.)`); process.exit(1); }
for (const p of PLACES) p.set(next);
lock(next);
console.log(`${src} → ${next} (Android versionCode ${code(next)}) in ${PLACES.length} places and package-lock.json`);
