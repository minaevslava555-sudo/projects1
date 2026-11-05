import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import bundledConfigFile from "../data/agent.json";

export const MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1-mini",
  "gpt-4.1",
  "o4-mini",
] as const;

export type Model = (typeof MODELS)[number];

export type AgentConfig = {
  prompt: string;
  model: Model;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const CONFIG_KEY = "agent:config";
const LOCAL_DATA_DIR = path.join(process.cwd(), "data");
const WRITABLE_DATA_DIR = process.env.VERCEL ? path.join("/tmp", "agent-data") : LOCAL_DATA_DIR;
const CONFIG_PATH = path.join(WRITABLE_DATA_DIR, "agent.json");
const CHATS_DIR = path.join(WRITABLE_DATA_DIR, "chats");

const DEFAULT_CONFIG: AgentConfig = {
  prompt: "Ты полезный ассистент в Telegram. Отвечай кратко и по делу.",
  model: "gpt-4o-mini",
};

const BUNDLED_CONFIG = normalizeConfig(bundledConfigFile);

function isModel(value: string): value is Model {
  return (MODELS as readonly string[]).includes(value);
}

export function normalizeConfig(input: unknown): AgentConfig {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const prompt =
    typeof raw.prompt === "string" && raw.prompt.trim()
      ? raw.prompt.slice(0, 8000)
      : DEFAULT_CONFIG.prompt;
  const model = typeof raw.model === "string" && isModel(raw.model) ? raw.model : DEFAULT_CONFIG.model;

  return { prompt, model };
}

function redisCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url?.trim() || !token?.trim()) return null;
  return { url: url.replace(/\/$/, ""), token };
}

async function redisCommand(command: string[]): Promise<unknown> {
  const redis = redisCreds();
  if (!redis) return null;

  const response = await fetch(redis.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redis.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Не удалось сохранить данные");
  }
  const payload = (await response.json()) as { result?: unknown };
  return payload.result ?? null;
}

function parseMessages(data: unknown): ChatMessage[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (item): item is ChatMessage =>
        item &&
        typeof item === "object" &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string",
    )
    .slice(-20);
}

async function writeJson(filePath: string, data: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

function chatKey(chatId: string) {
  return `agent:chat:${chatId}`;
}

export async function getAgentConfig(): Promise<AgentConfig> {
  if (redisCreds()) {
    const raw = await redisCommand(["GET", CONFIG_KEY]);
    if (typeof raw === "string" && raw) {
      try {
        return normalizeConfig(JSON.parse(raw));
      } catch {
        return BUNDLED_CONFIG;
      }
    }
    return BUNDLED_CONFIG;
  }

  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    if (process.env.VERCEL) return BUNDLED_CONFIG;
    try {
      const bundled = await readFile(path.join(LOCAL_DATA_DIR, "agent.json"), "utf8");
      return normalizeConfig(JSON.parse(bundled));
    } catch {
      await writeJson(CONFIG_PATH, DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
  }
}

export async function saveAgentConfig(input: unknown): Promise<AgentConfig> {
  const config = normalizeConfig(input);
  if (redisCreds()) {
    await redisCommand(["SET", CONFIG_KEY, JSON.stringify(config)]);
    return config;
  }
  await writeJson(CONFIG_PATH, config);
  return config;
}

function chatFileId(chatId: string | number): string {
  const id = String(chatId);
  if (/^-?\d+$/.test(id)) return id;
  if (/^web-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return id;
  throw new Error("Некорректный идентификатор чата");
}

export async function getChatHistory(chatId: string | number): Promise<ChatMessage[]> {
  const id = chatFileId(chatId);
  if (redisCreds()) {
    const raw = await redisCommand(["GET", chatKey(id)]);
    if (typeof raw !== "string" || !raw) return [];
    try {
      return parseMessages(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  try {
    const raw = await readFile(path.join(CHATS_DIR, `${id}.json`), "utf8");
    return parseMessages(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function saveChatHistory(chatId: string | number, messages: ChatMessage[]) {
  const id = chatFileId(chatId);
  const payload = messages.slice(-20);
  if (redisCreds()) {
    await redisCommand(["SET", chatKey(id), JSON.stringify(payload)]);
    return;
  }
  await writeJson(path.join(CHATS_DIR, `${id}.json`), payload);
}

export async function clearChatHistory(chatId: string | number) {
  await saveChatHistory(chatId, []);
}
