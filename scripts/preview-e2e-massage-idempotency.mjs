/**
 * Opt-in Preview E2E: Massage & Wellness v1 pricing + idempotency (matrix M1–M14).
 *
 * Fail-closed. Shared infra: scripts/lib/preview-e2e-shared.mjs + preview-e2e-pins.mjs
 * Does not modify app runtime. Never prints secrets/tokens/payloads.
 *
 * Live: ALLOW_PREVIEW_E2E_MASSAGE_IDEMPOTENCY=1 + REPIN_PENDING=false + shared gates.
 * Local: node --check …  |  node … --self-check
 */

import { createHash, randomUUID } from "crypto";
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

/** Mirrors lib/massage-wellness-catalog.ts — keep in sync offline. */
const MASSAGE_V1_QUOTE_REVISION = "2026-11-25-mw-v1";
const MASSAGE_V1_CATALOG_VERSION = "v1";

const EQUIPMENT_CATALOG = {
  "foot-system": { priceCents: 2000, extraBookingMin: 30 },
  "eye-system": { priceCents: 1500, extraBookingMin: 25 },
  moxi: { priceCents: 1000, extraBookingMin: 0 },
  "top-relax": { priceCents: 1000, extraBookingMin: 0 },
};

const TARIFF_CATALOG = {
  "relaxing-60": { durationMin: 60, priceCents: 7000, includedEquipment: [] },
  "sports-60": { durationMin: 60, priceCents: 8000, includedEquipment: [] },
  "targeted-30": { durationMin: 30, priceCents: 5500, includedEquipment: [] },
  "targeted-60": { durationMin: 60, priceCents: 8500, includedEquipment: [] },
  "premium-wellness-120": {
    durationMin: 120,
    priceCents: 12000,
    includedEquipment: ["foot-system", "eye-system", "moxi", "top-relax"],
  },
};

const ALL_EQUIPMENT_IDS = ["foot-system", "eye-system", "moxi", "top-relax"];

const SELF_CHECK = process.argv.includes("--self-check");

function centsToEuro(cents) {
  return cents / 100;
}

function sortEquipmentLexical(ids) {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Offline quote mirror of calculateMassageV1Price (success path only). */
function expectQuote(tariffId, wellnessEquipmentIds = []) {
  const tariff = TARIFF_CATALOG[tariffId];
  if (!tariff) fail(`Unknown tariff fixture ${tariffId}`);
  if (tariffId === "premium-wellness-120") {
    if (wellnessEquipmentIds.length > 0) {
      return { error: "premium rejects equipment" };
    }
    return {
      tariffId,
      baseDurationMin: tariff.durationMin,
      basePriceCents: tariff.priceCents,
      equipment: [],
      includedEquipment: [...tariff.includedEquipment],
      totalSessionMinutes: tariff.durationMin,
      priceCents: tariff.priceCents,
      priceEuro: centsToEuro(tariff.priceCents),
    };
  }
  let extraMin = 0;
  let extraCents = 0;
  const equipment = [];
  for (const id of wellnessEquipmentIds) {
    const row = EQUIPMENT_CATALOG[id];
    if (!row) return { error: "unknown equipment" };
    equipment.push({
      id,
      priceCents: row.priceCents,
      extraBookingMin: row.extraBookingMin,
      included: false,
    });
    extraMin += row.extraBookingMin;
    extraCents += row.priceCents;
  }
  const priceCents = tariff.priceCents + extraCents;
  return {
    tariffId,
    baseDurationMin: tariff.durationMin,
    basePriceCents: tariff.priceCents,
    equipment,
    includedEquipment: [],
    totalSessionMinutes: tariff.durationMin + extraMin,
    priceCents,
    priceEuro: centsToEuro(priceCents),
  };
}

/**
 * Minimal fingerprint mirror for massage v1 (lexical equipment sort).
 * Live server hash remains authoritative; used for order-independence self-check.
 */
function massageFingerprintDigest({
  service = "massage",
  massageTariffId,
  wellnessEquipmentIds,
}) {
  const payload = {
    service,
    massageVersion: "v1",
    massageTariffId,
  };
  if (Array.isArray(wellnessEquipmentIds) && wellnessEquipmentIds.length > 0) {
    payload.wellnessEquipmentIds = sortEquipmentLexical(wellnessEquipmentIds);
  }
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value).sort()) {
        out[key] = canonicalize(value[key]);
      }
      return out;
    }
    return value;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)), "utf8")
    .digest("hex");
}

