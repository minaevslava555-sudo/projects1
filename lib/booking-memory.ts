/**
 * Process-local fallback when Upstash Redis is missing.
 * Used only off Vercel so local smoke can exercise draft/idempotency.
 * Never used when VERCEL=1 (fail-closed via redisRequired).
 */

type MemDraft = {
  createdAt: number;
  pending: boolean;
  used: boolean;
  photos: Set<string>;
};

const drafts = new Map<string, MemDraft>();
const idem = new Map<string, string>();

function ensureDraft(draftId: string): MemDraft {
  let row = drafts.get(draftId);
  if (!row) {
    row = { createdAt: Date.now(), pending: true, used: false, photos: new Set() };
    drafts.set(draftId, row);
  }
  return row;
}

export const bookingMemory = {
  registerDraft(draftId: string) {
    ensureDraft(draftId);
  },
  isUsed(draftId: string) {
    return drafts.get(draftId)?.used === true;
  },
  markUsed(draftId: string) {
    const row = ensureDraft(draftId);
    row.used = true;
    row.pending = false;
  },
  addPhoto(draftId: string, path: string, maxPhotos: number) {
    const row = ensureDraft(draftId);
    if (row.photos.size >= maxPhotos) return { ok: false as const, error: "Не более 5 фото" };
    row.photos.add(path);
    return { ok: true as const, count: row.photos.size };
  },
  listPhotos(draftId: string) {
    return [...(drafts.get(draftId)?.photos ?? [])];
  },
  listStale(maxAgeSec: number) {
    const cutoff = Date.now() - maxAgeSec * 1000;
    const out: Array<{ draftId: string; createdAt: number; photos: string[] }> = [];
    for (const [draftId, row] of drafts) {
      if (!row.pending || row.used) continue;
      if (row.createdAt > cutoff) continue;
      out.push({ draftId, createdAt: row.createdAt, photos: [...row.photos] });
    }
    return out;
  },
  clearDraft(draftId: string) {
    drafts.delete(draftId);
  },
  getIdem(key: string) {
    const raw = idem.get(key);
    return raw ?? null;
  },
  claimIdem(key: string, value: string) {
    if (idem.has(key)) return false;
    idem.set(key, value);
    return true;
  },
  setIdem(key: string, value: string) {
    idem.set(key, value);
  },
};
