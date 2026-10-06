// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import type Stripe from 'stripe';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import type { Secrets, Keyring } from './lib/crypto.js';
import type { Mailer } from './lib/mail.js';
import type { Hub } from './realtime/hub.js';
import type { Monitor } from './ops/monitor.js';

export interface Ctx {
  cfg: Config;
  db: Db;
  secrets: Secrets;
  mail: Mailer;
  signer: Keyring;
  stripe: Stripe | null;
  log: FastifyBaseLogger;
  hub: Hub;
  monitor: Monitor;
  now: () => number;
}

export type Role = 'player' | 'support' | 'moderator' | 'admin' | 'owner';
export const ROLE_RANK: Record<Role, number> = { player: 0, support: 1, moderator: 2, admin: 3, owner: 4 };

export interface UserRow {
  id: string; display_name: string; email: string | null; email_verified: boolean; password_hash: string | null;
  totp_secret_enc: string | null; totp_enabled: boolean; totp_last_step: string | number | null;
  role: Role; status: 'active' | 'suspended' | 'banned' | 'deleted'; suspended_until: string | Date | null; muted_until: string | Date | null;
  stripe_customer_id: string | null; rating: number; matches: number; wins: number; crash_reports: boolean; created_at: string | Date; last_seen_at: string | Date | null;
  age_band: '13-15' | '16-17' | 'adult' | null; chat: 'all' | 'quick' | 'off';
}
export interface Authed { user: UserRow; sessionId: string; via: 'cookie' | 'bearer'; mfa: boolean }

declare module 'fastify' {
  interface FastifyRequest { auth?: Authed | null; rawBody?: Buffer; tag?: string }
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
export const bad = (msg: string, code?: string) => new HttpError(400, msg, code);
export const unauthorized = (msg = 'Please sign in.') => new HttpError(401, msg, 'unauthorized');
export const forbidden = (msg = 'You do not have access to that.') => new HttpError(403, msg, 'forbidden');
export const notFound = (msg = 'Not found.') => new HttpError(404, msg, 'not_found');
export const tooMany = (msg = 'Too many attempts. Try again in a little while.') => new HttpError(429, msg, 'rate_limited');

export type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
