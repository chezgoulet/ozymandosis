// Operator commands:  npm run admin -- <command>
//   promote <email|name> <role>     grant a staff role (owner, admin, moderator, support, player)
//   create-owner <email> <password> create the first owner account (email pre-verified)
//   stripe:setup [yearlyCents]      create the product, the $1/month price, and optionally a yearly price
//   migrate                         apply database migrations
//   grant <email|name> <days>       complimentary membership
//   keys:rotate                     new match-ticket signing key (the old one verifies for a day)
//   secrets:rewrap                  re-encrypt stored secrets under the current SECRET_KEY (after a rotation)
import Stripe from 'stripe';
import { loadConfig } from './config.js';
import { openDb, migrate } from './db/index.js';
import { hashPassword, checkPassword, uniqueName } from './auth/service.js';
import { nameKey } from './lib/names.js';
import { setupStripeProduct } from './billing/stripe.js';
import { Secrets } from './lib/crypto.js';
import { rotateTicketKey, rewrapSecrets } from './ops/keys.js';

const [cmd, ...args] = process.argv.slice(2);
const cfg = loadConfig();
const db = await openDb({ url: cfg.DATABASE_URL, dir: cfg.PGLITE_DIR });
await migrate(db, s => console.log(s));
const find = async (who: string) => db.one<any>('select id, display_name, role from users where email = lower($1) or name_key = lower($1)', [who]);
try {
  if (cmd === 'promote') {
    const [who, role] = args; const u = await find(who);
    if (!u || !['owner', 'admin', 'moderator', 'support', 'player'].includes(role)) throw new Error('usage: promote <email|name> <role>');
    await db.query('update users set role = $2 where id = $1', [u.id, role]);
    await db.query(`insert into audit_log (action, target, detail) values ('cli.promote', $1, $2)`, [u.id, JSON.stringify({ role })]);
    console.log(`${u.display_name} is now ${role}`);
  } else if (cmd === 'create-owner') {
    const [email, password] = args; if (!email || !password) throw new Error('usage: create-owner <email> <password>');
    checkPassword(password);
    const name = await uniqueName({ db } as any, 'Overseer');
    const u = await db.one<any>(`insert into users (display_name, name_key, email, email_verified, password_hash, role, age_band) values ($1, $2, lower($3), true, $4, 'owner', 'adult') returning id`, [name, nameKey(name), email, await hashPassword(password)]);
    console.log(`owner created (${name}, ${u.id}). Sign in at ${cfg.PUBLIC_URL} and turn on two-factor before using the admin console.`);
  } else if (cmd === 'stripe:setup') {
    if (!cfg.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
    const { monthly, yearly } = await setupStripeProduct(new Stripe(cfg.STRIPE_SECRET_KEY), args[0] ? Math.round(Number(args[0])) : undefined);
    for (const p of [monthly, yearly]) if (p) console.log(`price ${p.id} (${p.unit_amount! / 100} ${p.currency}/${p.recurring?.interval}, tax ${p.tax_behavior}), lookup key ${p.lookup_key}`);
  } else if (cmd === 'grant') {
    const [who, days] = args; const u = await find(who); if (!u || !(+days > 0)) throw new Error('usage: grant <email|name> <days>');
    await db.query(`insert into subscriptions (id, user_id, status, current_period_end) values ($1, $2, 'active', now() + ($3 || ' days')::interval) on conflict (id) do update set status = 'active', current_period_end = excluded.current_period_end`, ['comp_' + u.id, u.id, days]);
    console.log(`${u.display_name} has a membership for ${days} days`);
  } else if (cmd === 'migrate') console.log('migrations up to date');
  else if (cmd === 'keys:rotate') {
    const id = await rotateTicketKey(db, Secrets.fromEnv(cfg.SECRET_KEY, !cfg.prod, cfg.SECRET_KEY_PREVIOUS));
    console.log(`new ticket key ${id}; running services pick it up within five minutes`);
  } else if (cmd === 'secrets:rewrap') {
    const r = await rewrapSecrets(db, Secrets.fromEnv(cfg.SECRET_KEY, !cfg.prod, cfg.SECRET_KEY_PREVIOUS));
    console.log(`re-encrypted ${r.totp} two-factor secrets and ${r.keys} signing keys.` + (r.failed ? ` ${r.failed} could not be opened with any configured key: keep SECRET_KEY_PREVIOUS and investigate.` : ' You can remove SECRET_KEY_PREVIOUS now.'));
    if (r.failed) process.exitCode = 1;
  }
  else console.log('commands: promote, create-owner, stripe:setup, grant, migrate, keys:rotate, secrets:rewrap');
} catch (e: any) { console.error(e.message); process.exitCode = 1; } finally { await db.close(); }
