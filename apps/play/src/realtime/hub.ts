// The realtime hub: presence, lobbies, quick match, and WebRTC signaling.
// It introduces players and vouches for them (signed match tickets); the
// match itself runs peer to peer between the players, encrypted, and never
// passes through this server.
//
// Protocol (JSON over one WebSocket per client; the first message must be auth):
//   → auth {token, version, proto, platform}            ← hello {user, ent, ice, key, announcements, config}
//   → host {title?, public?, mode?, max?}         ← hosted {room, id: 0, ice}
//   → host {resume: room}                         ← hosted {room, id: 0, ice, resumed}  (host back after a signaling drop)
//   → join {room}                                 ← joined {room, id, ice, hostName}; host ← peer {id, name, uid, sub, muted}
//   → signal {to, data}                           ← signal {from, data}      (host ↔ guest only)
//   → meta {title?, public?, mode?, players?, max?} (host: lobby listing)
//   → lobbies                                     ← lobbies {list}
//   → kick {id} | leave                            ← left {id} | closed
//   → start                                       ← ticket {ticket, match}  (to everyone in the lobby)
//   → end {match, kind, winnerTeam, results, audit} (every player reports; results.ts settles) ← result {match, status, rated, result, delta}
//   → queue {mode} | unqueue                      ← queued {mode} | matched {room, role, mode}
//   → chat {text} | chat {q}                     ← chat {from, uid, text, q?, at}  (lobby and match chat, filtered here)
//   server pushes: me {user, ent}, announcement {...}, maintenance {message}, kicked {msg}, error {msg}
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { createHmac, randomInt } from 'node:crypto';
import type { Ctx, UserRow } from '../context.js';
import { entitlements, sessionUser, bump, type Entitlements } from '../auth/service.js';
import { userTag } from '../lib/privacy.js';
import { filterChat } from '../lib/names.js';
import { activeAnnouncements } from '../routes/public.js';
import { recordClaim, settle, dueMatches, type Settled } from './results.js';
import { freeChatAllowed } from '../lib/age.js';

// Quick chat: the only messages players under 16 send or receive.
export const QUICK_CHAT = ['Hello!', 'Good luck, have fun', 'Good game', 'Well played', 'Nice!', 'Oops', 'Thanks', 'Sorry', 'One moment', 'Let’s go', 'Help!', 'Attack here', 'Defend here', 'Rematch?'];
const CHAT_KEEP = 100, CHAT_LOG_TTL = 30 * 60e3;
interface ChatLine { at: string; uid: string; from: string; text: string }

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_PLAYERS = 6;
const HOST_GRACE_MS = 120e3; // a started match waits this long for its host to reconnect to signaling
const QUEUE_MODES: Record<string, { size: number; min: number; waitMin: number }> = { duel: { size: 2, min: 2, waitMin: 0 }, ffa: { size: 4, min: 3, waitMin: 45 }, team: { size: 4, min: 4, waitMin: 0 } };
const cmpVersion = (a: string, b: string) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };

interface Conn {
  ws: WebSocket; user: UserRow | null; ent: Entitlements | null; tag: string;
  lobby: Lobby | null; lid: number; bucket: number; last: number; version: string; proto: number; platform: string; queued: string | null; queuedAt: number; chatAt: number[];
}
interface Lobby {
  code: string; host: Conn; members: Map<number, Conn>; seq: number; createdAt: number;
  title: string; public: boolean; mode: string; max: number; players: number;
  started: boolean; matchId: string | null; ticket: string | null; ranked: boolean; reserved: Set<string> | null; kicked: Set<string>;
  seats: Map<string, number>; // user id → lobby id, so a player who drops and rejoins keeps their seat
  pending: boolean; waiting: Conn[]; // quick match: guests wait until the chosen host claims the lobby
  hostGone: number; goneTimer: NodeJS.Timeout | null; // the host's signaling dropped mid-match
  chat: ChatLine[]; // recent chat, held in memory only: evidence for reports about this lobby or match
}

