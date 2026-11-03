import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";

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

const DATA_DIR = path.join(process.cwd(), "data");
const CONFIG_PATH = path.join(DATA_DIR, "agent.json");
const CHATS_DIR = path.join(DATA_DIR, "chats");

const DEFAULT_CONFIG: AgentConfig = {
  prompt: "Ты полезный ассистент в Telegram. Отвечай кратко и по делу.",
  model: "gpt-4o-mini",
};

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

async function writeJson(filePath: string, data: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

export async function getAgentConfig(): Promise<AgentConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    await writeJson(CONFIG_PATH, DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

export async function saveAgentConfig(input: unknown): Promise<AgentConfig> {
  const config = normalizeConfig(input);
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
  const filePath = path.join(CHATS_DIR, `${chatFileId(chatId)}.json`);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is ChatMessage =>
          item &&
          typeof item === "object" &&
          (item.role === "user" || item.role === "assistant") &&
          typeof item.content === "string",
      )
      .slice(-20);
  } catch {
    return [];
  }
}

export async function saveChatHistory(chatId: string | number, messages: ChatMessage[]) {
  await writeJson(path.join(CHATS_DIR, `${chatFileId(chatId)}.json`), messages.slice(-20));
}

export async function clearChatHistory(chatId: string | number) {
  await writeJson(path.join(CHATS_DIR, `${chatFileId(chatId)}.json`), []);
}
