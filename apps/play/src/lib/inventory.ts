// SPDX-License-Identifier: AGPL-3.0-only
// The data-safety inventory (work order §7): what Ozymandosis collects, where it
// goes and how long it is kept, stated once, next to the code that does it.
// The Play Data Safety form, Apple's App Privacy answers and the privacy notice
// are all filled from docs/DATA-INVENTORY.md, which is generated from this file
// (npm run inventory -w apps/play). test/inventory.test.ts holds it to the code:
// every column of every table must be accounted for here, nothing listed may be
// missing from the schema, the crash-report and frame-rate fields must match what
// the routes accept, retention comes from RETENTION itself, and every third-party
// SDK in the app build must be listed. Change the code and this together.
import { RETENTION as R } from './retention.js';
import { REPORT_CONTEXT_KEYS } from '../reports/routes.js';
import { PerfRun } from '../reports/perf.js';

export type PlayCategory = 'Personal info: Name' | 'Personal info: Email address' | 'Personal info: User IDs' | 'Personal info: Other info' | 'Financial info: Purchase history'
  | 'Messages: Other in-app messages' | 'App activity: App interactions' | 'App activity: Other user-generated content' | 'App activity: Other actions'
  | 'App info and performance: Crash logs' | 'App info and performance: Diagnostics' | 'App info and performance: Other app performance data' | 'Not user data';
export type AppleCategory = 'Contact Info: Name' | 'Contact Info: Email Address' | 'Identifiers: User ID' | 'Purchases: Purchase History' | 'User Content: Other User Content'
  | 'User Content: Gameplay Content' | 'Usage Data: Product Interaction' | 'Diagnostics: Crash Data' | 'Diagnostics: Performance Data' | 'Other Data: Other Data Types' | 'Not user data';

// Who holds or receives it.
export const DESTINATIONS = {
  service: 'Ozymandosis play service (our server, Linode/Akamai; backups encrypted, off-site)',
  stripe: 'Stripe (payments on the website; the card is handled by Stripe and never reaches us)',
  steam: 'Valve / Steam (Steam purchases and ownership checks)',
  mail: 'Our email provider (sends sign-in and account mail)',
  turnstile: 'Cloudflare Turnstile (sign-up bot check, when enabled)',
  oauth: 'Google / Apple / Steam (only if the player signs in with them)',
  device: 'The player’s own device only (never sent)',
} as const;
type Dest = keyof typeof DESTINATIONS;

export interface Item {
  data: string; where: string[]; // table.column (or table.*) on the server; client:… for device-side data
  play: PlayCategory; apple: AppleCategory;
  purpose: string; to: Dest[]; retention: string;
  optional: boolean; linked: boolean; // linked to the account
}
const untilDeleted = 'Until the player deletes the account (deletion erases it).';
const days = (n: number) => `${n} days`;

