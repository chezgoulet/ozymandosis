#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// The product version is written down in eight places. Two of them are load-bearing:
//   E.VERSION          what a client announces in the peer handshake (js/net/online.js)
//   MIN_CLIENT_VERSION what the service will let online (apps/play/src/config.ts)
// so a bump done in six of eight places is a support incident, not a cosmetic slip.
//
//   node tools/version-check.cjs                      # the nine markers against each other
//   TAG=v0.5.1 node tools/version-check.cjs           # ...and the tag against the version
//
// CI runs this on every push; the release workflows run it with TAG set before they
// ship anything, so a tag can no longer name a release the tree does not claim.
//
// It does NOT require MIN_CLIENT_VERSION to equal the version — see below.
'use strict';
const fs = require('fs');
const path = require('path');

const TAG = (process.env.TAG || '').trim();
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const readJson = (f) => JSON.parse(read(f));

const found = {};   // label -> value as written
const say = (label, value) => { found[label] = value === undefined ? '(not found)' : String(value); return value; };

// ── package.json files: the source of truth is the root one ──────────────
const rootVersion = say('package.json', readJson('package.json').version);
for (const f of ['apps/play/package.json', 'apps/desktop/package.json', 'apps/site/package.json']) {
  say(f, (() => { try { return readJson(f).version; } catch { return undefined; } })());
}

// ── Android: versionName must match; versionCode must encode it ──────────
const gradle = read('android/app/build.gradle');
const androidName = say('android versionName', /versionName\s*=?\s*["']([^"']+)["']/.exec(gradle)?.[1]);
const androidCode = say('android versionCode', /versionCode\s*=?\s*(\d+)/.exec(gradle)?.[1]);

// ── iOS ─────────────────────────────────────────────────────────────────
const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
const iosVersions = [...new Set([...pbx.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1].trim()))];
say('ios MARKETING_VERSION', iosVersions.join(' + '));

// ── the two that matter at runtime ──────────────────────────────────────
const clientVersion = say('js/net/online.js E.VERSION', /E\.VERSION\s*=\s*'([^']+)'/.exec(read('js/net/online.js'))?.[1]);
const minClient = say('apps/play MIN_CLIENT_VERSION', /MIN_CLIENT_VERSION:\s*z\.string\(\)\.default\('([^']+)'\)/.exec(read('apps/play/src/config.ts'))?.[1]);

// ── verdict ─────────────────────────────────────────────────────────────
const num = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '')); return m ? m.slice(1).map(Number) : null; };
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const problems = [];

const base = num(rootVersion);
if (!base) problems.push(`package.json has no usable semver version ("${rootVersion}")`);

for (const [label, value] of Object.entries(found)) {
  if (label === 'android versionCode') continue;             // checked by the formula below
  // MIN_CLIENT_VERSION is a FLOOR, not an identity: it is meant to lag the release,
  // so that a new build does not lock out everyone on the previous one. Requiring it
  // to equal the version would fail every release that does not raise the minimum —
  // which is most of them, and raising it every time is what it must not do.
  // It is checked below as a floor, and refused only if it is NEWER than the release.
  if (label === 'apps/play MIN_CLIENT_VERSION') continue;
  if (label === 'ios MARKETING_VERSION' && iosVersions.length > 1) {
    problems.push(`${label} disagrees with itself: ${iosVersions.join(' + ')}`);
    continue;
  }
  if (label === 'ios MARKETING_VERSION' && iosVersions.length === 1 && num(iosVersions[0]) === null) continue; // generated placeholder
  if (String(value) !== String(rootVersion)) problems.push(`${label} is ${value}, package.json is ${rootVersion}`);
}

if (base) {
  const wantCode = base[0] * 10000 + base[1] * 100 + base[2];
  if (String(androidCode) !== String(wantCode)) problems.push(`android versionCode is ${found['android versionCode']}, ${rootVersion} encodes as ${wantCode}`);
  const min = num(minClient);
  if (!min) problems.push(`MIN_CLIENT_VERSION is not usable semver ("${minClient}")`);
  else if (cmp(min, base) > 0) problems.push(`MIN_CLIENT_VERSION (${minClient}) is newer than the release (${rootVersion}) — it would lock every current build out`);
}

// ── the tag, when there is one ──────────────────────────────────────────
// Nothing else ties the tag to the tree: a tag can point at any commit, and the
// workflow that runs for it is the one in that commit. So the name is checked here,
// in the same pass as the markers, for every release form.
if (TAG) {
  const m = /^(?:v|server-v|app-v)(.+)$/.exec(TAG);
  if (!m) problems.push(`tag "${TAG}" is not a release tag (expected v<version>, server-v<version> or app-v<version>)`);
  else if (m[1] !== rootVersion) problems.push(`tag ${TAG} says ${m[1]}, but the tree says ${rootVersion} — the release would be named for a version that does not exist`);
}

if (problems.length) {
  console.error(`version check failed — ${problems.length} disagreement${problems.length === 1 ? '' : 's'} at ${rootVersion}:`);
  for (const p of problems) console.error('  ' + p);
  console.error('\nBump every place together, or the client and the service will disagree about who may play.');
  process.exit(1);
}
console.log(`version check: ${rootVersion} agrees across ${Object.keys(found).length} markers (min client ${minClient})${TAG ? ` and the tag ${TAG}` : ''}.`);
