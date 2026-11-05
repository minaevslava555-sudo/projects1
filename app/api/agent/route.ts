import { isAdminSession } from "@/lib/admin-auth";
import { MODELS, getAgentConfig, saveAgentConfig } from "@/lib/agent-store";

async function unauthorized() {
  return Response.json({ error: "Нужна авторизация" }, { status: 401 });
}

export async function GET() {
  if (!(await isAdminSession())) return unauthorized();
  const config = await getAgentConfig();
  return Response.json({ ...config, models: MODELS });
}

export async function POST(request: Request) {
  if (!(await isAdminSession())) return unauthorized();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const config = await saveAgentConfig(body);
  return Response.json({ ...config, models: MODELS });
}
