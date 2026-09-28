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

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Ozymandosis <no-reply@ozymandosis.com>'),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(), GOOGLE_CLIENT_SECRET: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(), DISCORD_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(), GITHUB_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(), APPLE_TEAM_ID: z.string().optional(), APPLE_KEY_ID: z.string().optional(), APPLE_PRIVATE_KEY: z.string().optional(),
  STEAM_API_KEY: z.string().optional(), STEAM_APP_ID: z.string().optional(),

  // WebRTC: public STUN, and a TURN server sharing this secret (coturn use-auth-secret)
  STUN_URLS: z.string().default('stun:stun.l.google.com:19302'),
  TURN_URLS: z.string().default(''),
  TURN_SECRET: z.string().optional(),

  FREE_MATCH_MINUTES: z.coerce.number().default(15),
  TURNSTILE_SECRET: z.string().optional(),
  MIN_CLIENT_VERSION: z.string().default('1.0.0'),
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
    const missing = (['DATABASE_URL', 'SECRET_KEY', 'SMTP_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const).filter(k => !c[k]);
    if (missing.length) throw new Error(`Production requires: ${missing.join(', ')}`);
  }
  if (c.SECRET_KEY && Buffer.from(c.SECRET_KEY, 'base64').length < 32) throw new Error('SECRET_KEY must be at least 32 bytes of base64');
  const corsOrigins = [c.SITE_URL, c.PUBLIC_URL, ...c.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)];
  if (c.SITE_URL.startsWith('https://')) corsOrigins.push(c.SITE_URL.replace('https://', 'https://www.'));
  return { ...c, dev: c.NODE_ENV === 'development', test: c.NODE_ENV === 'test', prod, corsOrigins };
}
