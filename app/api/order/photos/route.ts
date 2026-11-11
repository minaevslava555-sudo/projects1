import { randomUUID } from "crypto";
import { assertSupabaseServiceKey, getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BUCKET = "repair-order-photos";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const DRAFT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonError(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

/** Private upload for repair photos via service_role. Returns storage object path. */
export async function POST(request: Request) {
  try {
    assertSupabaseServiceKey();

    const form = await request.formData();
    const draftIdRaw = form.get("draftId");
    const file = form.get("file");

    if (typeof draftIdRaw !== "string" || !DRAFT_ID_RE.test(draftIdRaw.trim())) {
      return jsonError("Некорректный draftId", 400);
    }
    const draftId = draftIdRaw.trim().toLowerCase();

    if (!(file instanceof File)) {
      return jsonError("Добавьте файл изображения", 400);
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return jsonError("Размер файла до 5 МБ", 400);
    }

    const ext = ALLOWED.get(file.type);
    if (!ext) {
      return jsonError("Допустимы JPEG, PNG или WebP", 400);
    }

    const objectName = `${draftId}/${randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const supabase = getSupabaseServer();

    const { error } = await supabase.storage.from(BUCKET).upload(objectName, buffer, {
      contentType: file.type,
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
