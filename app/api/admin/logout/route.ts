import { ADMIN_COOKIE } from "@/lib/admin-auth";
import { cookies } from "next/headers";

export async function POST() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  return Response.json({ ok: true });
}
