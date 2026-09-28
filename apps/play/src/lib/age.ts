// Age: a neutral month-and-year question at sign-up (or before first online play
// for accounts made through a sign-in provider). Only a band is stored.
//   under 13   no account (COPPA; we do not collect parental consent)
//   13 to 15   quick chat only: preset phrases, and they never receive free text
//   16 and up  free chat (filtered), unless they choose quick chat or none
// The birth month and year are used for the calculation and then discarded.
export const MIN_AGE = 13;
export const FREE_CHAT_AGE = 16;
export type AgeBand = '13-15' | '16-17' | 'adult';

// Age in whole years, counting a birthday in the current month as not yet reached (the cautious reading).
export function ageFrom(year: number, month: number, now = new Date()): number | null {
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || year < y - 120 || year > y) return null;
  return y - year - (m <= month ? 1 : 0);
}
export function bandOf(age: number): AgeBand | null {
  if (age < MIN_AGE) return null;
  return age < FREE_CHAT_AGE ? '13-15' : age < 18 ? '16-17' : 'adult';
}
export const freeChatAllowed = (band: string | null | undefined) => band === '16-17' || band === 'adult';
