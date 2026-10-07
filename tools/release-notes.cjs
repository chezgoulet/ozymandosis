#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// The body of a client release: what changed, and the steps that cannot be signed
// from here. Run by .github/workflows/release-client.yml.
//
//   TAG=v0.6.0 node tools/release-notes.cjs > RELEASE.md
'use strict';
const { scope } = require('./release-scope.cjs');

const TAG = (process.env.TAG || '').trim() || 'v0.0.0';
const version = require('../package.json').version;
const s = scope({ tag: TAG, event: 'push' });

const out = [];
out.push(`Ozymandosis **${TAG}** — the web bundle is attached to this release.`);
out.push('');
out.push(`Version \`${version}\`, agreeing everywhere it is written down: the sentence the game reports about itself, ` +
  'the Android versionName and versionCode, the iOS MARKETING_VERSION, the minimum-client gate the service enforces, and the four package.json files.');
out.push('');
out.push(`### What moved since ${s.previous || 'the previous release'}`);
out.push('');
out.push(`- server (\`apps/play\`, \`deploy/\`): ${s.server ? '**yes — the service redeploys for this tag**' : 'no'}`);
out.push(`- client (the game, apps, stores, site): ${s.client ? '**yes**' : 'no'}`);
out.push('');
if (s.files.length) {
  out.push('<details><summary>Files changed (' + s.files.length + ')</summary>');
  out.push('');
  for (const p of s.files.slice(0, 200)) out.push(`- ${s.isServer(p) ? 'server' : 'client'} \`${p}\``);
  if (s.files.length > 200) out.push(`- …and ${s.files.length - 200} more`);
  out.push('');
  out.push('</details>');
  out.push('');
}
out.push('### Not automated here, on purpose');
out.push('');
out.push('These need signing keys that do not live in CI, so they are yours:');
out.push('');
out.push('- **Android** — `npm run android:aab`, then upload the bundle in Play Console.');
out.push('- **iOS** — `npm run ios:open` on a Mac, then archive and upload (needs Xcode and the Apple certificates).');
out.push('- **Steam** — `cd apps/desktop && npm run package`, then the depot upload.');
out.push('');
out.push('The web bundle attached here is the same `www/` the PWA serves; it is built by this workflow and by `npm run build` on your machine.');

process.stdout.write(out.join('\n') + '\n');