function syntheticMassageFields(runId, { tariffId, wellnessEquipmentIds }) {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 14);
  const date = day.toISOString().slice(0, 10);
  return {
    name: `E2E Massage ${runId.slice(0, 8)}`,
    phone: `+351901${String(Date.now()).slice(-6)}`,
    service: "massage",
    date,
    preferredTime: "11:00",
    streetAddress: `E2E Massage Rua ${runId.slice(0, 8)}`,
    city: "Lisboa",
    massageVersion: "v1",
    massageTariffId: tariffId,
    massageQuoteRevision: MASSAGE_V1_QUOTE_REVISION,
    ...(wellnessEquipmentIds && wellnessEquipmentIds.length > 0
      ? { wellnessEquipmentIds: [...wellnessEquipmentIds] }
      : {}),
  };
}

function assertMassageSnapshot(row, expected) {
  if (!row) fail("Missing order row for massage snapshot assertions");
  if (row.service !== "massage") fail(`service expected massage, got ${safeSummary(row.service)}`);
  if (row.price_euro !== expected.priceEuro) {
    fail(`price_euro expected ${expected.priceEuro}, got ${safeSummary(row.price_euro)}`);
  }
  if (row.massage_category !== expected.tariffId) {
    fail(
      `massage_category expected ${expected.tariffId}, got ${safeSummary(row.massage_category)}`,
    );
  }
  if (row.massage_minutes !== expected.baseDurationMin) {
    fail(
      `massage_minutes expected base ${expected.baseDurationMin}, got ${safeSummary(row.massage_minutes)}`,
    );
  }
  if (row.hourly_rate_snapshot != null) {
    fail("massage v1 hourly_rate_snapshot must be null");
  }
  const snap = row.pricing_snapshot;
  if (!snap || typeof snap !== "object") fail("pricing_snapshot missing");
  if (snap.service !== "massage") fail("snapshot.service != massage");
  if (snap.massageVersion !== "v1") fail("snapshot.massageVersion != v1");
  if (snap.catalogVersion !== MASSAGE_V1_CATALOG_VERSION) {
    fail("snapshot.catalogVersion mismatch");
  }
  if (snap.quoteRevision !== MASSAGE_V1_QUOTE_REVISION) {
    fail("snapshot.quoteRevision mismatch");
  }
  if (snap.tariffId !== expected.tariffId) fail("snapshot.tariffId mismatch");
  if (snap.baseDurationMin !== expected.baseDurationMin) {
    fail("snapshot.baseDurationMin mismatch");
  }
  if (snap.basePriceCents !== expected.basePriceCents) {
    fail("snapshot.basePriceCents mismatch");
  }
  if (snap.totalSessionMinutes !== expected.totalSessionMinutes) {
    fail("snapshot.totalSessionMinutes mismatch");
  }
  if (snap.priceCents !== expected.priceCents) fail("snapshot.priceCents mismatch");
  if (snap.priceEuro !== expected.priceEuro) fail("snapshot.priceEuro mismatch");
  if (!Array.isArray(snap.equipment)) fail("snapshot.equipment must be array");
  if (snap.equipment.length !== expected.equipment.length) {
    fail(
      `snapshot.equipment length expected ${expected.equipment.length}, got ${snap.equipment.length}`,
    );
  }
  for (let i = 0; i < expected.equipment.length; i += 1) {
    const want = expected.equipment[i];
    const got = snap.equipment[i];
    if (!got || got.id !== want.id) fail(`snapshot.equipment[${i}].id mismatch`);
    if (got.priceCents !== want.priceCents) {
      fail(`snapshot.equipment[${i}].priceCents mismatch`);
    }
    if (got.extraBookingMin !== want.extraBookingMin) {
      fail(`snapshot.equipment[${i}].extraBookingMin mismatch`);
    }
    if (got.included !== false) fail(`snapshot.equipment[${i}].included must be false`);
  }
  if (!Array.isArray(snap.includedEquipment)) {
    fail("snapshot.includedEquipment must be array");
  }
  if (snap.includedEquipment.length !== expected.includedEquipment.length) {
    fail("snapshot.includedEquipment length mismatch");
  }
  for (let i = 0; i < expected.includedEquipment.length; i += 1) {
    if (snap.includedEquipment[i] !== expected.includedEquipment[i]) {
      fail("snapshot.includedEquipment content mismatch");
    }
  }
  if (!row.request_fingerprint) fail("request_fingerprint missing");
  ok(
    `Massage snapshot OK ${expected.tariffId} €${expected.priceEuro} visit ${expected.totalSessionMinutes}m base ${expected.baseDurationMin}m`,
  );
}

