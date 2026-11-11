import {
  clearDraftKeys,
  listStalePendingDraftIds,
  PHOTO_ORPHAN_MAX_AGE_SEC,
} from "@/lib/booking-draft";
import { getSupabaseServer } from "@/lib/supabase/server";

const BUCKET = "repair-order-photos";

/**
 * Remove orphan repair photos for drafts older than 24h that were never consumed.
 * Used by cron and as a lazy fallback from order/photos handlers.
 */
export async function cleanupOrphanRepairPhotos(options?: {
  maxAgeSec?: number;
  limit?: number;
}): Promise<{ drafts: number; files: number }> {
  const maxAgeSec = options?.maxAgeSec ?? PHOTO_ORPHAN_MAX_AGE_SEC;
  const limit = options?.limit ?? 40;
  const stale = (await listStalePendingDraftIds(maxAgeSec)).slice(0, limit);
  if (stale.length === 0) return { drafts: 0, files: 0 };

  const supabase = getSupabaseServer();
  let files = 0;

  for (const item of stale) {
    if (item.photos.length > 0) {
      // Optional: skip if any path already referenced by a saved order
      const { data: rows } = await supabase
        .from("projects1_orders")
        .select("id, repair_photo_paths")
        .contains("repair_photo_paths", item.photos.slice(0, 1))
        .limit(1);

      if (rows && rows.length > 0) {
        await clearDraftKeys(item.draftId);
        continue;
      }

      const { error } = await supabase.storage.from(BUCKET).remove(item.photos);
      if (error) {
        console.error("[cleanup-repair-photos] storage remove failed", error.message);
        continue;
      }
      files += item.photos.length;
    }
    await clearDraftKeys(item.draftId);
  }

  return { drafts: stale.length, files };
}
