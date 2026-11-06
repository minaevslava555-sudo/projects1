import bundledConfigFile from "../../data/agent.json";
import {
  normalizeConfig,
  parseMessages,
  type AgentConfig,
  type AgentStoreBackend,
  type ChatMessage,
} from "./types";

const CONFIG_KEY = "agent:config";
const BUNDLED_CONFIG = normalizeConfig(bundledConfigFile);

export function redisCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url?.trim() || !token?.trim()) return null;
  return { url: url.replace(/\/$/, ""), token };
}

function chatKey(chatId: string) {
  return `agent:chat:${chatId}`;
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

export const redisBackend: AgentStoreBackend = {
  async getAgentConfig(): Promise<AgentConfig> {
    const raw = await redisCommand(["GET", CONFIG_KEY]);
    if (typeof raw === "string" && raw) {
      try {
        return normalizeConfig(JSON.parse(raw));
      } catch {
        return BUNDLED_CONFIG;
      }
    }
    return BUNDLED_CONFIG;
  },

  async saveAgentConfig(input: unknown): Promise<AgentConfig> {
    const config = normalizeConfig(input);
    await redisCommand(["SET", CONFIG_KEY, JSON.stringify(config)]);
    return config;
  },

  async getChatHistory(chatId: string): Promise<ChatMessage[]> {
    const raw = await redisCommand(["GET", chatKey(chatId)]);
    if (typeof raw !== "string" || !raw) return [];
    try {
      return parseMessages(JSON.parse(raw));
    } catch {
      return [];
    }
  },

  async saveChatHistory(chatId: string, messages: ChatMessage[]): Promise<void> {
    await redisCommand(["SET", chatKey(chatId), JSON.stringify(messages.slice(-20))]);
  },
};
