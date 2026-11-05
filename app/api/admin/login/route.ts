import {
  ADMIN_COOKIE,
  createSessionToken,
  getAdminCredentials,
  sessionCookieOptions,
  verifyCredentials,
} from "@/lib/admin-auth";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  if (!getAdminCredentials()) {
    return Response.json({ error: "Админка не настроена" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const login = typeof raw.login === "string" ? raw.login : "";
  const password = typeof raw.password === "string" ? raw.password : "";

  if (!verifyCredentials(login, password)) {
    return Response.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  const token = createSessionToken();
  if (!token) {
    return Response.json({ error: "Админка не настроена" }, { status: 500 });
  }

  const store = await cookies();
  store.set(ADMIN_COOKIE, token, sessionCookieOptions());
  return Response.json({ ok: true });
}