// ── what the service stores ───────────────────────────────────────
export const SERVER: Item[] = [
  { data: 'Display name', where: ['users.display_name', 'users.name_key'], play: 'Personal info: Name', apple: 'Contact Info: Name', purpose: 'Shown to other players; account', to: ['service'], retention: untilDeleted + ' Replaced by a tombstone name on deletion.', optional: true, linked: true },
  { data: 'Email address', where: ['users.email', 'users.email_verified'], play: 'Personal info: Email address', apple: 'Contact Info: Email Address', purpose: 'Account, sign-in, security mail', to: ['service', 'mail', 'stripe'], retention: untilDeleted + ` Unconfirmed sign-ups: ${days(R.unverifiedAccountDays)}.`, optional: false, linked: true },
  { data: 'Password hash (Argon2) and two-factor secret (encrypted)', where: ['users.password_hash', 'users.totp_secret_enc', 'users.totp_enabled', 'users.totp_last_step', 'recovery_codes.*'], play: 'Personal info: Other info', apple: 'Other Data: Other Data Types', purpose: 'Account security', to: ['service'], retention: untilDeleted, optional: true, linked: true },
  { data: 'Account id and role', where: ['users.id', 'users.role', 'users.status', 'users.created_at', 'users.last_seen_at', 'users.crash_reports', 'users.chat'], play: 'Personal info: User IDs', apple: 'Identifiers: User ID', purpose: 'Account, preferences', to: ['service'], retention: untilDeleted + ' The id row remains, emptied, so match history stays consistent.', optional: false, linked: true },
  { data: 'Age range (13–15, 16–17, adult; never the birth date)', where: ['users.age_band'], play: 'Personal info: Other info', apple: 'Other Data: Other Data Types', purpose: 'Chat safety for younger players; the 13+ rule', to: ['service'], retention: untilDeleted, optional: false, linked: true },
  { data: 'Sign-in provider subject (Google / Apple / Steam id)', where: ['identities.*'], play: 'Personal info: User IDs', apple: 'Identifiers: User ID', purpose: 'Sign-in with that provider', to: ['service', 'oauth'], retention: untilDeleted, optional: true, linked: true },
  { data: 'Sessions (hashed token, device kind, two-factor flag)', where: ['sessions.*', 'login_handoffs.*', 'email_tokens.*', 'oauth_states.*'], play: 'Personal info: User IDs', apple: 'Identifiers: User ID', purpose: 'Keeping the player signed in; one-time links', to: ['service'], retention: `Sessions: until they expire or the player signs out. One-time tokens: ${days(R.usedTokensDays)} after use or expiry.`, optional: false, linked: true },
  { data: 'Moderation state', where: ['users.suspended_until', 'users.muted_until', 'sanctions.*'], play: 'App activity: Other actions', apple: 'Usage Data: Product Interaction', purpose: 'Enforcing the rules', to: ['service'], retention: untilDeleted, optional: false, linked: true },
  { data: 'Rating, match count and wins', where: ['users.rating', 'users.matches', 'users.wins'], play: 'App activity: App interactions', apple: 'Usage Data: Product Interaction', purpose: 'Matchmaking and the player’s record', to: ['service'], retention: untilDeleted, optional: false, linked: true },
  { data: 'Online match records (who, when, result, rating change, and whether it used the free daily match)', where: ['matches.*', 'match_players.*'], play: 'App activity: App interactions', apple: 'User Content: Gameplay Content', purpose: 'Ratings, disputes, counting the free match (one per rolling 24 hours)', to: ['service'], retention: `Kept for the life of the service, anonymised on account deletion; unfinished matches are closed after ${R.staleMatchHours} hours.`, optional: false, linked: true },
  { data: 'Cloud saves: lineage, designs, save slots', where: ['cloud_items.*'], play: 'App activity: Other user-generated content', apple: 'User Content: Gameplay Content', purpose: 'Sync between the player’s devices', to: ['service'], retention: untilDeleted, optional: true, linked: true },
  { data: 'Proof of purchase per platform (which stores confirmed this account bought the game, when; a hash of the proof, never the proof)', where: ['ownerships.*'], play: 'Financial info: Purchase history', apple: 'Purchases: Purchase History', purpose: 'For the Steam build, that Steam confirmed the account owns the game; bound to the account', to: ['service', 'steam'], retention: untilDeleted + ' Re-checked with Steam at least every 30 days.', optional: false, linked: true },
  { data: 'Memberships (status, period, plan, platform; a store purchase token, encrypted)', where: ['subscriptions.*', 'users.stripe_customer_id', 'promo_redemptions.*'], play: 'Financial info: Purchase history', apple: 'Purchases: Purchase History', purpose: 'Online play beyond the free match', to: ['service', 'stripe', 'steam'], retention: untilDeleted + ' Card details never reach us (Stripe holds them).', optional: true, linked: true },
  { data: 'Player reports (reason, details, and the chat lines attached)', where: ['player_reports.*'], play: 'Messages: Other in-app messages', apple: 'User Content: Other User Content', purpose: 'Moderation', to: ['service'], retention: `Chat lines: ${days(R.reportChatDays)} after the report is resolved; the report: ${days(R.playerReportsDays)}.`, optional: true, linked: true },
  { data: 'Crash and bug reports (scrubbed message and stack, version, platform, renderer, whitelisted context, optional screenshot)', where: ['reports.*', 'issues.*'], play: 'App info and performance: Crash logs', apple: 'Diagnostics: Crash Data', purpose: 'Fixing crashes and bugs', to: ['service'], retention: `Reports: ${days(R.reportsDays)}; screenshots: ${days(R.screenshotDays)}; resolved issues: ${days(R.closedIssuesDays)}. Unlinked on account deletion.`, optional: true, linked: true },
  { data: 'Frame-rate runs (frame-time percentiles, tier changes, device class, renderer; anonymous)', where: ['perf_runs.*'], play: 'App info and performance: Other app performance data', apple: 'Diagnostics: Performance Data', purpose: 'Keeping the game smooth on real devices', to: ['service'], retention: days(R.perfRunsDays), optional: true, linked: false },
  { data: 'Staff action log', where: ['audit_log.*'], play: 'App activity: Other actions', apple: 'Usage Data: Product Interaction', purpose: 'Accountability for staff and billing actions', to: ['service'], retention: days(R.auditDays), optional: false, linked: true },
];
// Tables and columns that hold no data about players (content, configuration, counters, keys).
export const NOT_USER_DATA = ['announcements.*', 'balance_cultures.*', 'balance_designs.*', 'daily_stats.*', 'ops_alerts.*', 'ops_heartbeats.*', 'promo_codes.*', 'remote_config.*',
  'schema_migrations.*', 'server_keys.*', 'stripe_events.*'];

