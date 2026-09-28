// Minimal-PII logging. Logs carry what debugging needs (route, status,
// latency, a pseudonymous user tag, coarse client) and nothing that
// identifies a person: no emails, no IP addresses, no tokens, no names.
import type { Secrets } from './crypto.js';

export const REDACT_PATHS = [
  'req.headers.authorization', 'req.headers.cookie', 'req.headers["x-forwarded-for"]', 'req.headers["cf-connecting-ip"]', 'req.headers["x-real-ip"]',
  'res.headers["set-cookie"]', '*.email', '*.password', '*.token', '*.code', '*.secret', '*.totp', '*.ip', '*.remoteAddress', '*.remotePort',
];

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /\b(?:Bearer\s+)?[A-Za-z0-9_-]{32,}\b/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi;
const PATHS = /(?:[A-Za-z]:)?(?:\/|\\)(?:Users|home)(?:\/|\\)[^/\\\s'")]+/g;

// Scrub free text that came from a client (crash messages, stacks, bug reports).
export function scrub(s: string | null | undefined, max = 20000): string {
  if (!s) return '';
  return String(s).slice(0, max).replace(EMAIL, '<email>').replace(PATHS, '<home>').replace(IPV4, '<ip>').replace(IPV6, '<ip>').replace(BEARER, m => (m.length > 60 ? '<token>' : m));
}

// "Chrome on Android" — enough to reproduce a bug, not enough to fingerprint.
export function coarseClient(ua: string | undefined): string {
  if (!ua) return 'unknown';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'other';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Electron/.test(ua) ? 'Desktop' : 'other';
  return `${br} on ${os}`;
}

export const userTag = (secrets: Secrets, id: string | null | undefined) => (id ? 'u_' + secrets.pseudonym(id) : '-');
