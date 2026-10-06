// The data inventory must match what the code does (work order §7).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate } from '../src/db/index.js';
import { SERVER, NOT_USER_DATA, CLIENT, SDKS, renderMarkdown } from '../src/lib/inventory.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const db = await openDb({});
after(async () => { await db.close(); });

test('every column of every table is accounted for, and nothing listed is missing', async () => {
  await migrate(db);
  const cols = await db.query<{ t: string; c: string }>(`select table_name as t, column_name as c from information_schema.columns where table_schema = 'public'`);
  const listed = [...SERVER.flatMap(i => i.where), ...NOT_USER_DATA];
  const covers = (t: string, c: string) => listed.some(w => w === `${t}.${c}` || w === `${t}.*`);
  const missing = cols.filter(x => !covers(x.t, x.c)).map(x => `${x.t}.${x.c}`);
  assert.deepEqual(missing, [], 'columns not in the inventory: add them to SERVER or NOT_USER_DATA');
  const tables = new Set(cols.map(x => x.t)), have = new Set(cols.map(x => `${x.t}.${x.c}`));
  const stale = listed.filter(w => w.endsWith('.*') ? !tables.has(w.slice(0, -2)) : !have.has(w));
  assert.deepEqual(stale, [], 'inventory entries naming columns that do not exist');
  const twice = listed.filter((w, i) => listed.indexOf(w) !== i);
  assert.deepEqual(twice, [], 'listed twice');
});

test('every item says where it goes and how long it is kept', () => {
  for (const i of SERVER) { assert.ok(i.to.length && i.retention.length > 3 && i.purpose, i.data); assert.ok(!/undefined|NaN/.test(i.retention), i.data); }
});

test('every key the game stores on the device is listed', () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk(join(ROOT, 'js'));
  const keys = new Set<string>();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/'(efl\.[a-zA-Z.]+)/g)) keys.add(m[1].replace(/\.$/, '.*'));
  const listed = CLIENT.flatMap(c => [...c.fields]);
  const missing = [...keys].filter(k => !listed.includes(k));
  assert.deepEqual(missing, [], 'device storage keys not in the inventory');
});

test('every third-party library in the Android app and every Capacitor plugin is listed', () => {
  const gradle = readFileSync(join(ROOT, 'android/app/build.gradle'), 'utf8');
  const deps = [...gradle.matchAll(/^\s*implementation\s+"([\w.-]+:[\w.-]+):/gm)].map(m => m[1]);
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const plugins = Object.keys(pkg.dependencies || {}).filter(k => k.startsWith('@capacitor/'));
  const listed = SDKS.map(s => s.id);
  assert.deepEqual([...deps, ...plugins].filter(d => !listed.includes(d)), [], 'unlisted SDKs');
  // The app is free on every rail and membership is bought on the website, so no Google
  // artifact belongs in it. Until 2026-10-06 this line asserted the opposite — that the
  // Play Billing dependency was present. The decision, inverted, and now enforced.
  assert.deepEqual(deps.filter(d => /^(com\.android\.billingclient|com\.google\.)/.test(d)), [], 'Google dependencies are gone');
});

test('docs/DATA-INVENTORY.md is the current output (npm run inventory -w apps/play)', () => {
  assert.equal(readFileSync(join(ROOT, 'docs/DATA-INVENTORY.md'), 'utf8'), renderMarkdown() + '\n');
});
