import {
  clearChatHistory,
  getAgentConfig,
  getChatHistory,
  saveChatHistory,
  type ChatMessage,
} from "@/lib/agent-store";
import { askAgent } from "@/lib/openai-agent";
import { NextRequest } from "next/server";

const SESSION_RE = /^web-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 4000;

function readSession(value: unknown): string | null {
  return typeof value === "string" && SESSION_RE.test(value) ? value : null;
}

export async function GET(request: NextRequest) {
  const sessionId = readSession(request.nextUrl.searchParams.get("sessionId"));
  if (!sessionId) {
    return Response.json({ error: "Некорректная сессия" }, { status: 400 });
  }

  const [config, messages] = await Promise.all([getAgentConfig(), getChatHistory(sessionId)]);
  return Response.json({ messages, model: config.model });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const sessionId = readSession(raw.sessionId);
  const text = typeof raw.text === "string" ? raw.text.trim() : "";

  if (!sessionId) {
    return Response.json({ error: "Некорректная сессия" }, { status: 400 });
  }
  if (!text || text.length > MAX_TEXT) {
    return Response.json(
      { error: `Сообщение должно быть от 1 до ${MAX_TEXT} символов` },
      { status: 400 },
    );
  }

  try {
    const [config, history] = await Promise.all([getAgentConfig(), getChatHistory(sessionId)]);
    const answer = await askAgent(config, history, text);
    const messages: ChatMessage[] = [
      ...history,
      { role: "user", content: text },
      { role: "assistant", content: answer },
    ];
    await saveChatHistory(sessionId, messages);
    return Response.json({ messages, model: config.model });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось ответить";
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const sessionId = readSession(raw.sessionId);
  if (!sessionId) {
    return Response.json({ error: "Некорректная сессия" }, { status: 400 });
  }

  await clearChatHistory(sessionId);
  const config = await getAgentConfig();
  return Response.json({ messages: [], model: config.model });
}
