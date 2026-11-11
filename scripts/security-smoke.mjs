/**
 * Local smoke checks for booking security helpers (no network Turnstile).
 */
import { createHmac, randomUUID, timingSafeEqual } from "crypto";

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

function detectImageMagic(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  )
    return "png";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP")
    return "webp";
  return null;
}

const secret = "local-dev-booking-draft-secret";
const draftId = randomUUID();
const exp = Math.floor(Date.now() / 1000) + 3600;
const body = b64url(JSON.stringify({ draftId, exp }));
const sig = b64url(createHmac("sha256", secret).update(body).digest());
const token = `${body}.${sig}`;

const [b, s] = token.split(".");
const expected = b64url(createHmac("sha256", secret).update(b).digest());
const okSig = timingSafeEqual(Buffer.from(s), Buffer.from(expected));
const payload = JSON.parse(fromB64url(b).toString("utf8"));

const jpeg = detectImageMagic(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]));
const png = detectImageMagic(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
const webp = detectImageMagic(Buffer.from("RIFF....WEBP", "ascii"));
const bad = detectImageMagic(Buffer.from("not-an-image!!"));

const checks = [
  ["hmac verify", okSig && payload.draftId === draftId],
  ["jpeg magic", jpeg === "jpeg"],
  ["png magic", png === "png"],
  ["webp magic", webp === "webp"],
  ["reject non-image", bad === null],
  ["idem key shape", /^[A-Za-z0-9_-]{8,128}$/.test(randomUUID())],
];

let failed = 0;
for (const [name, pass] of checks) {
  console.log(`${pass ? "OK" : "FAIL"}  ${name}`);
  if (!pass) failed += 1;
}
process.exit(failed ? 1 : 0);
