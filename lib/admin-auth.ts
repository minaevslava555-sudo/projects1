import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "admin_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  const size = Math.max(a.length, b.length, 1);
  const x = Buffer.alloc(size);
  const y = Buffer.alloc(size);
  a.copy(x);
  b.copy(y);
  return timingSafeEqual(x, y) && a.length === b.length;
}

export function getAdminCredentials() {
  const login = process.env.ADMIN_LOGIN?.trim() ?? "";
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!login || !password) return null;
  return { login, password };
}

export function verifyCredentials(login: string, password: string) {
  const creds = getAdminCredentials();
  if (!creds) return false;
  return safeEqual(login, creds.login) && safeEqual(password, creds.password);
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function createSessionToken() {
  const creds = getAdminCredentials();
  if (!creds) return null;
  const payload = String(Date.now() + SESSION_MS);
  return `${payload}.${sign(payload, `${creds.login}:${creds.password}`)}`;
}

export function verifySessionToken(token: string | undefined) {
  const creds = getAdminCredentials();
  if (!creds || !token) return false;
  const sep = token.indexOf(".");
  if (sep <= 0) return false;
  const payload = token.slice(0, sep);
  const signature = token.slice(sep + 1);
  const exp = Number(payload);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = sign(payload, `${creds.login}:${creds.password}`);
  return safeEqual(signature, expected);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.VERCEL === "1",
    path: "/",
    maxAge: SESSION_MS / 1000,
  };
}

export async function isAdminSession() {
  const store = await cookies();
  return verifySessionToken(store.get(ADMIN_COOKIE)?.value);
}
