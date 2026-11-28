/**
 * Opt-in Preview E2E: Cleaning v1 order idempotency against a pinned deployment.
 *
 * Fail-closed. Does not modify app runtime. Never prints secrets/tokens/payloads.
 * Shared infra: scripts/lib/preview-e2e-shared.mjs + preview-e2e-pins.mjs
 *
 * Live run (network): requires ALLOW_PREVIEW_E2E_IDEMPOTENCY=1, REPIN_PENDING=false,
 * and gates in shared module.
 * Local only: node --check …  |  node … --self-check
 */

import { randomUUID } from "crypto";
import {
  EXPECTED_BASE_URL,
  EXPECTED_GIT_SHA,
  TURNSTILE_DUMMY_TOKEN,
  assertBaseUrl,
  assertLivePinReady,
  assertPreviewPings,
  assertRemoteDeploymentSha,
  assertTelegramIsolationFromMetadata,
  buildOrderBody,
  countOrdersByIdempotencyKey,
  createDraft,
  createSupabaseVerifier,
  expectFail,
  fail,
  fetchOrderByIdempotencyKey,
  info,
  ok,
  postOrder,
  runSharedSelfCheck,
  safeSummary,
  waitForOrderRef,
  warnLimitation,
} from "./lib/preview-e2e-shared.mjs";

const T2_ROOMS = {
  bedroom: 2,
  livingRoom: 1,
  kitchen: 1,
  bathroom: 1,
  hallway: 1,
  separateWc: 0,
  otherRoom: 0,
};

const EXPECTED_PRICE_EURO = 90;
const EXPECTED_HOURLY_RATE = 20;
const EXPECTED_MIN_PRICE = 40;
const EXPECTED_ROUNDING_STEP = 30;

const SELF_CHECK = process.argv.includes("--self-check");

function assertPricingSnapshot(row) {
  if (!row) fail("Missing order row for snapshot assertions");
  if (row.price_euro !== EXPECTED_PRICE_EURO) {
    fail(`price_euro expected ${EXPECTED_PRICE_EURO}, got ${safeSummary(row.price_euro)}`);
  }
  if (row.hourly_rate_snapshot !== EXPECTED_HOURLY_RATE) {
    fail(
      `hourly_rate_snapshot expected ${EXPECTED_HOURLY_RATE}, got ${safeSummary(row.hourly_rate_snapshot)}`,
    );
  }
  const snap = row.pricing_snapshot;
  if (!snap || typeof snap !== "object") fail("pricing_snapshot missing");
  if (snap.cleaningPricingVersion !== "v1") fail("cleaningPricingVersion != v1");
  if (snap.customerPriceEuro !== EXPECTED_PRICE_EURO) {
    fail("snapshot customerPriceEuro mismatch");
  }
  if (snap.hourlyRateEuro !== EXPECTED_HOURLY_RATE) {
    fail("snapshot hourlyRateEuro mismatch");
  }
  if (snap.minPriceEuro !== EXPECTED_MIN_PRICE) {
    fail("snapshot minPriceEuro mismatch");
  }
  if (snap.roundingStepMinutes !== EXPECTED_ROUNDING_STEP) {
    fail("snapshot roundingStepMinutes mismatch");
  }
  ok(
    `Snapshot OK (€${EXPECTED_PRICE_EURO}, rate €${EXPECTED_HOURLY_RATE}, min €${EXPECTED_MIN_PRICE}, step ${EXPECTED_ROUNDING_STEP})`,
  );
}

function syntheticBookingFields(runId) {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 14);
  const date = day.toISOString().slice(0, 10);
  return {
    name: `E2E Idem Harness ${runId.slice(0, 8)}`,
    phone: `+351900${String(Date.now()).slice(-6)}`,
    service: "cleaning",
    date,
    preferredTime: "10:00",
    streetAddress: `E2E Test Rua ${runId.slice(0, 8)}`,
    city: "Lisboa",
    cleaningPricingVersion: "v1",
    roomCounts: { ...T2_ROOMS },
    cleaningType: "standard",
  };
}

function runSelfCheck() {
  runSharedSelfCheck();

  if (T2_ROOMS.bedroom !== 2 || T2_ROOMS.bathroom !== 1) {
    fail("T2 room fixture drifted from catalog preset");
  }
  ok("T2 fixture shape OK");

  info(
    "Lifecycle: create consumes draft; sequential replay uses fresh draft+Turnstile; concurrent uses two drafts + one shared new idem key",
  );
  ok("Cleaning self-check passed");
  process.exit(0);
}

