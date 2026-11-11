import { randomBytes } from "crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Short client-facing reference, e.g. HV-A1B2C3. */
export function generateOrderRef(): string {
  const bytes = randomBytes(6);
  let body = "";
  for (let i = 0; i < 6; i += 1) {
    body += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `HV-${body}`;
}
