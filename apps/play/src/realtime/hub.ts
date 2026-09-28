// The realtime hub: presence, lobbies, quick match, and WebRTC signaling.
// It introduces players and vouches for them (signed match tickets); the
// match itself runs peer to peer between the players, encrypted, and never
// passes through this server.
//
// Protocol (JSON over one WebSocket per client; the first message must be auth):
//   → auth {token, version, proto, platform}            ← hello {user, ent, ice, key, announcements, config}
//   → host {title?, public?, mode?, max?}         ← hosted {room, id: 0, ice}
//   → join {room}                                 ← joined {room, id, ice, hostName}; host ← peer {id, name, uid, sub, muted}
//   → signal {to, data}                           ← signal {from, data}      (host ↔ guest only)
//   → meta {title?, public?, mode?, players?, max?} (host: lobby listing)
//   → lobbies                                     ← lobbies {list}
//   → kick {id} | leave                            ← left {id} | closed
//   → start                                       ← ticket {ticket, match}  (to everyone in the lobby)
//   → end {winnerTeam, duration, results}         (host reports the outcome)
//   → queue {mode} | unqueue                      ← queued {mode} | matched {room, role, mode}
//   server pushes: me {user, ent}, announcement {...}, maintenance {message}, kicked {msg}, error {msg}
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { createHmac, randomInt } from 'node:crypto';
import type { Ctx, UserRow } from '../context.js';
import { entitlements, sessionUser, bump, type Entitlements } from '../auth/service.js';
import { userTag } from '../lib/privacy.js';
import { filterChat } from '../lib/names.js';
import { activeAnnouncements } from '../routes/public.js';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_PLAYERS = 6;
const QUEUE_MODES: Record<string, { size: number; min: number; waitMin: number }> = { duel: { size: 2, min: 2, waitMin: 0 }, ffa: { size: 4, min: 3, waitMin: 45 }, team: { size: 4, min: 4, waitMin: 0 } };
const cmpVersion = (a: string, b: string) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };

interface Conn {
  ws: WebSocket; user: UserRow | null; ent: Entitlements | null; tag: string;
  lobby: Lobby | null; lid: number; bucket: number; last: number; version: string; proto: number; platform: string; queued: string | null; queuedAt: number;
}
interface Lobby {
  code: string; host: Conn; members: Map<number, Conn>; seq: number; createdAt: number;
  title: string; public: boolean; mode: string; max: number; players: number;
  started: boolean; matchId: string | null; ticket: string | null; ranked: boolean; reserved: Set<string> | null; kicked: Set<string>;
  seats: Map<string, number>; // user id → lobby id, so a player who drops and rejoins keeps their seat
  pending: boolean; waiting: Conn[]; // quick match: guests wait until the chosen host claims the lobby
}

export class Hub {
  conns = new Set<Conn>();
  lobbies = new Map<string, Lobby>();
  queue = new Map<string, Conn[]>();
  private timer: NodeJS.Timeout;
  constructor(private ctx: Ctx) {
    this.timer = setInterval(() => { this.matchmake(); this.heartbeat(); }, 2000);
    this.timer.unref();
  }
  close() { clearInterval(this.timer); for (const c of this.conns) try { c.ws.close(1001, 'server shutting down'); } catch { /* */ } }

  routes(app: FastifyInstance) {
    app.get('/ws', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => this.accept(socket, req));
  }

