import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { getSupabaseServer, supabaseEnv } from "./supabase/server";

export type BotUiState = {
  menuMessageId: number | null;
  ephemeralIds: number[];
};

const TABLE = "projects1_bot_ui";
const LOCAL_DATA_DIR = path.join(process.cwd(), "data");
const WRITABLE_DATA_DIR = process.env.VERCEL ? path.join("/tmp", "agent-data") : LOCAL_DATA_DIR;
const UI_DIR = path.join(WRITABLE_DATA_DIR, "bot-ui");

const EMPTY: BotUiState = { menuMessageId: null, ephemeralIds: [] };

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
  if (!response.ok) throw new Error("Не удалось сохранить данные");
  const payload = (await response.json()) as { result?: unknown };
  return payload.result ?? null;
}

function normalizeState(raw: unknown): BotUiState {
  if (!raw || typeof raw !== "object") return { ...EMPTY };
  const data = raw as Record<string, unknown>;
  const menuMessageId =
    typeof data.menuMessageId === "number" && Number.isFinite(data.menuMessageId)
      ? data.menuMessageId
      : null;
  const ephemeralIds = Array.isArray(data.ephemeralIds)
    ? data.ephemeralIds.filter((id): id is number => typeof id === "number" && Number.isFinite(id))
    : [];
  return { menuMessageId, ephemeralIds };
}

function chatKey(chatId: number) {
  return `agent:bot-ui:${chatId}`;
}

async function writeJson(filePath: string, data: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

export async function getBotUiState(chatId: number): Promise<BotUiState> {
  if (supabaseEnv()) {
    try {
      const supabase = getSupabaseServer();
      const { data, error } = await supabase
        .from(TABLE)
        .select("menu_message_id, ephemeral_ids")
        .eq("chat_id", String(chatId))
        .maybeSingle();
      if (!error && data) {
        return normalizeState({
          menuMessageId: data.menu_message_id,
          ephemeralIds: data.ephemeral_ids,
        });
      }
    } catch {
      // таблица может ещё не быть создана — fallback ниже
    }
  }

  if (redisCreds()) {
    const raw = await redisCommand(["GET", chatKey(chatId)]);
    if (typeof raw === "string" && raw) {
      try {
        return normalizeState(JSON.parse(raw));
      } catch {
        return { ...EMPTY };
      }
    }
    return { ...EMPTY };
  }

  try {
    const raw = await readFile(path.join(UI_DIR, `${chatId}.json`), "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return { ...EMPTY };
  }
}

export async function saveBotUiState(chatId: number, state: BotUiState): Promise<BotUiState> {
  const next = normalizeState(state);

  if (supabaseEnv()) {
    try {
      const supabase = getSupabaseServer();
      const { error } = await supabase.from(TABLE).upsert(
        {
          chat_id: String(chatId),
          menu_message_id: next.menuMessageId,
          ephemeral_ids: next.ephemeralIds,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "chat_id" },
      );
      if (!error) return next;
    } catch {
      // fallback
    }
  }

  if (redisCreds()) {
    await redisCommand(["SET", chatKey(chatId), JSON.stringify(next)]);
    return next;
  }

  await writeJson(path.join(UI_DIR, `${chatId}.json`), next);
  return next;
}
