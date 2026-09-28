// Key rotation (operator commands, see src/cli.ts and docs/OPERATIONS.md).
import type { Db } from '../db/index.js';
import type { Secrets } from '../lib/crypto.js';
import { newTicketKey } from '../app.js';

// A new ticket key signs from now on; the others are retired (they keep verifying
// tickets already issued for a day, then leave the ring).
export async function rotateTicketKey(db: Db, secrets: Secrets): Promise<string> {
  const id = await newTicketKey(db, secrets);
  await db.query(`update server_keys set retired_at = now() where id <> $1 and retired_at is null`, [id]);
  await db.query(`insert into audit_log (action, target) values ('ops.ticket_key_rotated', $1)`, [id]);
  return id;
}

// Re-encrypt everything sealed with an older SECRET_KEY under the current one.
// Anything no configured key opens is counted, not fatal: keep SECRET_KEY_PREVIOUS
// until `failed` is zero.
export async function rewrapSecrets(db: Db, secrets: Secrets): Promise<{ totp: number; keys: number; failed: number }> {
  let totp = 0, keys = 0, failed = 0;
  const rewrap = (box: string) => { try { return secrets.encrypt(secrets.decrypt(box)); } catch { failed++; return null; } };
  for (const u of await db.query<any>(`select id, totp_secret_enc from users where totp_secret_enc is not null`)) {
    if (!secrets.stale(u.totp_secret_enc)) continue;
    const box = rewrap(u.totp_secret_enc); if (!box) continue;
    await db.query('update users set totp_secret_enc = $2 where id = $1', [u.id, box]); totp++;
  }
  for (const k of await db.query<any>(`select id, private_enc from server_keys`)) {
    if (!secrets.stale(k.private_enc)) continue;
    const box = rewrap(k.private_enc); if (!box) continue;
    await db.query('update server_keys set private_enc = $2 where id = $1', [k.id, box]); keys++;
  }
  await db.query(`insert into audit_log (action, detail) values ('ops.secrets_rewrapped', $1)`, [JSON.stringify({ totp, keys, failed, kid: secrets.kid })]);
  return { totp, keys, failed };
}
