import { randomUUID } from "crypto";
import {
  addDraftPhoto,
  isDraftConsumed,
  verifyDraftToken,
} from "@/lib/booking-draft";
import { detectImageMagic } from "@/lib/image-magic";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";
import { cleanupOrphanRepairPhotos } from "@/lib/repair-photos-cleanup";
import { assertSupabaseServiceKey, getSupabaseServer } from "@/lib/supabase/server";
import { verifyTurnstileToken } from "@/lib/turnstile";

export const runtime = "nodejs";

const BUCKET = "repair-order-photos";
const MAX_BYTES = 5 * 1024 * 1024;

function jsonError(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

/** Private upload for repair photos via service_role. Returns storage object path. */
export async function POST(request: Request) {
  try {
    void cleanupOrphanRepairPhotos({ limit: 3 }).catch((error) => {
      console.warn("[order/photos] lazy cleanup skipped", error);
    });

    assertSupabaseServiceKey();

    const ip = clientIpFromHeaders(request.headers);
    const limited = await consumeRateLimit(`photos:${ip}`, 30, 600);
    if (!limited.ok) {
      return jsonError("Слишком много загрузок. Попробуйте позже", 429);
    }

    const form = await request.formData();
    const draftTokenRaw = form.get("draftToken");
    const turnstileRaw = form.get("turnstileToken");
    const file = form.get("file");

    const turnstile = await verifyTurnstileToken(
      typeof turnstileRaw === "string" ? turnstileRaw : null,
      ip,
    );
    if (!turnstile.ok) {
      return jsonError(turnstile.error, 403);
    }

    const draft = verifyDraftToken(
      typeof draftTokenRaw === "string" ? draftTokenRaw : null,
    );
    if (!draft.ok) {
      return jsonError(draft.error, 400);
    }
    const draftId = draft.draftId;

    if (await isDraftConsumed(draftId)) {
      return jsonError("Черновик уже использован", 400);
    }

    if (!(file instanceof File)) {
      return jsonError("Добавьте файл изображения", 400);
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return jsonError("Размер файла до 5 МБ", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = detectImageMagic(buffer);
    if (!detected) {
      return jsonError("Допустимы JPEG, PNG или WebP", 400);
    }

    const objectName = `${draftId}/${randomUUID()}.${detected.ext}`;
    const supabase = getSupabaseServer();

    const registered = await addDraftPhoto(draftId, objectName, 5);
    if (!registered.ok) {
      return jsonError(registered.error, 400);
    }

    const { error } = await supabase.storage.from(BUCKET).upload(objectName, buffer, {
      contentType: detected.mime,
      upsert: false,
    });

    if (error) {
      console.error("[order/photos] upload failed", error.message);
      return jsonError("Не удалось загрузить фото", 502);
    }

    return Response.json({ ok: true, path: objectName });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить фото";
    return jsonError(message, 502);
  }
}
