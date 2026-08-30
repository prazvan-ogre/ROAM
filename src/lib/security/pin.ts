import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Server-only. No new dependency -- node:crypto's scrypt is a fine fit
// for a short numeric PIN paired with an unverified phone number
// (creator_accounts, app/api/account/route.ts): salted, slow to brute
// force, and never round-tripped to the client.
const KEY_LENGTH = 64;

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(pin, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
