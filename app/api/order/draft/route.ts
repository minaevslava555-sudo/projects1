import { createDraft, registerDraft } from "@/lib/booking-draft";
import { cleanupOrphanRepairPhotos } from "@/lib/repair-photos-cleanup";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

/** Issue HMAC-signed booking draft for photo binding. */
export async function POST(request: Request) {
  try {
    // Lazy orphan cleanup (best-effort, non-blocking failure)
    void cleanupOrphanRepairPhotos({ limit: 5 }).catch((error) => {
      console.warn("[order/draft] lazy cleanup skipped", error);
    });

    const ip = clientIpFromHeaders(request.headers);
    const limited = await consumeRateLimit(`draft:${ip}`, 30, 600);
    if (!limited.ok) {
      return jsonError("Слишком много запросов. Попробуйте позже", 429);
    }

    const draft = createDraft();
    await registerDraft(draft.draftId);

    return Response.json({
      ok: true,
      draftId: draft.draftId,
      draftToken: draft.draftToken,
      expiresAt: draft.expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось создать черновик";
    return jsonError(message, 502);
  }
}