export class Hub {
  conns = new Set<Conn>();
  lobbies = new Map<string, Lobby>();
  queue = new Map<string, Conn[]>();
  // chat of lobbies that have closed, kept a little while for reports filed after the match
  chatLogs = new Map<string, { lines: ChatLine[]; until: number }>();
  private timer: NodeJS.Timeout;
  private ticks = 0;
  constructor(private ctx: Ctx) {
    this.timer = setInterval(() => { this.matchmake(); this.heartbeat(); if (++this.ticks % 5 === 0) void this.settleDue(); }, 2000);
    this.timer.unref();
  }
  async settleDue() {
    const now = Date.now(); for (const [k, e] of this.chatLogs) if (e.until < now) this.chatLogs.delete(k);
    try { for (const id of await dueMatches(this.ctx)) this.announceResult(await settle(this.ctx, id)); }
    catch (e: any) { this.ctx.log.error({ err: { message: e.message } }, 'settle failed'); }
  }
  private announceResult(r: Settled | null) {
    if (!r) return;
    for (const p of r.players) for (const c of this.conns) if (c.user?.id === p.uid)
      this.send(c, { op: 'result', match: r.match, status: r.status, rated: r.rated, reason: r.reason, result: p.result, delta: p.delta });
    // ratings changed: refresh what connected players see
    if (r.rated) for (const p of r.players) void this.refreshUser(p.uid);
  }
  close() { clearInterval(this.timer); for (const c of this.conns) try { c.ws.close(1001, 'server shutting down'); } catch { /* */ } }

  routes(app: FastifyInstance) {
    app.get('/ws', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => this.accept(socket, req));
  }

