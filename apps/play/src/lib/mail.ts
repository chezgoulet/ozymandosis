// Transactional mail. In development (no SMTP_URL) messages are kept in memory
// and printed with the link redacted to the path, so nothing personal lands in logs.
import nodemailer from 'nodemailer';

export interface Mail { to: string; subject: string; text: string; html?: string }
export interface Mailer { send(m: Mail): Promise<void>; outbox: Mail[] }

export function makeMailer(url: string | undefined, from: string, log: (s: string) => void): Mailer {
  const outbox: Mail[] = [];
  if (!url) return { outbox, async send(m) { outbox.push(m); if (outbox.length > 50) outbox.shift(); log(`mail (dev outbox): ${m.subject}`); } };
  const t = nodemailer.createTransport(url);
  return { outbox, async send(m) { await t.sendMail({ from, ...m }); } };
}

// The living title can't move in an email, so mail carries a still of it (tools/render-title.cjs).
let titleImage = '';
export const setTitleImage = (url: string) => { titleImage = url; };
const wrap = (title: string, body: string, cta?: { href: string; label: string }) => `<!doctype html><html><body style="margin:0;background:#02070a;color:#d4ece7;font:16px/1.5 system-ui,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
${titleImage ? `<img src="${titleImage}" width="354" height="60" alt="Ozymandosis" style="display:block;width:354px;max-width:100%;height:auto;border:0">` : '<div style="font:700 22px Georgia,serif;letter-spacing:.08em;color:#9ff6e4">OZYMANDOSIS</div>'}
<p style="margin:6px 0 0;font-size:12px;font-weight:700;color:#ffd28a;letter-spacing:.12em">BETA</p>
<h1 style="font-size:20px;margin:24px 0 8px">${title}</h1><p>${body}</p>
${cta ? `<p style="margin:28px 0"><a href="${cta.href}" style="background:#1c5d58;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none">${cta.label}</a></p><p style="font-size:13px;color:#6b8d88">Or paste this link: ${cta.href}</p>` : ''}
<p style="font-size:13px;color:#6b8d88;margin-top:32px">If you did not ask for this, you can ignore this email. Ozymandosis is in beta.</p></div></body></html>`;

export const templates = {
  verify: (link: string) => ({ subject: 'Confirm your Ozymandosis email', text: `Confirm your email: ${link}\nThe link works for 24 hours.`, html: wrap('Confirm your email', 'Tap below to confirm this address for your Ozymandosis account. The link works for 24 hours.', { href: link, label: 'Confirm email' }) }),
  reset: (link: string) => ({ subject: 'Reset your Ozymandosis password', text: `Reset your password: ${link}\nThe link works for 1 hour.`, html: wrap('Reset your password', 'Tap below to choose a new password. The link works for one hour.', { href: link, label: 'Choose a new password' }) }),
  mfaOn: () => ({ subject: 'Two-factor sign-in is on', text: 'Two-factor authentication was turned on for your Ozymandosis account. If this was not you, reset your password now.', html: wrap('Two-factor sign-in is on', 'Your authenticator app is now required to sign in. Keep your recovery codes somewhere safe. If this was not you, reset your password now.') }),
  mfaOff: () => ({ subject: 'Two-factor sign-in was turned off', text: 'Two-factor authentication was turned off for your Ozymandosis account. If this was not you, reset your password now.', html: wrap('Two-factor sign-in was turned off', 'If this was not you, reset your password now and turn it back on.') }),
};
