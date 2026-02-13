import "server-only";
import { timingSafeEqual } from "crypto";

/**
 * Verify CRON_SECRET from an Authorization: Bearer <token> header.
 * Uses timing-safe comparison to prevent timing attacks.
 * Returns false if CRON_SECRET is not configured (fail-closed).
 */
export function verifyCronSecret(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authHeader) return false;

  const token = authHeader.replace("Bearer ", "");
  if (Buffer.byteLength(token) !== Buffer.byteLength(secret)) return false;

  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}