// ── what the game sends that is not stored as above, and what stays on the device ──
export const CLIENT: { data: string; fields: readonly string[]; to: Dest[]; note: string }[] = [
  { data: 'Crash report context', fields: REPORT_CONTEXT_KEYS, to: ['service'], note: 'Only these keys are stored; anything else a client sends is dropped. Emails, addresses, home paths and tokens are scrubbed.' },
  { data: 'Frame-rate run', fields: Object.keys(PerfRun.shape), to: ['service'], note: 'Sent at the end of single-player and online matches when diagnostics are on; never for LAN matches.' },
  { data: 'Settings, saves, designs, lineage, measured runs, sign-in token', fields: ['efl.settings', 'efl.save.*', 'efl.meta.*', 'efl.designs', 'efl.designs.gone', 'efl.profile', 'efl.cloud', 'efl.cloud.previous', 'efl.news.dismissed', 'efl.perf.runs', 'efl.session', 'efl.agegate'], to: ['device'], note: 'Stored on the device. Saves and designs sync to the account only when the player signs in.' },
  { data: 'IP address (transient)', fields: ['connection'], to: ['service', 'turnstile'], note: 'Needed to connect; not stored. Request logs record a keyed pseudonym of the account instead (D16); the web server drops client addresses; the TURN relay logs nothing. Online matches are relayed so players never see each other’s address (D19). LAN matches never reach the service.' },
];

// ── third-party code in the apps ──────────────────────────────────
// Every dependency of the Android app and every Capacitor plugin, with what it collects.
export const SDKS: { id: string; collects: string }[] = [
  { id: 'androidx.appcompat:appcompat', collects: 'Nothing.' },
  { id: 'androidx.coordinatorlayout:coordinatorlayout', collects: 'Nothing.' },
  { id: 'androidx.core:core-splashscreen', collects: 'Nothing.' },
  { id: '@capacitor/core', collects: 'Nothing (the native bridge).' },
  { id: '@capacitor/app', collects: 'Nothing.' },
  { id: '@capacitor/browser', collects: 'Nothing (opens the system browser for sign-in and the account page).' },
  { id: '@capacitor/haptics', collects: 'Nothing.' },
  { id: '@capacitor/screen-orientation', collects: 'Nothing.' },
  { id: '@capacitor/share', collects: 'Nothing (opens the system share sheet for the lobby join code).' },
  { id: '@capacitor/status-bar', collects: 'Nothing.' },
];

// ── the document ─────────────────────────────────────────────────
export function renderMarkdown(): string {
  const d = (k: Dest) => DESTINATIONS[k];
  const L: string[] = [];
  L.push('# Data inventory', '', '<!-- Generated by `npm run inventory -w apps/play` from apps/play/src/lib/inventory.ts. Do not edit by hand; test/inventory.test.ts fails when this is stale. -->', '',
    'What Ozymandosis collects, where it goes and how long it is kept, produced from the code. Fill the **Google Play Data Safety** form, Apple’s **App Privacy** answers and the privacy notice (`apps/site/public/privacy.html`) from this page.', '',
    '**Across the board:** all data is encrypted in transit (HTTPS/WSS; matches are DTLS). Players can delete their account and data in the app and on the account page. Nothing is sold, and nothing is used for advertising or tracking. There is no analytics or advertising SDK. **Local (LAN) play collects nothing**: it never contacts the service.', '');
  L.push('## Collected by the service', '', '| Data | Play Data Safety | App Privacy | Purpose | Goes to | Kept | Optional | Linked to account |', '|---|---|---|---|---|---|---|---|');
  for (const i of SERVER) L.push(`| ${i.data} | ${i.play} | ${i.apple} | ${i.purpose} | ${i.to.map(d).join('; ')} | ${i.retention} | ${i.optional ? 'Yes' : 'No'} | ${i.linked ? 'Yes' : 'No'} |`);
  L.push('', '<details><summary>Where each item lives (tables and columns)</summary>', '', ...SERVER.map(i => `- **${i.data}**: \`${i.where.join('`, `')}\``), `- **Not user data**: \`${NOT_USER_DATA.join('`, `')}\``, '', '</details>', '');
  L.push('## Sent by the game, or kept on the device', '');
  for (const c of CLIENT) L.push(`- **${c.data}** → ${c.to.map(d).join('; ')}. Fields: \`${c.fields.join('`, `')}\`. ${c.note}`);
  L.push('', '## Third-party code in the apps', '', '| Library | What it collects |', '|---|---|', ...SDKS.map(s => `| \`${s.id}\` | ${s.collects} |`), '');
  L.push('## Other services involved', '', ...(Object.keys(DESTINATIONS) as Dest[]).filter(k => k !== 'service' && k !== 'device').map(k => `- ${d(k)}`), '');
  L.push('## Play Data Safety answers, summarised', '');
  const cats = [...new Set(SERVER.map(i => i.play))].filter(c => c !== 'Not user data').sort();
  for (const c of cats) { const items = SERVER.filter(i => i.play === c); L.push(`- **${c}** — collected${items.some(i => i.to.some(t => t !== 'service')) ? ', shared with service providers only' : ', not shared'}; ${items.every(i => i.optional) ? 'optional' : 'required'}; purposes: ${[...new Set(items.map(i => i.purpose))].join('; ')}.`); }
  L.push('- **Location, contacts, photos, files, calendar, health, device identifiers, web history** — not collected.', '');
  return L.join('\n');
}