async function placeSuccessfulOrder(baseOrigin, supabase, fields, expected) {
  const idempotencyKey = randomUUID();
  const draft = await createDraft(baseOrigin);
  const body = buildOrderBody(fields, {
    idempotencyKey,
    draftToken: draft.draftToken,
    turnstileToken: TURNSTILE_DUMMY_TOKEN,
  });
  const res = await postOrder(baseOrigin, body);
  if (res.status !== 200 || !res.data?.ok) {
    fail(
      `Order failed HTTP ${res.status} err=${safeSummary(res.data?.error)} tariff=${expected.tariffId}`,
    );
  }
  if (res.data.priceEuro !== expected.priceEuro) {
    fail(
      `API priceEuro expected ${expected.priceEuro}, got ${safeSummary(res.data.priceEuro)}`,
    );
  }
  const count = await countOrdersByIdempotencyKey(supabase, idempotencyKey);
  if (count !== 1) fail(`Expected 1 row for ${expected.tariffId}, got ${count}`);
  const row = await fetchOrderByIdempotencyKey(supabase, idempotencyKey);
  assertMassageSnapshot(row, expected);
  if (row.order_ref !== res.data.orderRef) fail("DB order_ref mismatch");
  return { idempotencyKey, orderRef: res.data.orderRef, row, fields, expected };
}

async function expectOrderRejected(baseOrigin, fields, label) {
  const draft = await createDraft(baseOrigin);
  const body = buildOrderBody(fields, {
    idempotencyKey: randomUUID(),
    draftToken: draft.draftToken,
    turnstileToken: TURNSTILE_DUMMY_TOKEN,
  });
  const res = await postOrder(baseOrigin, body);
  if (res.status === 200 && res.data?.ok) {
    fail(`${label}: expected rejection, got HTTP 200 orderRef`);
  }
  if (res.status < 400 || res.status >= 500) {
    fail(`${label}: expected 4xx, got HTTP ${res.status}`);
  }
  ok(`${label}: rejected HTTP ${res.status}`);
  return res;
}

function runSelfCheck() {
  runSharedSelfCheck();

  const matrix = [
    ["relaxing-60", [], 70, 60],
    ["sports-60", [], 80, 60],
    ["targeted-30", [], 55, 30],
    ["targeted-60", [], 85, 60],
    ["relaxing-60", ["foot-system"], 90, 90],
    ["relaxing-60", ["eye-system"], 85, 85],
    ["relaxing-60", ["moxi"], 80, 60],
    ["relaxing-60", ["top-relax"], 80, 60],
    ["sports-60", ["foot-system", "eye-system"], 115, 115],
    ["relaxing-60", ALL_EQUIPMENT_IDS, 125, 115],
    ["sports-60", ALL_EQUIPMENT_IDS, 135, 115],
    ["premium-wellness-120", [], 120, 120],
  ];
  for (const [tariffId, equip, euro, minutes] of matrix) {
    const q = expectQuote(tariffId, equip);
    if ("error" in q) fail(`fixture quote error for ${tariffId}`);
    if (q.priceEuro !== euro || q.totalSessionMinutes !== minutes) {
      fail(
        `fixture ${tariffId}+[${equip}] expected €${euro}/${minutes}m got €${q.priceEuro}/${q.totalSessionMinutes}m`,
      );
    }
  }
  const premiumEquip = expectQuote("premium-wellness-120", ["moxi"]);
  if (!("error" in premiumEquip)) fail("premium+equipment must error in fixture");
  ok("Massage price/duration fixture matrix OK (incl. Sports+all4 €135/115m)");

  const fpA = massageFingerprintDigest({
    massageTariffId: "relaxing-60",
    wellnessEquipmentIds: ["foot-system", "eye-system"],
  });
  const fpB = massageFingerprintDigest({
    massageTariffId: "relaxing-60",
    wellnessEquipmentIds: ["eye-system", "foot-system"],
  });
  if (fpA !== fpB) fail("fingerprint must ignore equipment id order");
  const fpTariff = massageFingerprintDigest({
    massageTariffId: "sports-60",
    wellnessEquipmentIds: ["foot-system", "eye-system"],
  });
  if (fpA === fpTariff) fail("fingerprint must change with tariff");
  const fpEquip = massageFingerprintDigest({
    massageTariffId: "relaxing-60",
    wellnessEquipmentIds: ["moxi"],
  });
  if (fpA === fpEquip) fail("fingerprint must change with equipment set");
  ok("Fingerprint order-independence + tariff/equipment sensitivity (offline mirror)");

  expectFail("unknown tariff fixture", () => {
    expectQuote("no-such-tariff", []);
  });
  ok("Massage self-check passed");
  process.exit(0);
}

