import { fileBackend } from "./file-backend";
import { redisBackend, redisCreds } from "./redis-backend";
import { supabaseBackend, supabaseCreds } from "./supabase-backend";
import { chatFileId, type AgentConfig, type AgentStoreBackend, type ChatMessage } from "./types";

export {
  MODELS,
  normalizeConfig,
  type AgentConfig,
  type AgentStoreBackend,
  type ChatMessage,
  type Model,
} from "./types";

export { listActiveServices, type ServiceItem } from "./services";

/** Приоритет: Supabase → Redis → файлы. */
function activeBackend(): AgentStoreBackend {
  if (supabaseCreds()) return supabaseBackend;
  if (redisCreds()) return redisBackend;
  return fileBackend;
}

export async function getAgentConfig(): Promise<AgentConfig> {
  return activeBackend().getAgentConfig();
}

export async function saveAgentConfig(input: unknown): Promise<AgentConfig> {
  return activeBackend().saveAgentConfig(input);
}

export async function getChatHistory(chatId: string | number): Promise<ChatMessage[]> {
  return activeBackend().getChatHistory(chatFileId(chatId));
}

export async function saveChatHistory(chatId: string | number, messages: ChatMessage[]) {
  await activeBackend().saveChatHistory(chatFileId(chatId), messages.slice(-20));
}

export async function clearChatHistory(chatId: string | number) {
  await saveChatHistory(chatId, []);
}
