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

/** Единый контракт хранилища: Supabase / Redis / файлы. */
export type AgentStoreBackend = {
  getAgentConfig(): Promise<AgentConfig>;
  saveAgentConfig(input: unknown): Promise<AgentConfig>;
  getChatHistory(chatId: string): Promise<ChatMessage[]>;
  saveChatHistory(chatId: string, messages: ChatMessage[]): Promise<void>;
};

export const DEFAULT_CONFIG: AgentConfig = {
  prompt: "Ты полезный ассистент в Telegram. Отвечай кратко и по делу.",
  model: "gpt-4o-mini",
};

export function isModel(value: string): value is Model {
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

export function parseMessages(data: unknown): ChatMessage[] {
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

export function chatFileId(chatId: string | number): string {
  const id = String(chatId);
  if (/^-?\d+$/.test(id)) return id;
  if (/^web-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return id;
  throw new Error("Некорректный идентификатор чата");
}
