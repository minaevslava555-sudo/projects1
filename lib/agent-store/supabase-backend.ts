import bundledConfigFile from "../../data/agent.json";
import { getSupabaseServer, supabaseEnv } from "../supabase/server";
import {
  normalizeConfig,
  parseMessages,
  type AgentConfig,
  type AgentStoreBackend,
  type ChatMessage,
} from "./types";

const CONFIG_TABLE = "projects1_agent_config";
const CHATS_TABLE = "projects1_chat_histories";

const BUNDLED_CONFIG = normalizeConfig(bundledConfigFile);

export function supabaseCreds() {
  return supabaseEnv();
}

export const supabaseBackend: AgentStoreBackend = {
  async getAgentConfig(): Promise<AgentConfig> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from(CONFIG_TABLE)
      .select("prompt, model")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      throw new Error("Не удалось загрузить конфиг");
    }
    if (!data) return BUNDLED_CONFIG;
    return normalizeConfig(data);
  },

  async saveAgentConfig(input: unknown): Promise<AgentConfig> {
    const config = normalizeConfig(input);
    const supabase = getSupabaseServer();
    const { error } = await supabase.from(CONFIG_TABLE).upsert(
      {
        id: 1,
        prompt: config.prompt,
        model: config.model,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

    if (error) {
      throw new Error("Не удалось сохранить конфиг");
    }
    return config;
  },

  async getChatHistory(chatId: string): Promise<ChatMessage[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from(CHATS_TABLE)
      .select("messages")
      .eq("chat_id", chatId)
      .maybeSingle();

    if (error) {
      throw new Error("Не удалось загрузить историю");
    }
    return parseMessages(data?.messages);
  },

  async saveChatHistory(chatId: string, messages: ChatMessage[]): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase.from(CHATS_TABLE).upsert(
      {
        chat_id: chatId,
        messages: messages.slice(-20),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "chat_id" },
    );

    if (error) {
      throw new Error("Не удалось сохранить историю");
    }
  },
};
