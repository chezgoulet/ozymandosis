// SPDX-License-Identifier: AGPL-3.0-only
// Configuration from the environment. Everything optional has a safe default
// for local development; production refuses to boot without its secrets.
import { z } from 'zod';

const bool = z.enum(['1', '0', 'true', 'false', 'yes', 'no']).transform(v => v === '1' || v === 'true' || v === 'yes');
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8787),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_URL: z.string().url().default('http://localhost:8787'),
  SITE_URL: z.string().url().default('http://localhost:8080'),
  // Web origins allowed to call the API with credentials (the site, the web client, localhost in dev)
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: bool.default(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Postgres in production; an embedded PGlite (real Postgres in WASM) when unset
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().optional(),

  // 32+ random bytes, base64. Encrypts TOTP secrets and signing keys at rest, keys the log pseudonyms.
  SECRET_KEY: z.string().optional(),
  // During a SECRET_KEY rotation: the old key(s), comma-separated, until `secrets:rewrap` has run
  SECRET_KEY_PREVIOUS: z.string().optional(),

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Ozymandosis <no-reply@ozymandosis.com>'),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),
  STRIPE_PRICE_ID_YEARLY: z.string().optional(),
  // Google Play Billing (Android subscription): a service account with the
  // "View financial data / Manage orders and subscriptions" permission in Play Console
  // (its JSON key, raw or base64), and the secret in the Pub/Sub push URL for
  // Real-time Developer Notifications (…/api/billing/play/rtdn?token=…).
  GOOGLE_PLAY_SERVICE_ACCOUNT: z.string().optional(),
  GOOGLE_PLAY_PACKAGE: z.string().default('com.ozymandosis.game'),
  GOOGLE_PLAY_PRODUCT: z.string().default('ozymandosis_membership'),
  GOOGLE_PLAY_RTDN_TOKEN: z.string().min(24).optional(),
  // the Google Cloud project linked to Play Integrity (Play Console → App integrity), if the app is not linked automatically
  GOOGLE_CLOUD_PROJECT_NUMBER: z.string().optional(),
  // The App Store (iOS subscription and proof of purchase; docs/STORES.md)
  APPLE_BUNDLE_ID: z.string().default('com.ozymandosis.game'),
  APPSTORE_PRODUCT_MONTHLY: z.string().default('ozymandosis.membership.monthly'),
  APPSTORE_PRODUCT_ANNUAL: z.string().default('ozymandosis.membership.annual'),
  APPSTORE_ALLOW_SANDBOX: bool.default(false), // production: accept TestFlight/sandbox purchases too (review builds)
  // Steam: the game's app id (STEAM_APP_ID, below; STEAM_API_KEY must be a publisher key) proves ownership; seasons are DLC,
  // each unlocking online play until a date: [{"appid": 1234560, "until": "2027-10-01"}]
  STEAM_SEASONS: z.string().default('[]'),
  // No browser version (docs/MONETIZATION.md): online play only from the store apps
  // (android, ios, steam) whose purchase the service has verified with that store.
  // On by default in production; development and tests use browsers.
  // Stripe on the web is not part of the scheme (subscriptions are sold per platform,
  // in the platform's store). Off unless an operator decides otherwise.
  WEB_BILLING: bool.default(false),
  // Stripe Tax computes VAT/GST/sales tax at checkout (activate Stripe Tax in the dashboard first)
  STRIPE_TAX: bool.default(true),

  GOOGLE_CLIENT_ID: z.string().optional(), GOOGLE_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(), APPLE_TEAM_ID: z.string().optional(), APPLE_KEY_ID: z.string().optional(), APPLE_PRIVATE_KEY: z.string().optional(),
  STEAM_API_KEY: z.string().optional(), STEAM_APP_ID: z.string().optional(),

  // WebRTC: a TURN server sharing this secret (coturn use-auth-secret). Every online
  // match is relayed (D19), so clients never use STUN; none is handed out by default.
  STUN_URLS: z.string().default(''),
  TURN_URLS: z.string().default(''),
  TURN_SECRET: z.string().optional(),

  // the free online allowance: matches per rolling 24 hours (docs/MONETIZATION.md)
  FREE_MATCHES_PER_DAY: z.coerce.number().int().min(0).default(1),
  TURNSTILE_SECRET: z.string().optional(),
  MIN_CLIENT_VERSION: z.string().default('0.5.0'),

  // Operations: where alerts go, when they fire, and who may read /metrics (see docs/OPERATIONS.md)
  ALERT_EMAIL: z.string().optional(),
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  ALERT_5XX_PER_5MIN: z.coerce.number().default(20),
  ALERT_DISK_PERCENT: z.coerce.number().default(85),
  ALERT_CRASH_SPIKE: z.coerce.number().default(25),
  ALERT_DISPUTES_PER_DAY: z.coerce.number().default(10),
  BACKUP_STALE_HOURS: z.coerce.number().default(13),
  METRICS_TOKEN: z.string().min(24).optional(),
  REVISION: z.string().default('dev'),
});

export type Config = z.infer<typeof Env> & { dev: boolean; test: boolean; prod: boolean; corsOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid configuration:\n  ${msg}`);
  }
  const c = parsed.data;
  const prod = c.NODE_ENV === 'production';
  if (prod) {
    const missing = (['DATABASE_URL', 'SECRET_KEY', 'SMTP_URL', ...(c.WEB_BILLING ? ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const : [])] as const).filter(k => !c[k]);
    if (missing.length) throw new Error(`Production requires: ${missing.join(', ')}`);
  }
  if (c.SECRET_KEY && Buffer.from(c.SECRET_KEY, 'base64').length < 32) throw new Error('SECRET_KEY must be at least 32 bytes of base64');
  const corsOrigins = [c.SITE_URL, c.PUBLIC_URL, ...c.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)];
  if (c.SITE_URL.startsWith('https://')) corsOrigins.push(c.SITE_URL.replace('https://', 'https://www.'));
  return { ...c, dev: c.NODE_ENV === 'development', test: c.NODE_ENV === 'test', prod, corsOrigins };
}
