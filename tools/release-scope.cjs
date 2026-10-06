#!/usr/bin/env node
// What does this release actually contain?
//
// This repo holds the game (client, Android, iOS, desktop, website) and the service
// (apps/play). A tag fires both release workflows, and each asks this module whether
// it has any work — so a release that only touches the client does not redeploy the
// service (backup, rebuild, restart) for nothing, and vice versa.
//
//   TAG=v0.6.0 EVENT=push node tools/release-scope.cjs >> "$GITHUB_OUTPUT"
//
// Emits, as GitHub step outputs: server, client, previous, why. A manually
// dispatched deploy passes EVENT=workflow_dispatch and is scoped to the server
// unconditionally: a human asking for a deploy is the evidence.
'use strict';
const { execSync } = require('node:child_process');

// Paths that mean "the service has to be redeployed".
const SERVER = (p) => p.startsWith('apps/play/') || p.startsWith('deploy/');
const MATCHES = ['v[0-9]*', 'server-v[0-9]*', 'app-v[0-9]*'];

const git = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

// The tag *before* this one in history — not merely the newest other tag, which is
// wrong for a re-tag or a back-tag.
function previousTag(tag) {
  const args = MATCHES.map((m) => `--match '${m}'`).join(' ');
  try { return git(`git describe --tags --abbrev=0 ${args} '${tag}^' 2>/dev/null`); } catch { return ''; }
}

function scope({ tag = '', event = 'push' } = {}) {
  const forced = { server: /^server-v/.test(tag), client: /^app-v/.test(tag) };
  let list = null, previous = '', why;

  if (event !== 'push') why = 'manual dispatch — deploying the server as asked';
  else if (!tag) why = 'no tag in the environment — treating everything as changed';
  else {
    previous = previousTag(tag);
    if (!previous) why = `first release tag (${tag}) — everything counts as changed`;
    else {
      try {
        list = git(`git diff --name-only '${previous}' '${tag}'`).split('\n').map((s) => s.trim()).filter(Boolean);
        why = `${list.length} file(s) changed between ${previous} and ${tag}`;
      } catch (e) {
        // Never fall through to "nothing changed": a scope we cannot compute has to
        // stop the release, not silently skip it.
        throw new Error(`could not diff ${previous}..${tag} — ${String(e.message).split('\n')[0]}`);
      }
    }
  }

  const server = forced.server || (list === null ? true : list.some(SERVER));
  const client = forced.client || (list === null ? true : list.some((p) => !SERVER(p)));
  if (forced.server) why += '; server-v* forces the server';
  if (forced.client) why += '; app-v* forces the client';
  return { server, client, previous, why, files: list || [], isServer: SERVER };
}

if (require.main === module) {
  let s;
  try { s = scope({ tag: (process.env.TAG || '').trim(), event: (process.env.EVENT || 'push').trim() }); }
  catch (e) { console.error(`release-scope: ${e.message}`); process.exit(1); }
  console.log(`server=${s.server}`);
  console.log(`client=${s.client}`);
  console.log(`previous=${s.previous}`);
  console.log(`why=${s.why} -> server=${s.server} client=${s.client}`);
  console.log(`release-scope: server=${s.server} client=${s.client} (${s.why})`);
  if (s.files.length && s.files.length <= 40) for (const p of s.files) console.log(`  ${s.isServer(p) ? 'server' : 'client'}  ${p}`);
}

module.exports = { scope, SERVER };