async function main() {
  if (SELF_CHECK) {
    runSelfCheck();
    return;
  }

  if (process.env.ALLOW_PREVIEW_E2E_MASSAGE_IDEMPOTENCY !== "1") {
    fail("Set ALLOW_PREVIEW_E2E_MASSAGE_IDEMPOTENCY=1 to run live Massage Preview E2E");
  }

  assertLivePinReady();

  const baseOrigin = assertBaseUrl(
    process.env.PREVIEW_BASE_URL?.trim() || EXPECTED_BASE_URL,
  );
  const expectedSha = process.env.EXPECTED_GIT_SHA?.trim() || EXPECTED_GIT_SHA;

  info("Target origin pinned (Massage v1)");
  info(
    "Requires Preview flags: MASSAGE_V1_ORDERS_ENABLED, MASSAGE_V1_EQUIPMENT_BOOKABLE, MASSAGE_V1_PREMIUM_WELLNESS_BOOKABLE (+ NEXT_PUBLIC_* pairs for UI)",
  );
  const { deployment } = await assertRemoteDeploymentSha(baseOrigin, expectedSha);
  assertTelegramIsolationFromMetadata(deployment);
  await assertPreviewPings(baseOrigin);

  const supabase = createSupabaseVerifier();

  // ----- Pricing matrix M1–M10 + Sports+all4 -----
  const pricingCases = [
    { id: "M1", tariffId: "relaxing-60", wellnessEquipmentIds: [] },
    { id: "M2", tariffId: "sports-60", wellnessEquipmentIds: [] },
    { id: "M3a", tariffId: "targeted-30", wellnessEquipmentIds: [] },
    { id: "M3b", tariffId: "targeted-60", wellnessEquipmentIds: [] },
    { id: "M4", tariffId: "relaxing-60", wellnessEquipmentIds: ["foot-system"] },
    { id: "M5", tariffId: "relaxing-60", wellnessEquipmentIds: ["eye-system"] },
    { id: "M6", tariffId: "relaxing-60", wellnessEquipmentIds: ["moxi"] },
    { id: "M7", tariffId: "relaxing-60", wellnessEquipmentIds: ["top-relax"] },
    {
      id: "M8",
      tariffId: "sports-60",
      wellnessEquipmentIds: ["foot-system", "eye-system"],
    },
    { id: "M9", tariffId: "relaxing-60", wellnessEquipmentIds: ALL_EQUIPMENT_IDS },
    { id: "M10", tariffId: "premium-wellness-120", wellnessEquipmentIds: [] },
    {
      id: "MX-sports-all4",
      tariffId: "sports-60",
      wellnessEquipmentIds: ALL_EQUIPMENT_IDS,
    },
  ];

  for (const c of pricingCases) {
    const expected = expectQuote(c.tariffId, c.wellnessEquipmentIds);
    if ("error" in expected) fail(`${c.id}: fixture error`);
    const fields = syntheticMassageFields(randomUUID(), {
      tariffId: c.tariffId,
      wellnessEquipmentIds: c.wellnessEquipmentIds,
    });
    info(`${c.id}: placing ${c.tariffId} (€${expected.priceEuro}, ${expected.totalSessionMinutes}m)`);
    await placeSuccessfulOrder(baseOrigin, supabase, fields, expected);
    ok(`${c.id} passed`);
  }

  // ----- M11 + rejection battery -----
  {
    const fields = syntheticMassageFields(randomUUID(), {
      tariffId: "premium-wellness-120",
      wellnessEquipmentIds: ["moxi"],
    });
    await expectOrderRejected(baseOrigin, fields, "M11 Premium+equipment double-charge");
  }
  {
    const fields = {
      ...syntheticMassageFields(randomUUID(), { tariffId: "relaxing-60" }),
      priceEuro: 1,
    };
    await expectOrderRejected(baseOrigin, fields, "Reject client priceEuro substitution");
  }
  {
    const fields = {
      ...syntheticMassageFields(randomUUID(), { tariffId: "relaxing-60" }),
      totalSessionMinutes: 1,
    };
    await expectOrderRejected(
      baseOrigin,
      fields,
      "Reject client totalSessionMinutes substitution",
    );
  }
  {
    const fields = syntheticMassageFields(randomUUID(), {
      tariffId: "relaxing-60",
      wellnessEquipmentIds: ["spine-system"],
    });
    await expectOrderRejected(baseOrigin, fields, "Reject unknown equipment");
  }
  {
    const fields = syntheticMassageFields(randomUUID(), {
      tariffId: "relaxing-60",
      wellnessEquipmentIds: ["moxi", "moxi"],
    });
    await expectOrderRejected(baseOrigin, fields, "Reject duplicate equipment ids");
  }

  // ----- M12 sequential replay -----
  const createRun = randomUUID();
  const createExpected = expectQuote("relaxing-60", ["foot-system", "moxi"]);
  const createFields = syntheticMassageFields(createRun, {
    tariffId: "relaxing-60",
    wellnessEquipmentIds: ["foot-system", "moxi"],
  });
  const created = await placeSuccessfulOrder(
    baseOrigin,
    supabase,
    createFields,
    createExpected,
  );
  info("M12: sequential replay same fingerprint");
  {
    const draftReplay = await createDraft(baseOrigin);
    const replayBody = buildOrderBody(createFields, {
      idempotencyKey: created.idempotencyKey,
      draftToken: draftReplay.draftToken,
      turnstileToken: TURNSTILE_DUMMY_TOKEN,
    });
    const replayed = await postOrder(baseOrigin, replayBody);
    if (replayed.status !== 200 || !replayed.data?.ok) {
      fail(`M12 replay failed HTTP ${replayed.status}`);
    }
    if (replayed.data.orderRef !== created.orderRef) fail("M12 replay orderRef differs");
    if (replayed.data.priceEuro !== createExpected.priceEuro) {
      fail("M12 replay priceEuro differs");
    }
    const count = await countOrdersByIdempotencyKey(supabase, created.idempotencyKey);
    if (count !== 1) fail(`M12 expected 1 row, got ${count}`);
    ok("M12 sequential replay OK");
  }

  // Same equipment, reversed order — must replay (fingerprint order-independent)
  {
    const draftOrder = await createDraft(baseOrigin);
    const reordered = {
      ...createFields,
      wellnessEquipmentIds: ["moxi", "foot-system"],
    };
    const body = buildOrderBody(reordered, {
      idempotencyKey: created.idempotencyKey,
      draftToken: draftOrder.draftToken,
      turnstileToken: TURNSTILE_DUMMY_TOKEN,
    });
    const res = await postOrder(baseOrigin, body);
    if (res.status !== 200 || !res.data?.ok) {
      fail(
        `Equipment order replay expected 200, got HTTP ${res.status} err=${safeSummary(res.data?.error)}`,
      );
    }
    if (res.data.orderRef !== created.orderRef) {
      fail("Equipment order change must not create new order");
    }
    const count = await countOrdersByIdempotencyKey(supabase, created.idempotencyKey);
    if (count !== 1) fail("Equipment order replay must keep single row");
    ok("Fingerprint: same equipment ids different order → replay (not mismatch)");
  }

  // ----- M13 concurrent race -----
  {
    const raceKey = randomUUID();
    const raceExpected = expectQuote("sports-60", ["eye-system"]);
    const raceFields = syntheticMassageFields(randomUUID(), {
      tariffId: "sports-60",
      wellnessEquipmentIds: ["eye-system"],
    });
    const draftA = await createDraft(baseOrigin);
    const draftB = await createDraft(baseOrigin);
    if (draftA.draftId === draftB.draftId) fail("M13 drafts must be distinct");
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
      const waited = await waitForOrderRef(baseOrigin, raceFields, raceKey);
      winnerRef = waited.data.orderRef;
      winnerPrice = waited.data.priceEuro;
    } else if (outcomes.some((r) => r.status === 409)) {
      const waited = await waitForOrderRef(baseOrigin, raceFields, raceKey);
      if (waited.data.orderRef !== winnerRef) {
        fail("M13 retry orderRef diverged");
      }
    }
    if (!winnerRef) fail("M13 no orderRef");
    if (winnerPrice !== raceExpected.priceEuro) {
      fail(`M13 price expected ${raceExpected.priceEuro}`);
    }
    const count = await countOrdersByIdempotencyKey(supabase, raceKey);
    if (count !== 1) fail(`M13 expected 1 row, got ${count}`);
    const row = await fetchOrderByIdempotencyKey(supabase, raceKey);
    assertMassageSnapshot(row, raceExpected);
    ok(`M13 concurrent race OK orderRef=${safeSummary(winnerRef)}`);
  }

  // ----- M14 fingerprint mismatches (tariff + equipment) -----
  {
    const before = await fetchOrderByIdempotencyKey(supabase, created.idempotencyKey);
    if (!before) fail("M14 original missing");
    const originalFp = before.request_fingerprint;
    const originalPrice = before.price_euro;
    const countBefore = await countOrdersByIdempotencyKey(
      supabase,
      created.idempotencyKey,
    );

    const draftTariff = await createDraft(baseOrigin);
    const tariffMismatch = {
      ...createFields,
      massageTariffId: "sports-60",
      wellnessEquipmentIds: ["foot-system", "moxi"],
    };
    const tariffBody = buildOrderBody(tariffMismatch, {
      idempotencyKey: created.idempotencyKey,
      draftToken: draftTariff.draftToken,
      turnstileToken: TURNSTILE_DUMMY_TOKEN,
    });
    const tariffRes = await postOrder(baseOrigin, tariffBody);
    if (tariffRes.status !== 409) {
      fail(`M14 tariff mismatch expected 409, got ${tariffRes.status}`);
    }
    ok("M14a fingerprint mismatch on tariff change → 409");

    const draftEquip = await createDraft(baseOrigin);
    const equipMismatch = {
      ...createFields,
      wellnessEquipmentIds: ["eye-system"],
    };
    const equipBody = buildOrderBody(equipMismatch, {
      idempotencyKey: created.idempotencyKey,
      draftToken: draftEquip.draftToken,
      turnstileToken: TURNSTILE_DUMMY_TOKEN,
    });
    const equipRes = await postOrder(baseOrigin, equipBody);
    if (equipRes.status !== 409) {
      fail(`M14 equipment mismatch expected 409, got ${equipRes.status}`);
    }
    ok("M14b fingerprint mismatch on equipment set → 409");

    warnLimitation(
      "API 409 body may be generic; DB invariants are authoritative for fingerprint mismatch",
    );

    const countAfter = await countOrdersByIdempotencyKey(
      supabase,
      created.idempotencyKey,
    );
    if (countAfter !== countBefore || countAfter !== 1) {
      fail("M14 must not insert extra rows");
    }
    const after = await fetchOrderByIdempotencyKey(supabase, created.idempotencyKey);
    if (!after) fail("M14 original disappeared");
    if (after.request_fingerprint !== originalFp) {
      fail("M14 fingerprint mutated");
    }
    if (after.price_euro !== originalPrice) fail("M14 price mutated");
    if (after.order_ref !== created.orderRef) fail("M14 order_ref mutated");
    ok("M14 DB invariants intact after mismatches");
  }

  ok("All Preview E2E Massage & Wellness scenarios passed (M1–M14 + extras)");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : "Unhandled harness error");
});