  // ── connection lifecycle ─────────────────────────────────────
  private accept(ws: WebSocket, req: FastifyRequest) {
    const c: Conn = { ws, user: null, ent: null, tag: '-', lobby: null, lid: -1, bucket: 60, last: Date.now(), version: '0', proto: 1, platform: '', queued: null, queuedAt: 0 };
    this.conns.add(c);
    const authTimer = setTimeout(() => { if (!c.user) ws.close(4001, 'auth timeout'); }, 10000);
    (ws as any).isAlive = true;
    ws.on('pong', () => { (ws as any).isAlive = true; });
    ws.on('message', async (raw: Buffer) => {
      // token bucket: 12 msgs/s sustained, bursts of 60 (ICE candidates arrive in bursts)
      const now = Date.now(); c.bucket = Math.min(60, c.bucket + (now - c.last) * 0.012); c.last = now;
      if (--c.bucket < 0) { this.send(c, { op: 'error', msg: 'Slow down.' }); if (c.bucket < -40) ws.close(4008, 'flood'); return; }
      if (raw.length > 64 * 1024) return;
      let m: any; try { m = JSON.parse(raw.toString('utf8')); } catch { return; }
      if (!m || typeof m.op !== 'string') return;
      try {
        if (!c.user) { if (m.op === 'auth') { clearTimeout(authTimer); await this.auth(c, m, req); } return; }
        await this.handle(c, m);
      } catch (e: any) { this.ctx.log.warn({ op: m.op, e: e.message, u: c.tag }, 'ws handler'); this.send(c, { op: 'error', msg: 'That did not work. Please try again.' }); }
    });
    ws.on('close', () => { clearTimeout(authTimer); this.drop(c); });
    ws.on('error', () => {});
  }
  private async auth(c: Conn, m: any, _req: FastifyRequest) {
    const a = await sessionUser(this.ctx, String(m.token || ''));
    if (!a) { this.send(c, { op: 'error', msg: 'Please sign in again.', code: 'unauthorized' }); c.ws.close(4001, 'unauthorized'); return; }
    if (a.user.status === 'suspended') { this.send(c, { op: 'kicked', msg: `Your account is suspended until ${new Date(a.user.suspended_until!).toUTCString()}.` }); c.ws.close(4003, 'suspended'); return; }
    c.version = String(m.version || '0').slice(0, 20); c.proto = Number.isInteger(m.proto) ? m.proto : 1; c.platform = String(m.platform || '').slice(0, 20);
    const cfg = await this.remote();
    if (cmpVersion(c.version, cfg.minClientVersion) < 0) { this.send(c, { op: 'upgrade', msg: 'A new version of Ozymandosis is out. Please update to play online.', min: cfg.minClientVersion }); c.ws.close(4010, 'upgrade'); return; }
    if (cfg.maintenance?.on && a.user.role === 'player') { this.send(c, { op: 'maintenance', msg: cfg.maintenance.message || 'Online play is down for maintenance. Back soon.' }); c.ws.close(4011, 'maintenance'); return; }
    c.user = a.user; c.tag = userTag(this.ctx.secrets, a.user.id); c.ent = await entitlements(this.ctx, a.user);
    this.send(c, {
      op: 'hello', user: this.pub(c), ent: c.ent, ice: this.ice(c),
      key: { kid: this.ctx.signer.id, x: this.ctx.signer.publicRaw },
      announcements: await activeAnnouncements(this.ctx, c.ent.subscriber),
      config: { freeMatchMinutes: c.ent.freeMatchMinutes, needsVerify: this.needsVerify(a.user), mutedUntil: a.user.muted_until },
    });
    await bump(this.ctx, 'ws_sessions');
  }
  private needsVerify(u: UserRow) { return !!(u.password_hash && u.email && !u.email_verified); }
  private pub(c: Conn) { const u = c.user!; return { id: u.id, name: u.display_name, rating: u.rating, role: u.role }; }
  private send(c: Conn, o: object) { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); }
  private heartbeat() { for (const c of this.conns) { const w = c.ws as any; if (w.isAlive === false) { w.terminate(); continue; } w.isAlive = false; try { w.ping(); } catch { /* */ } } }

  // TURN credentials in coturn's REST format (use-auth-secret), valid 12 hours.
  ice(c: Conn) {
    const out: any[] = this.ctx.cfg.STUN_URLS ? [{ urls: this.ctx.cfg.STUN_URLS.split(',').map(s => s.trim()).filter(Boolean) }] : [];
    if (this.ctx.cfg.TURN_SECRET && this.ctx.cfg.TURN_URLS) {
      const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:${c.tag}`;
      const credential = createHmac('sha1', this.ctx.cfg.TURN_SECRET).update(username).digest('base64');
      out.push({ urls: this.ctx.cfg.TURN_URLS.split(',').map(s => s.trim()).filter(Boolean), username, credential });
    }
    return out;
  }
  async remote(): Promise<{ minClientVersion: string; maintenance: { on: boolean; message?: string } | null }> {
    const rows = await this.ctx.db.query<any>(`select key, value from remote_config where key in ('minClientVersion', 'maintenance')`);
    const g = (k: string) => rows.find(r => r.key === k)?.value;
    return { minClientVersion: g('minClientVersion') || this.ctx.cfg.MIN_CLIENT_VERSION, maintenance: g('maintenance') || null };
  }

  // ── messages ─────────────────────────────────────────────────
  private async handle(c: Conn, m: any) {
    const L = c.lobby;
    switch (m.op) {
      case 'ping': return this.send(c, { op: 'pong', t: m.t });
      case 'lobbies': return this.send(c, { op: 'lobbies', list: this.listing(c) });
      case 'host': case 'lobby.create': return this.host(c, m);
      case 'join': case 'lobby.join': return this.join(c, String(m.room || '').toUpperCase().trim());
      case 'signal': {
        if (!L || !m.data || typeof m.data !== 'object') return;
        if (JSON.stringify(m.data).length > 16000) return;
        const to = c === L.host ? L.members.get(Number(m.to)) : Number(m.to) === 0 ? L.host : null;
        if (to) this.send(to, { op: 'signal', from: c.lid, data: m.data });
        return;
      }
      case 'meta': {
        if (!L || c !== L.host) return;
        if (typeof m.title === 'string') L.title = filterChat(m.title.slice(0, 40)).text;
        if (typeof m.public === 'boolean') L.public = m.public;
        if (typeof m.mode === 'string') L.mode = m.mode.slice(0, 20);
        if (Number.isInteger(m.players)) L.players = Math.max(1, Math.min(MAX_PLAYERS, m.players));
        if (Number.isInteger(m.max)) L.max = Math.max(2, Math.min(MAX_PLAYERS, m.max));
        return;
      }
      case 'kick': {
        if (!L || c !== L.host) return;
        const t = L.members.get(Number(m.id)); if (!t) return;
        L.kicked.add(t.user!.id);
        this.send(t, { op: 'error', msg: 'Removed by host.' }); this.send(t, { op: 'closed' });
        this.leaveLobby(t, false);
        return;
      }
      case 'leave': return this.leaveLobby(c, true);
      case 'start': return this.start(c);
      case 'end': return this.end(c, m);
      case 'queue': {
        const mode = QUEUE_MODES[m.mode] ? m.mode : 'duel';
        if (this.needsVerify(c.user!)) return this.send(c, { op: 'error', msg: 'Confirm your email to play online. Check your inbox.', code: 'verify' });
        this.unqueue(c); if (c.lobby) this.leaveLobby(c, true);
        c.queued = mode; c.queuedAt = Date.now();
        const key = `${mode}:${c.proto}`; // players only meet others on the same peer protocol
        const q = this.queue.get(key) || []; q.push(c); this.queue.set(key, q);
        this.send(c, { op: 'queued', mode, waiting: q.length });
        return this.matchmake();
      }
      case 'unqueue': this.unqueue(c); return this.send(c, { op: 'unqueued' });
      default: return;
    }
  }

  private newCode() { let s = ''; do { s = ''; for (let i = 0; i < 5; i++) s += LETTERS[randomInt(LETTERS.length)]; } while (this.lobbies.has(s)); return s; }
  private host(c: Conn, m: any, opts: { reserved?: Set<string>; ranked?: boolean; mode?: string; pending?: boolean } = {}) {
    if (m.claim) {
      const P = this.lobbies.get(String(m.claim));
      if (!P || P.host !== c || !P.pending) return this.send(c, { op: 'error', msg: 'That match is no longer available.' });
      P.pending = false; c.lobby = P; c.lid = 0;
      this.send(c, { op: 'hosted', room: P.code, id: 0, ice: this.ice(c), ranked: P.ranked, mode: P.mode });
      for (const w of P.waiting.splice(0)) if (w.ws.readyState === 1) this.join(w, P.code);
      return P;
    }
    if (this.needsVerify(c.user!)) return this.send(c, { op: 'error', msg: 'Confirm your email to play online. Check your inbox.', code: 'verify' });
    if (c.lobby) this.leaveLobby(c, true);
    this.unqueue(c);
    const L: Lobby = {
      code: this.newCode(), host: c, members: new Map(), seq: 0, createdAt: Date.now(),
      title: filterChat(String(m.title || `${c.user!.display_name}'s bloom`).slice(0, 40)).text, public: m.public !== false && !opts.reserved,
      mode: String(opts.mode || m.mode || 'custom').slice(0, 20), max: Math.max(2, Math.min(MAX_PLAYERS, Number(m.max) || MAX_PLAYERS)), players: 1,
      started: false, matchId: null, ticket: null, ranked: !!opts.ranked, reserved: opts.reserved || null, kicked: new Set(), seats: new Map(),
      pending: !!opts.pending, waiting: [],
    };
    this.lobbies.set(L.code, L); c.lobby = L; c.lid = 0;
    if (!L.pending) this.send(c, { op: 'hosted', room: L.code, id: 0, ice: this.ice(c), ranked: L.ranked });
    return L;
  }
  private join(c: Conn, code: string) {
    if (this.needsVerify(c.user!)) return this.send(c, { op: 'error', msg: 'Confirm your email to play online. Check your inbox.', code: 'verify' });
    const L = this.lobbies.get(code);
    if (!L) return this.send(c, { op: 'error', msg: 'No lobby with that code. It may have closed.' });
    if (L.host === c) return;
    if (L.pending) { if (!L.reserved || L.reserved.has(c.user!.id)) { if (!L.waiting.includes(c)) L.waiting.push(c); } else this.send(c, { op: 'error', msg: 'That lobby is private to its matched players.' }); return; }
    const uid = c.user!.id;
    if (L.kicked.has(uid)) return this.send(c, { op: 'error', msg: 'The host removed you from this lobby.' });
    if (L.host.proto !== c.proto) return this.send(c, { op: 'error', code: 'version', msg: L.host.proto > c.proto ? 'That lobby runs a newer version of Ozymandosis. Update the game to join it.' : 'That lobby runs an older version of Ozymandosis. The host needs to update.' });
    if (L.reserved && !L.reserved.has(uid)) return this.send(c, { op: 'error', msg: 'That lobby is private to its matched players.' });
    // one seat per account: a second device replaces the first
    for (const [id, o] of L.members) if (o.user!.id === uid) { this.send(o, { op: 'closed' }); o.lobby = null; L.members.delete(id); this.send(L.host, { op: 'left', id }); }
    if (L.members.size + 1 >= Math.min(L.max, MAX_PLAYERS) && !L.seats.has(uid)) return this.send(c, { op: 'error', msg: 'That lobby is full.' });
    if (c.lobby) this.leaveLobby(c, true);
    this.unqueue(c);
    const lid = L.seats.get(uid) ?? ++L.seq;
    L.seats.set(uid, lid); L.members.set(lid, c); c.lobby = L; c.lid = lid;
    const muted = !!(c.user!.muted_until && new Date(c.user!.muted_until).getTime() > Date.now());
    this.send(c, { op: 'joined', room: L.code, id: lid, ice: this.ice(c), hostName: L.host.user!.display_name, ranked: L.ranked });
    this.send(L.host, { op: 'peer', id: lid, name: c.user!.display_name, uid, sub: !!c.ent?.subscriber, rating: c.user!.rating, muted });
    if (L.started) this.reticket(L);
  }
  // Leaving before the match starts tells the host. During a match the players'
  // own connection decides: a signaling blip must not tear down a healthy game.
  private leaveLobby(c: Conn, notify: boolean) {
    const L = c.lobby; if (!L) return;
    c.lobby = null;
    if (L.host === c) {
      if (!L.started) for (const o of L.members.values()) { this.send(o, { op: 'closed' }); o.lobby = null; }
      else for (const o of L.members.values()) o.lobby = null;
      this.lobbies.delete(L.code);
    } else if (L.members.get(c.lid) === c) {
      L.members.delete(c.lid);
      if (notify && !L.started) this.send(L.host, { op: 'left', id: c.lid });
    }
  }
  private drop(c: Conn) { this.unqueue(c); this.leaveLobby(c, true); this.conns.delete(c); }

  // lobbies the asking client can actually join (same peer protocol)
  listing(c?: Conn) {
    const out = [];
    for (const L of this.lobbies.values()) if (L.public && !L.started && !L.reserved && L.members.size + 1 < L.max && (!c || L.host.proto === c.proto))
      out.push({ room: L.code, title: L.title, host: L.host.user!.display_name, hostSub: !!L.host.ent?.subscriber, players: Math.max(L.players, L.members.size + 1), max: L.max, mode: L.mode, age: Math.round((Date.now() - L.createdAt) / 1000) });
    return out.sort((a, b) => a.age - b.age).slice(0, 100);
  }

  // ── matches and tickets ──────────────────────────────────────
  private async start(c: Conn) {
    const L = c.lobby; if (!L || c !== L.host || L.started) return;
    L.started = true;
    const row = await this.ctx.db.one<any>(`insert into matches (code, mode, host_id, started_at) values ($1, $2, $3, now()) returning id`, [L.code, L.ranked ? 'ranked:' + L.mode : L.mode, c.user!.id]);
    L.matchId = row.id;
    await bump(this.ctx, 'matches_started');
    await this.reticket(L);
  }
  // Every player gets the same signed ticket: who is in the match, and until when each may play.
  private async reticket(L: Lobby) {
    const free = (await entitlements(this.ctx, L.host.user!)).freeMatchMinutes;
    const iat = Date.now(), started = L.matchId ? iat : iat;
    const players = [[0, L.host] as const, ...[...L.members.entries()]].map(([id, m]) => ({ id, uid: m.user!.id, name: m.user!.display_name, sub: !!m.ent?.subscriber, until: m.ent?.subscriber ? null : started + free * 60e3 }));
    // keep earlier deadlines when re-issuing (a rejoin must not reset the clock)
    const prev = L.ticket ? this.ctx.signer.verify(L.ticket) : null;
    if (prev) for (const p of players) { const o = prev.players.find((x: any) => x.uid === p.uid); if (o) p.until = o.until; }
    for (const p of players) if (L.matchId) await this.ctx.db.query(`insert into match_players (match_id, user_id, slot, until) values ($1, $2, $3, $4) on conflict (match_id, user_id) do nothing`, [L.matchId, p.uid, p.id, p.until ? new Date(p.until) : null]);
    L.ticket = this.ctx.signer.sign({ v: 1, mid: L.matchId, room: L.code, iat, exp: iat + 12 * 3600e3, host: L.host.user!.id, ranked: L.ranked, players });
    for (const m of [L.host, ...L.members.values()]) this.send(m, { op: 'ticket', ticket: L.ticket, match: L.matchId });
  }
  private async end(c: Conn, m: any) {
    const L = c.lobby; if (!L || c !== L.host || !L.matchId) return;
    const mid = L.matchId; L.matchId = null;
    const duration = Math.max(0, Math.min(24 * 3600, Math.round(Number(m.duration) || 0)));
    const winnerTeam = Number.isInteger(m.winnerTeam) ? m.winnerTeam : null;
    await this.ctx.db.query(`update matches set ended_at = now(), duration_s = $2, winner_team = $3 where id = $1 and ended_at is null`, [mid, duration, winnerTeam]);
    const results: { id: number; result: string }[] = Array.isArray(m.results) ? m.results.slice(0, MAX_PLAYERS) : [];
    const seat = new Map<number, string>([[0, L.host.user!.id], ...[...L.seats.entries()].map(([uid, lid]) => [lid, uid] as [number, string])]);
    const rows: { uid: string; won: boolean; rating: number }[] = [];
    for (const r of results) {
      const uid = seat.get(Number(r.id)); if (!uid || !['win', 'loss', 'draw'].includes(r.result)) continue;
      await this.ctx.db.query(`update match_players set result = $3 where match_id = $1 and user_id = $2`, [mid, uid, r.result]);
      const u = await this.ctx.db.one<any>(`update users set matches = matches + 1, wins = wins + $2 where id = $1 returning rating`, [uid, r.result === 'win' ? 1 : 0]);
      if (u) rows.push({ uid, won: r.result === 'win', rating: u.rating });
    }
    // Elo for ranked matches: every winner against the average loser, and vice versa
    if (L.ranked && rows.some(r => r.won) && rows.some(r => !r.won)) {
      const avg = (a: typeof rows) => a.reduce((s, r) => s + r.rating, 0) / a.length;
      const W = rows.filter(r => r.won), Lo = rows.filter(r => !r.won), aw = avg(W), al = avg(Lo), K = 24;
      for (const r of W) await this.ctx.db.query('update users set rating = rating + $2 where id = $1', [r.uid, Math.round(K * (1 - 1 / (1 + Math.pow(10, (al - r.rating) / 400))))]);
      for (const r of Lo) await this.ctx.db.query('update users set rating = greatest(100, rating - $2) where id = $1', [r.uid, Math.round(K * (1 / (1 + Math.pow(10, (aw - r.rating) / 400))))]);
    }
    await bump(this.ctx, 'matches_ended');
  }

  // ── quick match ──────────────────────────────────────────────
  private unqueue(c: Conn) {
    if (!c.queued) return;
    const key = `${c.queued}:${c.proto}`, q = this.queue.get(key); if (q) this.queue.set(key, q.filter(x => x !== c));
    c.queued = null;
  }
  matchmake() {
    const now = Date.now();
    for (const [key, q0] of this.queue) {
      const mode = key.split(':')[0], spec = QUEUE_MODES[mode];
      let q = q0.filter(c => c.ws.readyState === 1 && c.queued === mode);
      q.sort((a, b) => a.user!.rating - b.user!.rating);
      while (q.length >= spec.min) {
        // widen the acceptable rating gap the longer the first player has waited
        const first = q[0], wait = (now - first.queuedAt) / 1000, gap = 150 + wait * 12;
        const group = q.filter(c => Math.abs(c.user!.rating - first.user!.rating) <= gap).slice(0, spec.size);
        const oldest = Math.max(...group.map(c => (now - c.queuedAt) / 1000));
        if (group.length < spec.size && !(group.length >= spec.min && oldest >= spec.waitMin)) break;
        q = q.filter(c => !group.includes(c));
        // a subscriber hosts when possible, so free time limits never end the match for everyone
        const host = group.find(c => c.ent?.subscriber) || group[0];
        for (const c of group) c.queued = null;
        const L = this.host(host, { title: 'Quick match' }, { reserved: new Set(group.map(c => c.user!.id)), ranked: true, mode, pending: true });
        if (!L) continue;
        L.max = group.length; L.players = group.length;
        this.send(host, { op: 'matched', room: L.code, role: 'host', mode, players: group.map(c => ({ name: c.user!.display_name, rating: c.user!.rating })) });
        for (const c of group) if (c !== host) this.send(c, { op: 'matched', room: L.code, role: 'guest', mode });
      }
      this.queue.set(key, q);
    }
  }

  // ── pushes from the rest of the service ──────────────────────
  async refreshUser(userId: string) {
    const u = await this.ctx.db.one<UserRow>('select * from users where id = $1', [userId]);
    for (const c of this.conns) if (c.user?.id === userId) {
      if (!u || u.status === 'banned' || u.status === 'deleted') { this.kick(c, 'This account can no longer play online.'); continue; }
      c.user = u; c.ent = await entitlements(this.ctx, u);
      if (u.status === 'suspended') { this.kick(c, `Your account is suspended until ${new Date(u.suspended_until!).toUTCString()}.`); continue; }
      this.send(c, { op: 'me', user: this.pub(c), ent: c.ent, config: { needsVerify: this.needsVerify(u), mutedUntil: u.muted_until } });
    }
  }
  kickUser(userId: string, msg: string) { for (const c of this.conns) if (c.user?.id === userId) this.kick(c, msg); }
  private kick(c: Conn, msg: string) { this.send(c, { op: 'kicked', msg }); try { c.ws.close(4003, 'kicked'); } catch { /* */ } }
  broadcast(o: object, filter?: (c: Conn) => boolean) { for (const c of this.conns) if (c.user && (!filter || filter(c))) this.send(c, o); }
  announce(a: { audience: string } & Record<string, unknown>) {
    this.broadcast({ op: 'announcement', announcement: a }, c => a.audience === 'all' || (a.audience === 'subscribers') === !!c.ent?.subscriber);
  }
  stats() {
    let online = 0, inLobby = 0, queued = 0;
    for (const c of this.conns) if (c.user) { online++; if (c.lobby) inLobby++; if (c.queued) queued++; }
    const lobbies = [...this.lobbies.values()];
    return { online, inLobby, queued, lobbies: lobbies.length, matches: lobbies.filter(l => l.started).length };
  }
}
