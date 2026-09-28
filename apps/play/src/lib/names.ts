// Display names and chat: normalisation, a light profanity/slur filter, and
// reserved words. Deliberately conservative; moderators handle the rest.

// Lowercased stems. Matching happens on a "skeleton" (leetspeak and repeats
// folded) so obvious evasions fail too. Kept short and generic on purpose.
// STEMS match anywhere; WORDS only as a whole word (avoids the Scunthorpe problem: grape, spice, peacock).
const STEMS = ['fuck', 'shit', 'nigg', 'fagot', 'faggot', 'retard', 'hitler', 'kike', 'trany', 'whore', 'motherfuck'];
const WORDS = ['cunt', 'rape', 'rapist', 'nazi', 'spic', 'chink', 'slut', 'cock', 'dick', 'pusy', 'porn', 'kys', 'fag', 'twat', 'wank'];
const RESERVED_EXACT = ['admin', 'moderator', 'mod', 'staf', 'suport', 'system', 'server', 'host', 'root'];
const RESERVED_ANY = ['admin', 'moderator', 'ozymandosis', 'oficial', 'staf'];
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'i' };

export function skeleton(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[0-9@$!|]/g, c => LEET[c] ?? c).replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
}
export const nameKey = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const hits = (s: string) => {
  const k = skeleton(s); if (STEMS.some(w => k.includes(skeleton(w)))) return true;
  const words = s.toLowerCase().split(/[^\p{L}\p{N}@$!|]+/u).map(skeleton).filter(Boolean);
  return words.some(w => WORDS.includes(w));
};

export function validateName(raw: string): { ok: true; name: string } | { ok: false; why: string } {
  const name = String(raw || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > 18) return { ok: false, why: 'Names are 3 to 18 characters.' };
  if (!/^[\p{L}\p{N} _.'-]+$/u.test(name)) return { ok: false, why: 'Use letters, numbers, spaces and . _ \' - only.' };
  if (hits(name)) return { ok: false, why: 'That name is not allowed.' };
  const k = skeleton(name);
  if (RESERVED_EXACT.includes(k) || RESERVED_ANY.some(r => k.includes(r))) return { ok: false, why: 'That name is reserved.' };
  return { ok: true, name };
}

// Chat: mask blocked words, keep the rest. Returns the cleaned text and whether anything was masked.
export function filterChat(text: string): { text: string; masked: boolean } {
  let masked = false;
  const out = String(text || '').slice(0, 140).replace(/\S+/g, w => { if (hits(w)) { masked = true; return '•'.repeat(Math.min(8, w.length)); } return w; });
  return { text: out, masked };
}