async function main() {
  if (SELF_CHECK) {
    runSelfCheck();
    return;
  }

  if (process.env.ALLOW_PREVIEW_E2E_IDEMPOTENCY !== "1") {
    fail("Set ALLOW_PREVIEW_E2E_IDEMPOTENCY=1 to run live Preview E2E");
  }

  assertLivePinReady();

  const baseOrigin = assertBaseUrl(
    process.env.PREVIEW_BASE_URL?.trim() || EXPECTED_BASE_URL,
  );
  const expectedSha = process.env.EXPECTED_GIT_SHA?.trim() || EXPECTED_GIT_SHA;

  info("Target origin pinned");
  const { deployment } = await assertRemoteDeploymentSha(baseOrigin, expectedSha);
  assertTelegramIsolationFromMetadata(deployment);
  await assertPreviewPings(baseOrigin);

  // Fail closed if Cleaning v1 server flag missing is observed via order 400 — no env decrypt.
  info(
    "Requires Preview CLEANING_V1_ORDERS_ENABLED=true (+ client flags if UI); verified via order responses",
  );

  const supabase = createSupabaseVerifier();
  const runId = randomUUID();
  const fields = syntheticBookingFields(runId);

  const createKey = randomUUID();
  const countBeforeCreate = await countOrdersByIdempotencyKey(supabase, createKey);
  if (countBeforeCreate !== 0) fail("Create key unexpectedly present before test");

  const draftCreate = await createDraft(baseOrigin);
  info("Create: obtained fresh draftToken (not logged)");
  const createBody = buildOrderBody(fields, {
    idempotencyKey: createKey,
    draftToken: draftCreate.draftToken,
    turnstileToken: TURNSTILE_DUMMY_TOKEN,
  });
  info("Create: Turnstile dummy token presented (siteverify on server)");
  const created = await postOrder(baseOrigin, createBody);
  if (created.status !== 200 || !created.data?.ok) {
    fail(
      `Create failed HTTP ${created.status} err=${safeSummary(created.data?.error)}`,
    );
  }
  const orderRef = created.data.orderRef;
  const priceEuro = created.data.priceEuro;
  if (!orderRef || typeof orderRef !== "string") fail("Create missing orderRef");
  if (priceEuro !== EXPECTED_PRICE_EURO) {
    fail(`Create priceEuro expected ${EXPECTED_PRICE_EURO}, got ${safeSummary(priceEuro)}`);
  }
  const countAfterCreate = await countOrdersByIdempotencyKey(supabase, createKey);
  if (countAfterCreate !== 1) {
    fail(`After create expected 1 row, got ${countAfterCreate}`);
  }
  const createdRow = await fetchOrderByIdempotencyKey(supabase, createKey);
  assertPricingSnapshot(createdRow);
  if (createdRow.order_ref !== orderRef) fail("DB order_ref mismatch after create");
  if (!createdRow.request_fingerprint) fail("Create row missing request_fingerprint");
  const originalFingerprint = createdRow.request_fingerprint;
  const originalPrice = createdRow.price_euro;
  ok(`Create OK orderRef=${safeSummary(orderRef)} price=${priceEuro}`);
  info("Create: draftToken is consumed server-side after successful save");

  const countBeforeReplay = await countOrdersByIdempotencyKey(supabase, createKey);
  const draftReplay = await createDraft(baseOrigin);
  info("Replay: fresh draftToken + Turnstile dummy (new siteverify)");
  const replayBody = buildOrderBody(fields, {
    idempotencyKey: createKey,
    draftToken: draftReplay.draftToken,
    turnstileToken: TURNSTILE_DUMMY_TOKEN,
  });
  const replayed = await postOrder(baseOrigin, replayBody);
  if (replayed.status !== 200 || !replayed.data?.ok) {
    fail(
      `Replay failed HTTP ${replayed.status} err=${safeSummary(replayed.data?.error)}`,
    );
  }
  if (replayed.data.orderRef !== orderRef) fail("Replay orderRef differs from create");
  if (replayed.data.priceEuro !== EXPECTED_PRICE_EURO) fail("Replay priceEuro differs");
  const countAfterReplay = await countOrdersByIdempotencyKey(supabase, createKey);
  if (countAfterReplay !== countBeforeReplay || countAfterReplay !== 1) {
    fail(
      `Replay must not insert rows (before=${countBeforeReplay} after=${countAfterReplay})`,
    );
  }
  ok("Sequential replay returned same orderRef/price; row count unchanged");

  const raceKey = randomUUID();
  const countBeforeRace = await countOrdersByIdempotencyKey(supabase, raceKey);
  if (countBeforeRace !== 0) fail("Race key unexpectedly present");

  const draftA = await createDraft(baseOrigin);
  const draftB = await createDraft(baseOrigin);
  if (draftA.draftId === draftB.draftId) fail("Concurrent drafts must be distinct");
  info("Concurrent: two distinct draftTokens + shared new idempotency key");

  const raceFields = syntheticBookingFields(randomUUID());
  const bodyA = buildOrderBody(raceFields, {
    idempotencyKey: raceKey,
    draftToken: draftA.draftToken,
    turnstileToken: TURNSTILE_DUMMY_TOKEN,
  });
  const bodyB = buildOrderBody(raceFields, {
    idempotencyKey: raceKey,
    draftToken: draftB.draftToken,
    turnstileToken: TURNSTILE_DUMMY_TOKEN,
  });

  const [resA, resB] = await Promise.all([
    postOrder(baseOrigin, bodyA),
    postOrder(baseOrigin, bodyB),
  ]);

  const outcomes = [resA, resB];
  let winnerRef = null;
  let winnerPrice = null;
  for (const r of outcomes) {
    if (r.status === 200 && r.data?.ok && r.data?.orderRef) {
      winnerRef = r.data.orderRef;
      winnerPrice = r.data.priceEuro;
      break;
    }
  }

  if (!winnerRef) {
    info("Concurrent: pending 409 — limited retry for final orderRef");
    const waited = await waitForOrderRef(baseOrigin, raceFields, raceKey);
    winnerRef = waited.data.orderRef;
    winnerPrice = waited.data.priceEuro;
  } else if (outcomes.some((r) => r.status === 409)) {
    info("Concurrent: peer 409 — confirming via limited retry");
    const waited = await waitForOrderRef(baseOrigin, raceFields, raceKey);
    if (waited.data.orderRef !== winnerRef) {
      fail("Concurrent retry orderRef diverged from winner");
    }
  }

  if (!winnerRef) fail("Concurrent race produced no orderRef");
  if (winnerPrice !== EXPECTED_PRICE_EURO) {
    fail(`Concurrent price expected ${EXPECTED_PRICE_EURO}`);
  }
  const countAfterRace = await countOrdersByIdempotencyKey(supabase, raceKey);
  if (countAfterRace !== 1) {
    fail(`Concurrent expected exactly 1 row, got ${countAfterRace}`);
  }
  const raceRow = await fetchOrderByIdempotencyKey(supabase, raceKey);
  assertPricingSnapshot(raceRow);
  if (raceRow.order_ref !== winnerRef) fail("Concurrent DB order_ref mismatch");
  ok(`Concurrent race OK single row orderRef=${safeSummary(winnerRef)}`);

  const beforeMismatch = await fetchOrderByIdempotencyKey(supabase, createKey);
  if (!beforeMismatch) fail("Original order missing before mismatch test");
  if (beforeMismatch.request_fingerprint !== originalFingerprint) {
    fail("Original fingerprint changed before mismatch test");
  }
  if (beforeMismatch.price_euro !== originalPrice) {
    fail("Original price changed before mismatch test");
  }
  const countBeforeMismatch = await countOrdersByIdempotencyKey(supabase, createKey);

  const draftMismatch = await createDraft(baseOrigin);
  const mismatchFields = { ...fields, cleaningType: "deep" };
  const mismatchBody = buildOrderBody(mismatchFields, {
    idempotencyKey: createKey,
    draftToken: draftMismatch.draftToken,
    turnstileToken: TURNSTILE_DUMMY_TOKEN,
  });
  const mismatched = await postOrder(baseOrigin, mismatchBody);
  if (mismatched.status !== 409) {
    fail(`Fingerprint mismatch expected HTTP 409, got ${mismatched.status}`);
  }
  warnLimitation(
    "API 409 body may be generic (idempotency conflict / processing); exact fingerprint-mismatch reason is not always distinguishable client-side — DB invariants are authoritative",
  );

  const countAfterMismatch = await countOrdersByIdempotencyKey(supabase, createKey);
  if (countAfterMismatch !== countBeforeMismatch || countAfterMismatch !== 1) {
    fail("Fingerprint mismatch must not insert a second row");
  }
  const afterMismatch = await fetchOrderByIdempotencyKey(supabase, createKey);
  if (!afterMismatch) fail("Original order disappeared after mismatch POST");
  if (afterMismatch.id !== beforeMismatch.id) fail("Order id changed after mismatch");
  if (afterMismatch.order_ref !== orderRef) fail("order_ref changed after mismatch");
  if (afterMismatch.request_fingerprint !== originalFingerprint) {
    fail("request_fingerprint mutated after mismatch POST");
  }
  if (afterMismatch.price_euro !== originalPrice) {
    fail("price_euro mutated after mismatch POST");
  }
  ok(
    "Fingerprint mismatch: HTTP 409; original order/fingerprint/price intact; still one row",
  );

  ok("All Preview E2E cleaning idempotency scenarios passed");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : "Unhandled harness error");
});
