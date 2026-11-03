import { MODELS, getAgentConfig, saveAgentConfig } from "@/lib/agent-store";

export async function GET() {
  const config = await getAgentConfig();
  return Response.json({ ...config, models: MODELS });
}

export async function POST(request: Request) {
  const body = await request.json();
  const config = await saveAgentConfig(body);
  return Response.json({ ...config, models: MODELS });
}
