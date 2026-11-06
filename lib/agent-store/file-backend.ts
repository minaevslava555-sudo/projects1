import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import bundledConfigFile from "../../data/agent.json";
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  parseMessages,
  type AgentConfig,
  type AgentStoreBackend,
  type ChatMessage,
} from "./types";

const LOCAL_DATA_DIR = path.join(process.cwd(), "data");
const WRITABLE_DATA_DIR = process.env.VERCEL ? path.join("/tmp", "agent-data") : LOCAL_DATA_DIR;
const CONFIG_PATH = path.join(WRITABLE_DATA_DIR, "agent.json");
const CHATS_DIR = path.join(WRITABLE_DATA_DIR, "chats");

const BUNDLED_CONFIG = normalizeConfig(bundledConfigFile);

async function writeJson(filePath: string, data: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

export const fileBackend: AgentStoreBackend = {
  async getAgentConfig(): Promise<AgentConfig> {
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
  },

  async saveAgentConfig(input: unknown): Promise<AgentConfig> {
    const config = normalizeConfig(input);
    await writeJson(CONFIG_PATH, config);
    return config;
  },

  async getChatHistory(chatId: string): Promise<ChatMessage[]> {
    try {
      const raw = await readFile(path.join(CHATS_DIR, `${chatId}.json`), "utf8");
      return parseMessages(JSON.parse(raw));
    } catch {
      return [];
    }
  },

  async saveChatHistory(chatId: string, messages: ChatMessage[]): Promise<void> {
    await writeJson(path.join(CHATS_DIR, `${chatId}.json`), messages.slice(-20));
  },
};