  // ── connection lifecycle ─────────────────────────────────────
  private accept(ws: WebSocket, req: FastifyRequest) {
    const c: Conn = { ws, user: null, ent: null, tag: '-', lobby: null, lid: -1, bucket: 60, last: Date.now(), version: '0', proto: 1, platform: '', queued: null, queuedAt: 0, chatAt: [] };
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
    if (!a.user.age_band) { this.send(c, { op: 'error', code: 'age', msg: 'Before you play online, tell us your age.' }); c.ws.close(4012, 'age'); return; }
    if (cfg.maintenance?.on && a.user.role === 'player') { this.send(c, { op: 'maintenance', msg: cfg.maintenance.message || 'Online play is down for maintenance. Back soon.' }); c.ws.close(4011, 'maintenance'); return; }
    c.user = a.user; c.tag = userTag(this.ctx.secrets, a.user.id); c.ent = await entitlements(this.ctx, a.user);
    this.send(c, {
      op: 'hello', user: this.pub(c), ent: c.ent, ice: this.ice(c),
      key: { kid: this.ctx.signer.id, x: this.ctx.signer.publicRaw },
      announcements: await activeAnnouncements(this.ctx, c.ent.subscriber),
      config: { freeMatchMinutes: c.ent.freeMatchMinutes, needsVerify: this.needsVerify(a.user), mutedUntil: a.user.muted_until, chat: this.chatMode(a.user), quickChat: QUICK_CHAT },
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
      case 'chat': return this.chat(c, m);
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
    if (m.resume) {
      const L = this.lobbies.get(String(m.resume));
      if (!L || !L.hostGone || L.host.user!.id !== c.user!.id) return this.send(c, { op: 'error', code: 'resume', msg: 'That match is no longer on the server.' });
      if (c.lobby && c.lobby !== L) this.leaveLobby(c, true);
      if (L.goneTimer) clearTimeout(L.goneTimer);
      L.host = c; L.hostGone = 0; L.goneTimer = null; c.lobby = L; c.lid = 0;
      this.send(c, { op: 'hosted', room: L.code, id: 0, ice: this.ice(c), ranked: L.ranked, mode: L.mode, resumed: true });
      if (L.ticket) this.send(c, { op: 'ticket', ticket: L.ticket, match: L.matchId });
      return L;
    }
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
      pending: !!opts.pending, waiting: [], hostGone: 0, goneTimer: null, chat: [],
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
    if (L.hostGone) return this.send(c, { op: 'error', code: 'host_away', msg: 'The host is reconnecting. Trying again…' });
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
  private leaveLobby(c: Conn, notify: boolean, dropped = false) {
    const L = c.lobby; if (!L) return;
    c.lobby = null;
    if (L.host === c && dropped && L.started) {
      // the host's signaling dropped mid-match: the match itself runs peer to peer, so keep
      // the lobby for the host to resume (and for guests to rejoin through) for a while
      L.hostGone = Date.now();
      L.goneTimer = setTimeout(() => { if (L.hostGone && this.lobbies.get(L.code) === L) { for (const o of L.members.values()) o.lobby = null; this.closeLobby(L); } }, HOST_GRACE_MS);
      L.goneTimer.unref?.();
      return;
    }
    if (L.host === c) {
      if (L.goneTimer) clearTimeout(L.goneTimer);
      if (!L.started) for (const o of L.members.values()) { this.send(o, { op: 'closed' }); o.lobby = null; }
      else for (const o of L.members.values()) o.lobby = null;
      this.closeLobby(L);
    } else if (L.members.get(c.lid) === c) {
      L.members.delete(c.lid);
      if (notify && !L.started) this.send(L.host, { op: 'left', id: c.lid });
    }
  }
  private closeLobby(L: Lobby) {
    this.lobbies.delete(L.code);
    if (L.chat.length) { const e = { lines: L.chat, until: Date.now() + CHAT_LOG_TTL }; this.chatLogs.set('room:' + L.code, e); if (L.matchId) this.chatLogs.set(L.matchId, e); }
  }

  // ── chat ─────────────────────────────────────────────────────
  // Everyone's own choice (all / quick / off) and age decide what they send and see.
  chatMode(u: UserRow): 'all' | 'quick' | 'off' { return u.chat === 'off' ? 'off' : u.chat === 'all' && freeChatAllowed(u.age_band) ? 'all' : 'quick'; }
  private chat(c: Conn, m: any) {
    const L = c.lobby, u = c.user!; if (!L) return;
    const mode = this.chatMode(u);
    if (mode === 'off') return this.send(c, { op: 'error', code: 'chat', msg: 'Chat is off in your settings.' });
    if (u.muted_until && new Date(u.muted_until).getTime() > Date.now()) return this.send(c, { op: 'error', code: 'muted', msg: `You are muted until ${new Date(u.muted_until).toUTCString()}.` });
    const now = Date.now(); c.chatAt = c.chatAt.filter(t => now - t < 10e3);
    if (c.chatAt.length >= 6) return this.send(c, { op: 'error', code: 'chat', msg: 'Slow down a little.' });
    let text: string, q: number | undefined;
    if (Number.isInteger(m.q) && m.q >= 0 && m.q < QUICK_CHAT.length) { q = m.q; text = QUICK_CHAT[m.q]; }
    else {
      if (mode !== 'all') return this.send(c, { op: 'error', code: 'chat', msg: 'Quick chat only.' });
      text = filterChat(String(m.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 140)).text;
      if (!text) return;
    }
    c.chatAt.push(now);
    const line: ChatLine = { at: new Date(now).toISOString(), uid: u.id, from: u.display_name, text };
    L.chat.push(line); if (L.chat.length > CHAT_KEEP) L.chat.shift();
    const out = { op: 'chat', from: u.display_name, uid: u.id, text, q, at: line.at };
    for (const o of [L.host, ...L.members.values()]) {
      if (!o.user || o.ws.readyState !== 1) continue;
      const om = this.chatMode(o.user);
      if (om === 'off' || (om === 'quick' && q === undefined)) continue;
      this.send(o, out);
    }
  }
  // What was said in a match (or lobby), for a report about it.
  chatLog(matchOrRoom: string): ChatLine[] | null {
    for (const L of this.lobbies.values()) if (L.matchId === matchOrRoom || L.code === matchOrRoom) return L.chat.slice(-30);
    const e = this.chatLogs.get(matchOrRoom) || this.chatLogs.get('room:' + matchOrRoom);
    return e && e.until > Date.now() ? e.lines.slice(-30) : null;
  }

  private drop(c: Conn) { this.unqueue(c); this.leaveLobby(c, true, true); this.conns.delete(c); }

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
    // builds before protocol 2 sent only the host's view, keyed by lobby seat
    if (!m.match) {
      const L = c.lobby; if (!L || c !== L.host || !L.matchId) return;
      const seat = new Map<number, string>([[0, L.host.user!.id], ...[...L.seats.entries()].map(([uid, lid]) => [lid, uid] as [number, string])]);
      m = { match: L.matchId, kind: 'final', winnerTeam: m.winnerTeam, results: (Array.isArray(m.results) ? m.results : []).map((r: any) => ({ uid: seat.get(Number(r?.id)), result: r?.result })) };
    }
    const r = await recordClaim(this.ctx, c.user!.id, m);
    if (r.ok && r.complete) this.announceResult(await settle(this.ctx, r.match!));
    if (r.ok) await bump(this.ctx, 'match_claims');
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
      this.send(c, { op: 'me', user: this.pub(c), ent: c.ent, config: { needsVerify: this.needsVerify(u), mutedUntil: u.muted_until, chat: this.chatMode(u) } });
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
