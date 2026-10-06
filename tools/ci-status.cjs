#!/usr/bin/env node
// Gate a release on the commit having actually passed CI.
//
//   GITHUB_TOKEN=... node tools/ci-status.cjs <owner/repo> <sha>
//
// Exit 0 only when that exact commit has a successful `ci` run. A tag can point at
// any commit — one that was never tested, or one that failed and was fixed forward
// on a different branch — and GitHub will happily run a release workflow for it.
'use strict';

const [repo, sha] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const WORKFLOW = process.env.CI_WORKFLOW_NAME || 'ci';

async function main() {
  if (!repo || !sha) {
    console.error('usage: node tools/ci-status.cjs <owner/repo> <sha>   (GITHUB_TOKEN required)');
    process.exit(2);
  }
  if (!token) {
    console.error('ci-status: no GITHUB_TOKEN/GH_TOKEN in the environment.');
    process.exit(2);
  }

  const api = `https://api.github.com/repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`;
  const res = await fetch(api, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'ci-status' },
  });
  if (!res.ok) {
    console.error(`ci-status: GitHub answered ${res.status} ${res.statusText} for ${repo}@${sha.slice(0, 7)} — cannot verify, refusing to release.`);
    process.exit(2);
  }
  const runs = (await res.json()).workflow_runs || [];
  const mine = runs.filter((r) => r.name === WORKFLOW);

  if (!mine.length) {
    console.error(`ci-status: no "${WORKFLOW}" run exists for ${sha.slice(0, 7)}. Nothing has tested this commit — refusing to release.`);
    process.exit(1);
  }
  const good = mine.find((r) => r.conclusion === 'success');
  if (good) {
    console.log(`ci-status: ${sha.slice(0, 7)} passed "${WORKFLOW}" (${good.html_url}).`);
    process.exit(0);
  }
  const latest = mine.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  console.error(`ci-status: ${sha.slice(0, 7)} has ${mine.length} "${WORKFLOW}" run(s) and none succeeded (latest: ${latest.status} ${latest.conclusion}). Refusing to release.`);
  console.error(`  ${latest.html_url}`);
  process.exit(1);
}

main().catch((e) => { console.error('ci-status: ' + (e && e.message)); process.exit(2); });
