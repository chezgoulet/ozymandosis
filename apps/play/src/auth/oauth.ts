// Sign in with Google, Apple, Discord, GitHub (OAuth 2 / OIDC with PKCE where
// supported) and Steam (OpenID 2.0 in the browser, session tickets for native
// Steam builds). Providers switch on when their credentials are configured.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Apple, Discord, GitHub, Google, decodeIdToken, generateCodeVerifier, generateState } from 'arctic';
import type { Ctx, UserRow } from '../context.js';
import { bad, notFound, unauthorized } from '../context.js';
import { SESSION_COOKIE } from '../app.js';
import { issueSession } from './routes.js';
import { createUser, mfaChallenge, normEmail, assertCanPlay } from './service.js';
import { coarseClient } from '../lib/privacy.js';
import { createSession } from './service.js';

type Profile = { subject: string; email?: string | null; emailVerified?: boolean; name?: string | null };
interface Provider { start(state: string, verifier: string): URL; finish(code: string, verifier: string): Promise<Profile> }

export function providers(ctx: Ctx): Record<string, Provider> {
  const c = ctx.cfg, cb = (p: string) => `${c.PUBLIC_URL}/auth/${p}/callback`, out: Record<string, Provider> = {};
  if (c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET) {
    const g = new Google(c.GOOGLE_CLIENT_ID, c.GOOGLE_CLIENT_SECRET, cb('google'));
    out.google = {
      start: (s, v) => g.createAuthorizationURL(s, v, ['openid', 'email', 'profile']),
      async finish(code, v) { const t = await g.validateAuthorizationCode(code, v); const id = decodeIdToken(t.idToken()) as any; return { subject: id.sub, email: id.email, emailVerified: !!id.email_verified, name: id.given_name || id.name }; },
    };
  }
  if (c.DISCORD_CLIENT_ID && c.DISCORD_CLIENT_SECRET) {
    const d = new Discord(c.DISCORD_CLIENT_ID, c.DISCORD_CLIENT_SECRET, cb('discord'));
    out.discord = {
      start: (s, v) => d.createAuthorizationURL(s, v, ['identify', 'email']),
      async finish(code, v) {
        const t = await d.validateAuthorizationCode(code, v);
        const me: any = await (await fetch('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${t.accessToken()}` } })).json();
        return { subject: me.id, email: me.email, emailVerified: !!me.verified, name: me.global_name || me.username };
      },
    };
  }
  if (c.GITHUB_CLIENT_ID && c.GITHUB_CLIENT_SECRET) {
    const gh = new GitHub(c.GITHUB_CLIENT_ID, c.GITHUB_CLIENT_SECRET, cb('github'));
    out.github = {
      start: s => gh.createAuthorizationURL(s, ['read:user', 'user:email']),
      async finish(code) {
        const t = await gh.validateAuthorizationCode(code), h = { authorization: `Bearer ${t.accessToken()}`, 'user-agent': 'ozymandosis' };
        const me: any = await (await fetch('https://api.github.com/user', { headers: h })).json();
        const emails: any[] = await (await fetch('https://api.github.com/user/emails', { headers: h })).json().catch(() => []);
        const prim = Array.isArray(emails) ? emails.find(e => e.primary && e.verified) : null;
        return { subject: String(me.id), email: prim?.email, emailVerified: !!prim, name: me.login };
      },
    };
  }
  if (c.APPLE_CLIENT_ID && c.APPLE_TEAM_ID && c.APPLE_KEY_ID && c.APPLE_PRIVATE_KEY) {
    const pem = c.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
    const a = new Apple(c.APPLE_CLIENT_ID, c.APPLE_TEAM_ID, c.APPLE_KEY_ID, new Uint8Array(Buffer.from(pem, 'base64')), cb('apple'));
    out.apple = {
      start: s => { const u = a.createAuthorizationURL(s, ['name', 'email']); u.searchParams.set('response_mode', 'form_post'); return u; },
      async finish(code) { const t = await a.validateAuthorizationCode(code); const id = decodeIdToken(t.idToken()) as any; return { subject: id.sub, email: id.email, emailVerified: id.email_verified === true || id.email_verified === 'true', name: null }; },
    };
  }
  return out;
}
// Steam OpenID needs no credentials (the API key only adds the persona name); 'dev' exists outside production.
export const enabledProviders = (ctx: Ctx) => [...Object.keys(providers(ctx)), 'steam', ...(ctx.cfg.prod ? [] : ['dev'])];

// Find or create the account behind a provider identity.
export async function resolveIdentity(ctx: Ctx, provider: string, p: Profile, linkUser: string | null): Promise<UserRow> {
  const found = await ctx.db.one<UserRow>(`select u.* from identities i join users u on u.id = i.user_id where i.provider = $1 and i.subject = $2`, [provider, p.subject]);
  if (found) return found;
  let user: UserRow | null = null;
  if (linkUser) user = await ctx.db.one<UserRow>('select * from users where id = $1', [linkUser]);
  const email = p.email && p.emailVerified ? normEmail(p.email) : null;
  // link by email only when both sides have proven it
  if (!user && email) user = await ctx.db.one<UserRow>('select * from users where email = $1 and email_verified = true', [email]);
  if (!user) {
    const free = email && !(await ctx.db.one('select 1 from users where email = $1', [email]));
    user = await createUser(ctx, { email: free ? email : null, verified: !!free, name: p.name });
  }
  await ctx.db.query(`insert into identities (provider, subject, user_id) values ($1, $2, $3) on conflict do nothing`, [provider, p.subject, user.id]);
  return user;
}

export default async function oauthRoutes(app: FastifyInstance, ctx: Ctx) {
  const P = providers(ctx);
  const done = async (req: FastifyRequest, reply: FastifyReply, provider: string, profile: Profile, st: any) => {
    const user = await resolveIdentity(ctx, provider, profile, st.link_user);
    if (user.status === 'banned' || user.status === 'deleted') return reply.redirect('/login?error=banned');
    assertCanPlay(user);
    if (user.totp_enabled) return reply.redirect(`/login?mfa=${encodeURIComponent(mfaChallenge(ctx, user.id, 'web'))}${st.handoff ? '&handoff=' + encodeURIComponent(st.handoff) : ''}`);
    await issueSession(ctx, req, reply, user, 'web', false, st.handoff);
    return reply.redirect(st.handoff ? '/login?done=1' : st.return_to || '/account');
  };
  const takeState = async (state: string | undefined, provider: string) => {
    if (!state) throw bad('Missing sign-in state.');
    const st = await ctx.db.one<any>(`delete from oauth_states where state = $1 and provider = $2 and expires_at > now() returning *`, [state, provider]);
    if (!st) throw bad('That sign-in expired. Please try again.');
    return st;
  };
  const begin = async (req: FastifyRequest, provider: string, verifier: string | null) => {
    const q = z.object({ handoff: z.string().optional(), link: z.string().optional(), return: z.string().optional() }).parse(req.query);
    const state = generateState();
    const ret = q.return && q.return.startsWith('/') && !q.return.startsWith('//') ? q.return : null;
    await ctx.db.query(`insert into oauth_states (state, provider, code_verifier, handoff, link_user, return_to, expires_at) values ($1, $2, $3, $4, $5, $6, now() + interval '10 minutes')`,
      [state, provider, verifier, q.handoff || null, q.link && req.auth ? req.auth.user.id : null, ret]);
    return state;
  };

  app.get('/auth/:provider/start', async (req, reply) => {
    const { provider } = req.params as { provider: string };
    if (provider === 'steam') {
      const state = await begin(req, 'steam', null);
      const ret = `${ctx.cfg.PUBLIC_URL}/auth/steam/callback?state=${state}`;
      const u = new URL('https://steamcommunity.com/openid/login');
      for (const [k, v] of Object.entries({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'checkid_setup', 'openid.return_to': ret, 'openid.realm': ctx.cfg.PUBLIC_URL, 'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select', 'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select' })) u.searchParams.set(k, v);
      return reply.redirect(u.toString());
    }
    const p = P[provider]; if (!p) throw notFound('That sign-in method is not available.');
    const verifier = generateCodeVerifier();
    const state = await begin(req, provider, verifier);
    return reply.redirect(p.start(state, verifier).toString());
  });

  const callback = async (req: FastifyRequest, reply: FastifyReply) => {
    const { provider } = req.params as { provider: string };
    const q = { ...(req.query as any), ...((req.body as any) || {}) };
    if (q.error) return reply.redirect('/login?error=' + encodeURIComponent(String(q.error).slice(0, 40)));
    if (provider === 'steam') {
      const st = await takeState(q.state, 'steam');
      const id = await verifySteamOpenId(ctx, q);
      if (!id) throw unauthorized('Steam could not confirm that sign-in.');
      return done(req, reply, 'steam', { subject: id, name: await steamName(ctx, id) }, st);
    }
    const p = P[provider]; if (!p) throw notFound();
    const st = await takeState(q.state, provider);
    let profile: Profile;
    try { profile = await p.finish(String(q.code || ''), st.code_verifier); } catch (e: any) { req.log.warn({ provider, e: e.message }, 'oauth exchange failed'); return reply.redirect('/login?error=provider'); }
    if (!profile.subject) return reply.redirect('/login?error=provider');
    return done(req, reply, provider, profile, st);
  };
  app.get('/auth/:provider/callback', callback);
  app.post('/auth/:provider/callback', callback); // Apple posts the result

  // Native Steam builds: the client passes an encrypted app ticket from the Steamworks SDK.
  app.post('/api/auth/steam-ticket', async req => {
    const b = z.object({ ticket: z.string().regex(/^[0-9a-fA-F]{16,4096}$/), name: z.string().optional() }).parse(req.body);
    if (!ctx.cfg.STEAM_API_KEY || !ctx.cfg.STEAM_APP_ID) throw bad('Steam sign-in is not configured.');
    const u = new URL('https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/');
    u.searchParams.set('key', ctx.cfg.STEAM_API_KEY); u.searchParams.set('appid', ctx.cfg.STEAM_APP_ID); u.searchParams.set('ticket', b.ticket);
    const r: any = await (await fetch(u)).json().catch(() => null);
    const sid = r?.response?.params?.steamid;
    if (!sid || r.response.params.result !== 'OK' || r.response.params.vacbanned) throw unauthorized('Steam could not confirm that sign-in.');
    const user = await resolveIdentity(ctx, 'steam', { subject: String(sid), name: b.name || null }, null);
    assertCanPlay(user);
    if (user.totp_enabled) return { mfa: 'required', challenge: mfaChallenge(ctx, user.id, 'game') };
    const s = await createSession(ctx, user.id, 'game', coarseClient(req.headers['user-agent']), false);
    return { ok: true, token: s.token };
  });

  // Development only: a fake provider so the whole flow can be exercised locally without credentials.
  if (ctx.cfg.dev || ctx.cfg.test) {
    app.get('/auth/dev/start', async (req, reply) => {
      const state = await begin(req, 'dev', null);
      return reply.type('text/html').send(`<!doctype html><meta name=viewport content="width=device-width"><form method=post action="/auth/dev/callback?state=${state}" style="font-family:system-ui;padding:2rem;max-width:360px"><h2>Development sign-in</h2><p>Pretend to be a provider account.</p><input name=subject value="dev-${Math.floor(Math.random() * 1e6)}" style="width:100%;padding:8px"><input name=name placeholder="Name" style="width:100%;padding:8px;margin-top:8px"><button style="margin-top:12px;padding:10px 16px">Continue</button></form>`);
    });
    app.post('/auth/dev/callback', async (req, reply) => {
      const st = await takeState((req.query as any).state, 'dev');
      const b = req.body as any;
      return done(req, reply, 'dev', { subject: String(b.subject || 'dev'), name: b.name || null }, st);
    });
  }
  void SESSION_COOKIE;
}

async function verifySteamOpenId(ctx: Ctx, q: Record<string, any>): Promise<string | null> {
  if (q['openid.mode'] !== 'id_res') return null;
  const ret = String(q['openid.return_to'] || '');
  if (!ret.startsWith(`${ctx.cfg.PUBLIC_URL}/auth/steam/callback`)) return null;
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (k.startsWith('openid.')) body.set(k, String(v));
  body.set('openid.mode', 'check_authentication');
  const text = await (await fetch('https://steamcommunity.com/openid/login', { method: 'POST', body })).text().catch(() => '');
  if (!/is_valid\s*:\s*true/.test(text)) return null;
  const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(String(q['openid.claimed_id'] || ''));
  return m ? m[1] : null;
}
async function steamName(ctx: Ctx, id: string): Promise<string | null> {
  if (!ctx.cfg.STEAM_API_KEY) return null;
  try {
    const r: any = await (await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${ctx.cfg.STEAM_API_KEY}&steamids=${id}`)).json();
    return r?.response?.players?.[0]?.personaname || null;
  } catch { return null; }
}
