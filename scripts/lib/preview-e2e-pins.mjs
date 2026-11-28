/**
 * Shared Preview E2E deployment pins (Cleaning + Massage harnesses).
 *
 * REPIN procedure (after harness commit + Vercel Preview deploy finishes):
 * 1. Copy Preview URL (…vercel.app) and full 40-char Git SHA from that deployment.
 * 2. Set EXPECTED_BASE_URL and EXPECTED_GIT_SHA together (never one without the other).
 * 3. Set REPIN_PENDING = false.
 * 4. Commit the pin-only change separately if desired.
 *
 * While REPIN_PENDING === true, live harnesses refuse to place orders
 * (avoids binding Massage / post-4446ecd runs to the stale Cleaning Preview).
 */

export const EXPECTED_BRANCH = "feature/85h-gallery-motion-prototype";
export const EXPECTED_SUPABASE_HOST = "avyerjnzfsqgaascltqi.supabase.co";
/** Must match app/api/preview/redis-ping EXPECTED_HOST (server-side hostMatch). */
export const EXPECTED_REDIS_HOST = "tidy-griffon-181609.upstash.io";

/** Last Cleaning-validated Preview — stale for Massage / new harness live runs. */
export const LEGACY_PINNED_BASE_URL =
  "https://projects1-ett84hjty-slava-7f85.vercel.app";
export const LEGACY_PINNED_GIT_SHA =
  "377dafa28cc2a0dd26912ac89e19365ec9987578";

/**
 * Active pin. Until REPIN_PENDING is cleared, live E2E exits before network orders.
 * Defaults keep legacy URL for offline self-check allowlist continuity; SHA documents
 * the intended HEAD baseline (4446ecd) pending operator repin to the harness commit deploy.
 */
export const REPIN_PENDING = true;
export const EXPECTED_BASE_URL = LEGACY_PINNED_BASE_URL;
export const EXPECTED_GIT_SHA =
  "4446ecdc8808bed5061454f5d3797cb69e0dabdc";

export const VERCEL_API_ORIGIN = "https://api.vercel.com";
