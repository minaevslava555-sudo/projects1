import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOrderRequestFingerprint } from "./order-request-fingerprint";
import {
  handleOrderPost,
  type OrderRouteDeps,
} from "./order-route-handler";

const PRECLAIM_BOOKING = {
  name: "Test User",
  phone: "+351900000000",
  service: "cleaning" as const,
  date: "2026-12-01",
  preferredTime: "10:00",
  streetAddress: "Rua Test 1",
  city: "Lisboa",
  rooms: 2,
};

function preclaimFingerprint() {
  return buildOrderRequestFingerprint({
    ...PRECLAIM_BOOKING,
    apartmentFloor: null,
    accessInstructions: null,
    details: null,
    problemDescription: null,
    massageCategory: null,
    rooms: PRECLAIM_BOOKING.rooms,
    massageMinutes: null,
    // parsePhotoPaths(null/omitted) → [] in the handler
    repairPhotoPaths: [],
  });
}

test("pre-claim booking validation error does not acquire Redis claim", async () => {
  const idempotencyKey = "idem-order-preclaim-validation";

  const releaseCalls: [string, string][] = [];
  let claimCalls = 0;
  let saveCalls = 0;
  let storeCalls = 0;
  let notifyCalls = 0;
  let getIdemCalls = 0;

  const fakeDeps = {
    cleanupOrphanRepairPhotos: async () => ({ drafts: 0, files: 0 }),
    clientIpFromHeaders: () => "127.0.0.1",
    consumeRateLimit: async () => ({ ok: true as const, remaining: 9 }),
    verifyTurnstileToken: async () => ({ ok: true }),
    normalizeIdempotencyKey: (value: unknown) => {
      if (typeof value !== "string") return null;
      const text = value.trim();
      return text || null;
    },
    getIdempotentOrder: async () => {
      getIdemCalls += 1;
      return null;
    },
    claimIdempotencyKeyWithToken: async () => {
      claimCalls += 1;
      return {
        status: "claimed" as const,
        claimPayload: JSON.stringify({
          id: "__pending__",
          orderRef: "",
          pricingMode: "fixed",
          priceEuro: null,
          telegramOk: false,
          claimToken: "unused",
        }),
      };
    },
    releasePendingIdempotencyKey: async (key: string, payload: string) => {
      releaseCalls.push([key, payload]);
      return true;
    },
    storeIdempotentOrder: async () => {
      storeCalls += 1;
    },
    verifyDraftToken: () => ({
      ok: true as const,
      draftId: "draft-unused",
      exp: 1_900_000_000,
    }),
    isDraftConsumed: async () => false,
    assertPhotosBelongToDraft: async () => ({ ok: true as const }),
    markDraftConsumed: async () => undefined,
    resolveOrderPricing: async () => ({
      ok: false as const,
      message: "unused",
      status: 502 as const,
    }),
    generateOrderRef: () => "HV-UNUSED",
    saveOrderToSupabase: async () => {
      saveCalls += 1;
      return { id: "unused", orderRef: "HV-UNUSED" };
    },
    findOrderByIdempotencyKey: async () => null,
    notifyAdminAboutOrder: async () => {
      notifyCalls += 1;
    },
  } satisfies OrderRouteDeps;

  const request = new Request("http://localhost/api/order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      turnstileToken: "test-turnstile-token",
      idempotencyKey,
      // name intentionally omitted → validation before Redis claim
      phone: "+351900000000",
      service: "cleaning",
    }),
  });

  const response = await handleOrderPost(request, fakeDeps);
  const body = (await response.json()) as { ok: boolean; error?: string };

  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(typeof body.error, "string");
  assert.equal(claimCalls, 0);
  assert.equal(getIdemCalls, 0);
  assert.deepEqual(releaseCalls, []);
  assert.equal(saveCalls, 0);
  assert.equal(storeCalls, 0);
  assert.equal(notifyCalls, 0);
});

test("unexpected pre-save exception releases pending claim", async () => {
  const idempotencyKey = "idem-order-presave-throw";
  const claimToken = "b2c3d4e5-f6a7-4890-b123-456789abcdef";
  const claimPayload = JSON.stringify({
    id: "__pending__",
    orderRef: "",
    pricingMode: "fixed",
    priceEuro: null,
    telegramOk: false,
    claimToken,
  });

  const releaseCalls: [string, string][] = [];
  let saveCalls = 0;
  let storeCalls = 0;
  let pricingCalls = 0;

  const fakeDeps = {
    cleanupOrphanRepairPhotos: async () => ({ drafts: 0, files: 0 }),
    clientIpFromHeaders: () => "127.0.0.1",
    consumeRateLimit: async () => ({ ok: true as const, remaining: 9 }),
    verifyTurnstileToken: async () => ({ ok: true }),
    normalizeIdempotencyKey: (value: unknown) => {
      if (typeof value !== "string") return null;
      const text = value.trim();
      return text || null;
    },
    getIdempotentOrder: async () => null,
    claimIdempotencyKeyWithToken: async () => ({
      status: "claimed" as const,
      claimPayload,
    }),
    releasePendingIdempotencyKey: async (key: string, payload: string) => {
      releaseCalls.push([key, payload]);
      return true;
    },
    storeIdempotentOrder: async () => {
      storeCalls += 1;
    },
    verifyDraftToken: () => ({
      ok: true as const,
      draftId: "draft-presave-throw",
      exp: 1_900_000_000,
    }),
    isDraftConsumed: async () => false,
    assertPhotosBelongToDraft: async () => ({ ok: true as const }),
    markDraftConsumed: async () => undefined,
    resolveOrderPricing: async () => {
      pricingCalls += 1;
      throw new Error("test pricing failure");
    },
    generateOrderRef: () => "HV-UNUSED",
    saveOrderToSupabase: async () => {
      saveCalls += 1;
      return { id: "unused", orderRef: "HV-UNUSED" };
    },
    findOrderByIdempotencyKey: async () => null,
    notifyAdminAboutOrder: async () => undefined,
  } satisfies OrderRouteDeps;

  const request = new Request("http://localhost/api/order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      turnstileToken: "test-turnstile-token",
      idempotencyKey,
      draftToken: "test-draft-token",
      name: "Test User",
      phone: "+351900000000",
      service: "cleaning",
      date: "2026-12-01",
      preferredTime: "10:00",
      streetAddress: "Rua Test 1",
      city: "Lisboa",
      rooms: 2,
    }),
  });

  const response = await handleOrderPost(request, fakeDeps);
  const body = (await response.json()) as { ok: boolean; error?: string };

  assert.equal(response.status, 502);
  assert.equal(body.ok, false);
  assert.deepEqual(releaseCalls, [[idempotencyKey, claimPayload]]);
  assert.equal(saveCalls, 0);
  assert.equal(storeCalls, 0);
  assert.equal(pricingCalls, 1);
});

test("failure after save starts does not release pending claim", async () => {
  const idempotencyKey = "idem-order-save-started-throw";
  const claimToken = "c3d4e5f6-a7b8-4901-c234-56789abcdef0";
  const claimPayload = JSON.stringify({
    id: "__pending__",
    orderRef: "",
    pricingMode: "fixed",
    priceEuro: null,
    telegramOk: false,
    claimToken,
  });

  const releaseCalls: [string, string][] = [];
  let saveCalls = 0;
  let storeCalls = 0;
  let pricingCalls = 0;

  const fakeDeps = {
    cleanupOrphanRepairPhotos: async () => ({ drafts: 0, files: 0 }),
    clientIpFromHeaders: () => "127.0.0.1",
    consumeRateLimit: async () => ({ ok: true as const, remaining: 9 }),
    verifyTurnstileToken: async () => ({ ok: true }),
    normalizeIdempotencyKey: (value: unknown) => {
      if (typeof value !== "string") return null;
      const text = value.trim();
      return text || null;
    },
    getIdempotentOrder: async () => null,
    claimIdempotencyKeyWithToken: async () => ({
      status: "claimed" as const,
      claimPayload,
    }),
    releasePendingIdempotencyKey: async (key: string, payload: string) => {
      releaseCalls.push([key, payload]);
      return true;
    },
    storeIdempotentOrder: async () => {
      storeCalls += 1;
    },
    verifyDraftToken: () => ({
      ok: true as const,
      draftId: "draft-save-started-throw",
      exp: 1_900_000_000,
    }),
    isDraftConsumed: async () => false,
    assertPhotosBelongToDraft: async () => ({ ok: true as const }),
    markDraftConsumed: async () => undefined,
    resolveOrderPricing: async () => {
      pricingCalls += 1;
      return {
        ok: true as const,
        priced: {
          mode: "fixed" as const,
          priceEuro: 80,
          hours: 3,
          workers: 2,
        },
        pricingConfigId: "cfg-test",
        pricingVersion: 1,
        hourlyRateSnapshot: 25,
        pricingSnapshot: {
          service: "cleaning",
          pricingConfigId: "cfg-test",
          pricingVersion: 1,
          rooms: 2,
          hours: 3,
          workers: 2,
          cleaningHourlyRateEuro: 25,
          priceEuro: 80,
        },
      };
    },
    generateOrderRef: () => "HV-SAVE-FAIL",
    saveOrderToSupabase: async () => {
      saveCalls += 1;
      throw new Error("test database failure");
    },
    findOrderByIdempotencyKey: async () => null,
    notifyAdminAboutOrder: async () => undefined,
  } satisfies OrderRouteDeps;

  const request = new Request("http://localhost/api/order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      turnstileToken: "test-turnstile-token",
      idempotencyKey,
      draftToken: "test-draft-token",
      name: "Test User",
      phone: "+351900000000",
      service: "cleaning",
      date: "2026-12-01",
      preferredTime: "10:00",
      streetAddress: "Rua Test 1",
      city: "Lisboa",
      rooms: 2,
    }),
  });

  const response = await handleOrderPost(request, fakeDeps);
  const body = (await response.json()) as { ok: boolean; error?: string };

  assert.equal(response.status, 502);
  assert.equal(body.ok, false);
  assert.equal(saveCalls, 1);
  assert.deepEqual(releaseCalls, []);
  assert.equal(storeCalls, 0);
  assert.equal(pricingCalls, 1);
});

test("successful order saves then stores idempotency result", async () => {
  const idempotencyKey = "idem-order-success";
  const claimToken = "d4e5f6a7-b8c9-4012-d345-6789abcdef01";
  const claimPayload = JSON.stringify({
    id: "__pending__",
    orderRef: "",
    pricingMode: "fixed",
    priceEuro: null,
    telegramOk: false,
    claimToken,
  });

  const savedId = "ord-success-1";
  const savedOrderRef = "HV-OK-001";
  const pricingSnapshot = {
    service: "cleaning",
    pricingConfigId: "cfg-havenly",
    pricingVersion: 1,
    rooms: 2,
    hours: 3,
    workers: 2,
    cleaningHourlyRateEuro: 20,
    priceEuro: 120,
  };

  const releaseCalls: [string, string][] = [];
  const callOrder: string[] = [];
  const storeArgs: { key: string; value: unknown }[] = [];
  const saveArgs: unknown[] = [];
  let saveCalls = 0;

  const fakeDeps = {
    cleanupOrphanRepairPhotos: async () => ({ drafts: 0, files: 0 }),
    clientIpFromHeaders: () => "127.0.0.1",
    consumeRateLimit: async () => ({ ok: true as const, remaining: 9 }),
    verifyTurnstileToken: async () => ({ ok: true }),
    normalizeIdempotencyKey: (value: unknown) => {
      if (typeof value !== "string") return null;
      const text = value.trim();
      return text || null;
    },
    getIdempotentOrder: async () => null,
    claimIdempotencyKeyWithToken: async () => ({
      status: "claimed" as const,
      claimPayload,
    }),
    releasePendingIdempotencyKey: async (key: string, payload: string) => {
      releaseCalls.push([key, payload]);
      return true;
    },
    storeIdempotentOrder: async (key: string, value: unknown) => {
      callOrder.push("store");
      storeArgs.push({ key, value });
    },
    verifyDraftToken: () => ({
      ok: true as const,
      draftId: "draft-success",
      exp: 1_900_000_000,
    }),
    isDraftConsumed: async () => false,
    assertPhotosBelongToDraft: async () => ({ ok: true as const }),
    markDraftConsumed: async () => undefined,
    resolveOrderPricing: async () => ({
      ok: true as const,
      priced: {
        mode: "fixed" as const,
        priceEuro: 120,
        hours: 3,
        workers: 2,
      },
      pricingConfigId: "cfg-havenly",
      pricingVersion: 1,
      hourlyRateSnapshot: 20,
      pricingSnapshot,
    }),
    generateOrderRef: () => savedOrderRef,
    saveOrderToSupabase: async (order: unknown) => {
      saveCalls += 1;
      callOrder.push("save");
      saveArgs.push(order);
      return { id: savedId, orderRef: savedOrderRef };
    },
    findOrderByIdempotencyKey: async () => null,
    notifyAdminAboutOrder: async () => undefined,
  } satisfies OrderRouteDeps;

  const request = new Request("http://localhost/api/order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      turnstileToken: "test-turnstile-token",
      idempotencyKey,
      draftToken: "test-draft-token",
      name: "Test User",
      phone: "+351900000000",
      service: "cleaning",
      date: "2026-12-01",
      preferredTime: "10:00",
      streetAddress: "Rua Test 1",
      city: "Lisboa",
      rooms: 2,
    }),
  });

  const response = await handleOrderPost(request, fakeDeps);
  const body = (await response.json()) as {
    ok: boolean;
    id?: string;
    orderRef?: string;
    pricingMode?: string;
    priceEuro?: number | null;
    telegramOk?: boolean;
  };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(saveCalls, 1);
  assert.equal(storeArgs.length, 1);
  assert.equal(storeArgs[0]?.key, idempotencyKey);
  assert.deepEqual(storeArgs[0]?.value, {
    id: savedId,
    orderRef: savedOrderRef,
    pricingMode: "fixed",
    priceEuro: 120,
    telegramOk: true,
  });
  assert.deepEqual(releaseCalls, []);
  assert.deepEqual(callOrder, ["save", "store"]);
  assert.equal(body.id, savedId);
  assert.equal(body.orderRef, savedOrderRef);
  assert.equal(
    (saveArgs[0] as { pricingSnapshot?: unknown } | undefined)?.pricingSnapshot,
    pricingSnapshot,
  );
});

function createPreclaimReplayDeps(options: {
  redisResult: {
    id: string;
    orderRef: string;
    pricingMode: "fixed" | "quote";
    priceEuro: number | null;
    telegramOk: boolean;
  };
  findOrder:
    | (() => Promise<{
        id: string;
        orderRef: string;
        pricingMode: "fixed" | "quote";
        priceEuro: number | null;
        requestFingerprint: string | null;
      } | null>)
    | "throw";
}) {
  const releaseCalls: [string, string][] = [];
  let claimCalls = 0;
  let saveCalls = 0;
  let storeCalls = 0;
  let notifyCalls = 0;

  const fakeDeps = {
    cleanupOrphanRepairPhotos: async () => ({ drafts: 0, files: 0 }),
    clientIpFromHeaders: () => "127.0.0.1",
    consumeRateLimit: async () => ({ ok: true as const, remaining: 9 }),
    verifyTurnstileToken: async () => ({ ok: true }),
    normalizeIdempotencyKey: (value: unknown) => {
      if (typeof value !== "string") return null;
      const text = value.trim();
      return text || null;
    },
    getIdempotentOrder: async () => options.redisResult,
    claimIdempotencyKeyWithToken: async () => {
      claimCalls += 1;
      return {
        status: "claimed" as const,
        claimPayload: '{"id":"__pending__"}',
      };
    },
    releasePendingIdempotencyKey: async (key: string, payload: string) => {
      releaseCalls.push([key, payload]);
      return true;
    },
    storeIdempotentOrder: async () => {
      storeCalls += 1;
    },
    verifyDraftToken: () => ({
      ok: true as const,
      draftId: "draft-unused",
      exp: 1_900_000_000,
    }),
    isDraftConsumed: async () => false,
    assertPhotosBelongToDraft: async () => ({ ok: true as const }),
    markDraftConsumed: async () => undefined,
    resolveOrderPricing: async () => ({
      ok: false as const,
      message: "unused",
      status: 502 as const,
    }),
    generateOrderRef: () => "HV-UNUSED",
    saveOrderToSupabase: async () => {
      saveCalls += 1;
      return { id: "unused", orderRef: "HV-UNUSED" };
    },
    findOrderByIdempotencyKey:
      options.findOrder === "throw"
        ? async () => {
            throw new Error("test supabase lookup failure");
          }
        : options.findOrder,
    notifyAdminAboutOrder: async () => {
      notifyCalls += 1;
    },
  } satisfies OrderRouteDeps;

  return {
    fakeDeps,
    counters: () => ({
      claimCalls,
      saveCalls,
      storeCalls,
      notifyCalls,
      releaseCalls: [...releaseCalls],
    }),
  };
}

function preclaimRequest(idempotencyKey: string) {
  return new Request("http://localhost/api/order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      turnstileToken: "test-turnstile-token",
      idempotencyKey,
      ...PRECLAIM_BOOKING,
    }),
  });
}

function assertNoSideEffects(counters: {
  claimCalls: number;
  saveCalls: number;
  storeCalls: number;
  notifyCalls: number;
  releaseCalls: [string, string][];
}) {
  assert.equal(counters.claimCalls, 0);
  assert.equal(counters.saveCalls, 0);
  assert.equal(counters.storeCalls, 0);
  assert.equal(counters.notifyCalls, 0);
  assert.deepEqual(counters.releaseCalls, []);
}

test("pre-claim Redis replay returns existing order when fingerprint and ids match", async () => {
  const idempotencyKey = "idem-preclaim-match";
  const redisResult = {
    id: "ord-preclaim-1",
    orderRef: "HV-PC-1",
    pricingMode: "fixed" as const,
    priceEuro: 120,
    telegramOk: true,
  };
  const { fakeDeps, counters } = createPreclaimReplayDeps({
    redisResult,
    findOrder: async () => ({
      id: redisResult.id,
      orderRef: redisResult.orderRef,
      pricingMode: "fixed",
      priceEuro: 120,
      requestFingerprint: preclaimFingerprint(),
    }),
  });

  const response = await handleOrderPost(preclaimRequest(idempotencyKey), fakeDeps);
  const body = (await response.json()) as {
    ok: boolean;
    id?: string;
    orderRef?: string;
    pricingMode?: string;
    priceEuro?: number | null;
    telegramOk?: boolean;
  };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.id, redisResult.id);
  assert.equal(body.orderRef, redisResult.orderRef);
  assert.equal(body.pricingMode, redisResult.pricingMode);
  assert.equal(body.priceEuro, redisResult.priceEuro);
  assert.equal(body.telegramOk, redisResult.telegramOk);
  assertNoSideEffects(counters());
});

test("pre-claim Redis replay rejects different requestFingerprint with 409", async () => {
  const idempotencyKey = "idem-preclaim-fp-mismatch";
  const redisResult = {
    id: "ord-preclaim-2",
    orderRef: "HV-PC-2",
    pricingMode: "fixed" as const,
    priceEuro: 120,
    telegramOk: true,
  };
  const { fakeDeps, counters } = createPreclaimReplayDeps({
    redisResult,
    findOrder: async () => ({
      id: redisResult.id,
      orderRef: redisResult.orderRef,
      pricingMode: "fixed",
      priceEuro: 120,
      requestFingerprint: "a".repeat(64),
    }),
  });

  const response = await handleOrderPost(preclaimRequest(idempotencyKey), fakeDeps);
  const body = (await response.json()) as { ok: boolean; error?: string };

  assert.equal(response.status, 409);
  assert.equal(body.ok, false);
  assertNoSideEffects(counters());
});

test("pre-claim Redis replay rejects null DB requestFingerprint with 409", async () => {
  const idempotencyKey = "idem-preclaim-fp-null";
  const redisResult = {
    id: "ord-preclaim-3",
    orderRef: "HV-PC-3",
    pricingMode: "fixed" as const,
    priceEuro: 120,
    telegramOk: true,
  };
  const { fakeDeps, counters } = createPreclaimReplayDeps({
    redisResult,
    findOrder: async () => ({
      id: redisResult.id,
      orderRef: redisResult.orderRef,
      pricingMode: "fixed",
      priceEuro: 120,
      requestFingerprint: null,
    }),
  });

  const response = await handleOrderPost(preclaimRequest(idempotencyKey), fakeDeps);
  assert.equal(response.status, 409);
  assert.equal(((await response.json()) as { ok: boolean }).ok, false);
  assertNoSideEffects(counters());
});

test("pre-claim Redis replay rejects missing Supabase row with 409", async () => {
  const idempotencyKey = "idem-preclaim-missing-row";
  const redisResult = {
    id: "ord-preclaim-4",
    orderRef: "HV-PC-4",
    pricingMode: "fixed" as const,
    priceEuro: 120,
    telegramOk: true,
  };
  const { fakeDeps, counters } = createPreclaimReplayDeps({
    redisResult,
    findOrder: async () => null,
  });

  const response = await handleOrderPost(preclaimRequest(idempotencyKey), fakeDeps);
  assert.equal(response.status, 409);
  assert.equal(((await response.json()) as { ok: boolean }).ok, false);
  assertNoSideEffects(counters());
});

test("pre-claim Redis replay rejects Redis/DB id or orderRef mismatch with 409", async () => {
  const idempotencyKey = "idem-preclaim-id-mismatch";
  const redisResult = {
    id: "ord-preclaim-5",
    orderRef: "HV-PC-5",
    pricingMode: "fixed" as const,
    priceEuro: 120,
    telegramOk: true,
  };
  const { fakeDeps, counters } = createPreclaimReplayDeps({
    redisResult,
    findOrder: async () => ({
      id: "ord-different",
      orderRef: redisResult.orderRef,
      pricingMode: "fixed",
      priceEuro: 120,
      requestFingerprint: preclaimFingerprint(),
    }),
  });

  const response = await handleOrderPost(preclaimRequest(idempotencyKey), fakeDeps);
  assert.equal(response.status, 409);
  assert.equal(((await response.json()) as { ok: boolean }).ok, false);
  assertNoSideEffects(counters());
});

test("pre-claim Redis replay propagates Supabase lookup errors without success", async () => {
  const idempotencyKey = "idem-preclaim-lookup-throw";
  const redisResult = {
    id: "ord-preclaim-6",
    orderRef: "HV-PC-6",
    pricingMode: "fixed" as const,
    priceEuro: 120,
    telegramOk: true,
  };
  const { fakeDeps, counters } = createPreclaimReplayDeps({
    redisResult,
    findOrder: "throw",
  });

  const response = await handleOrderPost(preclaimRequest(idempotencyKey), fakeDeps);
  const body = (await response.json()) as { ok: boolean; error?: string };

  assert.equal(response.status, 502);
  assert.equal(body.ok, false);
  assert.equal(body.error, "test supabase lookup failure");
  assertNoSideEffects(counters());
});

function createClaimExistsReplayDeps(options: {
  secondRedisResult:
    | {
        id: string;
        orderRef: string;
        pricingMode: "fixed" | "quote";
        priceEuro: number | null;
        telegramOk: boolean;
      }
    | {
        id: "__pending__";
        orderRef: string;
        pricingMode: "fixed" | "quote";
        priceEuro: number | null;
        telegramOk: boolean;
      };
  findOrder:
    | (() => Promise<{
        id: string;
        orderRef: string;
        pricingMode: "fixed" | "quote";
        priceEuro: number | null;
        requestFingerprint: string | null;
      } | null>)
    | "throw"
    | "unused";
}) {
  const releaseCalls: [string, string][] = [];
  let claimCalls = 0;
  let getIdemCalls = 0;
  let saveCalls = 0;
  let storeCalls = 0;
  let notifyCalls = 0;

  const fakeDeps = {
    cleanupOrphanRepairPhotos: async () => ({ drafts: 0, files: 0 }),
    clientIpFromHeaders: () => "127.0.0.1",
    consumeRateLimit: async () => ({ ok: true as const, remaining: 9 }),
    verifyTurnstileToken: async () => ({ ok: true }),
    normalizeIdempotencyKey: (value: unknown) => {
      if (typeof value !== "string") return null;
      const text = value.trim();
      return text || null;
    },
    getIdempotentOrder: async () => {
      getIdemCalls += 1;
      if (getIdemCalls === 1) return null;
      return options.secondRedisResult;
    },
    claimIdempotencyKeyWithToken: async () => {
      claimCalls += 1;
      return { status: "exists" as const };
    },
    releasePendingIdempotencyKey: async (key: string, payload: string) => {
      releaseCalls.push([key, payload]);
      return true;
    },
    storeIdempotentOrder: async () => {
      storeCalls += 1;
    },
    verifyDraftToken: () => ({
      ok: true as const,
      draftId: "draft-unused",
      exp: 1_900_000_000,
    }),
    isDraftConsumed: async () => false,
    assertPhotosBelongToDraft: async () => ({ ok: true as const }),
    markDraftConsumed: async () => undefined,
    resolveOrderPricing: async () => ({
      ok: false as const,
      message: "unused",
      status: 502 as const,
    }),
    generateOrderRef: () => "HV-UNUSED",
    saveOrderToSupabase: async () => {
      saveCalls += 1;
      return { id: "unused", orderRef: "HV-UNUSED" };
    },
    findOrderByIdempotencyKey:
      options.findOrder === "throw"
        ? async () => {
            throw new Error("test supabase lookup failure");
          }
        : options.findOrder === "unused"
          ? async () => null
          : options.findOrder,
    notifyAdminAboutOrder: async () => {
      notifyCalls += 1;
    },
  } satisfies OrderRouteDeps;

  return {
    fakeDeps,
    counters: () => ({
      claimCalls,
      getIdemCalls,
      saveCalls,
      storeCalls,
      notifyCalls,
      releaseCalls: [...releaseCalls],
    }),
  };
}

function assertClaimExistsNoMutation(counters: {
  claimCalls: number;
  saveCalls: number;
  storeCalls: number;
  notifyCalls: number;
  releaseCalls: [string, string][];
}) {
  assert.equal(counters.claimCalls, 1);
  assert.equal(counters.saveCalls, 0);
  assert.equal(counters.storeCalls, 0);
  assert.equal(counters.notifyCalls, 0);
  assert.deepEqual(counters.releaseCalls, []);
}

test("claim=exists Redis replay returns existing order when fingerprint and ids match", async () => {
  const idempotencyKey = "idem-exists-match";
  const completed = {
    id: "ord-exists-1",
    orderRef: "HV-EX-1",
    pricingMode: "fixed" as const,
    priceEuro: 120,
    telegramOk: true,
  };
  const { fakeDeps, counters } = createClaimExistsReplayDeps({
    secondRedisResult: completed,
    findOrder: async () => ({
      id: completed.id,
      orderRef: completed.orderRef,
      pricingMode: "fixed",
      priceEuro: 120,
      requestFingerprint: preclaimFingerprint(),
    }),
  });

  const response = await handleOrderPost(preclaimRequest(idempotencyKey), fakeDeps);
  const body = (await response.json()) as {
    ok: boolean;
    id?: string;
    orderRef?: string;
    telegramOk?: boolean;
  };

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.id, completed.id);
  assert.equal(body.orderRef, completed.orderRef);
  assert.equal(body.telegramOk, true);
  assertClaimExistsNoMutation(counters());
  assert.equal(counters().getIdemCalls, 2);
});

test("claim=exists Redis replay rejects different DB fingerprint with 409", async () => {
  const completed = {
    id: "ord-exists-2",
    orderRef: "HV-EX-2",
    pricingMode: "fixed" as const,
    priceEuro: 120,
    telegramOk: true,
  };
  const { fakeDeps, counters } = createClaimExistsReplayDeps({
    secondRedisResult: completed,
    findOrder: async () => ({
      id: completed.id,
      orderRef: completed.orderRef,
      pricingMode: "fixed",
      priceEuro: 120,
      requestFingerprint: "b".repeat(64),
    }),
  });

  const response = await handleOrderPost(
    preclaimRequest("idem-exists-fp-mismatch"),
    fakeDeps,
  );
  assert.equal(response.status, 409);
  assert.equal(((await response.json()) as { ok: boolean }).ok, false);
  assertClaimExistsNoMutation(counters());
});

test("claim=exists Redis replay rejects null DB fingerprint with 409", async () => {
  const completed = {
    id: "ord-exists-3",
    orderRef: "HV-EX-3",
    pricingMode: "fixed" as const,
    priceEuro: 120,
    telegramOk: true,
  };
  const { fakeDeps, counters } = createClaimExistsReplayDeps({
    secondRedisResult: completed,
    findOrder: async () => ({
      id: completed.id,
      orderRef: completed.orderRef,
      pricingMode: "fixed",
      priceEuro: 120,
      requestFingerprint: null,
    }),
  });

  const response = await handleOrderPost(
    preclaimRequest("idem-exists-fp-null"),
    fakeDeps,
  );
  assert.equal(response.status, 409);
  assertClaimExistsNoMutation(counters());
});

test("claim=exists Redis replay rejects missing DB row with 409", async () => {
  const completed = {
    id: "ord-exists-4",
    orderRef: "HV-EX-4",
    pricingMode: "fixed" as const,
    priceEuro: 120,
    telegramOk: true,
  };
  const { fakeDeps, counters } = createClaimExistsReplayDeps({
    secondRedisResult: completed,
    findOrder: async () => null,
  });

  const response = await handleOrderPost(
    preclaimRequest("idem-exists-missing-row"),
    fakeDeps,
  );
  assert.equal(response.status, 409);
  assertClaimExistsNoMutation(counters());
});

test("claim=exists Redis replay rejects Redis/DB id or orderRef mismatch with 409", async () => {
  const completed = {
    id: "ord-exists-5",
    orderRef: "HV-EX-5",
    pricingMode: "fixed" as const,
    priceEuro: 120,
    telegramOk: true,
  };
  const { fakeDeps, counters } = createClaimExistsReplayDeps({
    secondRedisResult: completed,
    findOrder: async () => ({
      id: completed.id,
      orderRef: "HV-OTHER",
      pricingMode: "fixed",
      priceEuro: 120,
      requestFingerprint: preclaimFingerprint(),
    }),
  });

  const response = await handleOrderPost(
    preclaimRequest("idem-exists-ref-mismatch"),
    fakeDeps,
  );
  assert.equal(response.status, 409);
  assertClaimExistsNoMutation(counters());
});

test("claim=exists Redis pending on second lookup returns processing 409", async () => {
  const { fakeDeps, counters } = createClaimExistsReplayDeps({
    secondRedisResult: {
      id: "__pending__",
      orderRef: "",
      pricingMode: "fixed",
      priceEuro: null,
      telegramOk: false,
    },
    findOrder: "unused",
  });

  const response = await handleOrderPost(
    preclaimRequest("idem-exists-pending"),
    fakeDeps,
  );
  const body = (await response.json()) as { ok: boolean; error?: string };

  assert.equal(response.status, 409);
  assert.equal(body.ok, false);
  assert.equal(body.error, "Заказ уже обрабатывается");
  assertClaimExistsNoMutation(counters());
});

test("claim=exists Redis replay propagates Supabase lookup errors without success", async () => {
  const completed = {
    id: "ord-exists-7",
    orderRef: "HV-EX-7",
    pricingMode: "fixed" as const,
    priceEuro: 120,
    telegramOk: true,
  };
  const { fakeDeps, counters } = createClaimExistsReplayDeps({
    secondRedisResult: completed,
    findOrder: "throw",
  });

  const response = await handleOrderPost(
    preclaimRequest("idem-exists-lookup-throw"),
    fakeDeps,
  );
  const body = (await response.json()) as { ok: boolean; error?: string };

  assert.equal(response.status, 502);
  assert.equal(body.ok, false);
  assert.equal(body.error, "test supabase lookup failure");
  assertClaimExistsNoMutation(counters());
});

function createPostClaimDbReplayDeps(options: {
  findOrder:
    | (() => Promise<{
        id: string;
        orderRef: string;
        pricingMode: "fixed" | "quote";
        priceEuro: number | null;
        requestFingerprint: string | null;
      } | null>)
    | "throw";
  claimPayload?: string;
}) {
  const claimPayload =
    options.claimPayload ??
    JSON.stringify({
      id: "__pending__",
      orderRef: "",
      pricingMode: "fixed",
      priceEuro: null,
      telegramOk: false,
      claimToken: "post-claim-token",
    });

  const releaseCalls: [string, string][] = [];
  const storeArgs: { key: string; value: unknown }[] = [];
  let claimCalls = 0;
  let getIdemCalls = 0;
  let saveCalls = 0;
  let notifyCalls = 0;

  const fakeDeps = {
    cleanupOrphanRepairPhotos: async () => ({ drafts: 0, files: 0 }),
    clientIpFromHeaders: () => "127.0.0.1",
    consumeRateLimit: async () => ({ ok: true as const, remaining: 9 }),
    verifyTurnstileToken: async () => ({ ok: true }),
    normalizeIdempotencyKey: (value: unknown) => {
      if (typeof value !== "string") return null;
      const text = value.trim();
      return text || null;
    },
    getIdempotentOrder: async () => {
      getIdemCalls += 1;
      // Initial miss (Redis expired); after claim the key is pending.
      if (getIdemCalls === 1) return null;
      return {
        id: "__pending__",
        orderRef: "",
        pricingMode: "fixed" as const,
        priceEuro: null,
        telegramOk: false,
      };
    },
    claimIdempotencyKeyWithToken: async () => {
      claimCalls += 1;
      return { status: "claimed" as const, claimPayload };
    },
    releasePendingIdempotencyKey: async (key: string, payload: string) => {
      releaseCalls.push([key, payload]);
      return true;
    },
    storeIdempotentOrder: async (key: string, value: unknown) => {
      storeArgs.push({ key, value });
    },
    verifyDraftToken: () => ({
      ok: true as const,
      draftId: "draft-db-replay",
      exp: 1_900_000_000,
    }),
    isDraftConsumed: async () => false,
    assertPhotosBelongToDraft: async () => ({ ok: true as const }),
    markDraftConsumed: async () => undefined,
    resolveOrderPricing: async () => ({
      ok: true as const,
      priced: {
        mode: "fixed" as const,
        priceEuro: 120,
        hours: 3,
        workers: 2,
      },
      pricingConfigId: "cfg-havenly",
      pricingVersion: 1,
      hourlyRateSnapshot: 20,
      pricingSnapshot: { service: "cleaning" },
    }),
    generateOrderRef: () => "HV-UNUSED",
    saveOrderToSupabase: async () => {
      saveCalls += 1;
      return { id: "unused", orderRef: "HV-UNUSED" };
    },
    findOrderByIdempotencyKey:
      options.findOrder === "throw"
        ? async () => {
            throw new Error("test supabase lookup failure");
          }
        : options.findOrder,
    notifyAdminAboutOrder: async () => {
      notifyCalls += 1;
    },
  } satisfies OrderRouteDeps;

  return {
    fakeDeps,
    claimPayload,
    counters: () => ({
      claimCalls,
      getIdemCalls,
      saveCalls,
      notifyCalls,
      releaseCalls: [...releaseCalls],
      storeArgs: [...storeArgs],
    }),
  };
}

function postClaimDbRequest(idempotencyKey: string) {
  return preclaimRequest(idempotencyKey);
}

test("post-claim Supabase recovery returns existing order when fingerprint matches", async () => {
  const idempotencyKey = "idem-db-recovery-match";
  const dbOrder = {
    id: "ord-db-1",
    orderRef: "HV-DB-1",
    pricingMode: "fixed" as const,
    priceEuro: 120,
    requestFingerprint: preclaimFingerprint(),
  };
  const { fakeDeps, claimPayload, counters } = createPostClaimDbReplayDeps({
    findOrder: async () => dbOrder,
  });

  const response = await handleOrderPost(postClaimDbRequest(idempotencyKey), fakeDeps);
  const body = (await response.json()) as {
    ok: boolean;
    id?: string;
    orderRef?: string;
    pricingMode?: string;
    priceEuro?: number | null;
    telegramOk?: boolean;
  };
  const c = counters();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.id, dbOrder.id);
  assert.equal(body.orderRef, dbOrder.orderRef);
  assert.equal(body.pricingMode, "fixed");
  assert.equal(body.priceEuro, 120);
  assert.equal(body.telegramOk, false);
  assert.equal(c.claimCalls, 1);
  assert.equal(c.saveCalls, 0);
  assert.equal(c.notifyCalls, 0);
  assert.deepEqual(c.releaseCalls, []);
  assert.equal(c.storeArgs.length, 1);
  assert.equal(c.storeArgs[0]?.key, idempotencyKey);
  assert.deepEqual(c.storeArgs[0]?.value, {
    id: dbOrder.id,
    orderRef: dbOrder.orderRef,
    pricingMode: "fixed",
    priceEuro: 120,
    telegramOk: false,
  });
  assert.ok(claimPayload.includes("post-claim-token"));
});

test("post-claim Supabase recovery rejects different requestFingerprint with 409", async () => {
  const idempotencyKey = "idem-db-recovery-fp-mismatch";
  const { fakeDeps, claimPayload, counters } = createPostClaimDbReplayDeps({
    findOrder: async () => ({
      id: "ord-db-2",
      orderRef: "HV-DB-2",
      pricingMode: "fixed",
      priceEuro: 120,
      requestFingerprint: "c".repeat(64),
    }),
  });

  const response = await handleOrderPost(postClaimDbRequest(idempotencyKey), fakeDeps);
  const c = counters();

  assert.equal(response.status, 409);
  assert.equal(((await response.json()) as { ok: boolean }).ok, false);
  assert.equal(c.claimCalls, 1);
  assert.equal(c.saveCalls, 0);
  assert.equal(c.notifyCalls, 0);
  assert.equal(c.storeArgs.length, 0);
  assert.deepEqual(c.releaseCalls, [[idempotencyKey, claimPayload]]);
});

test("post-claim Supabase recovery rejects null DB requestFingerprint with 409", async () => {
  const idempotencyKey = "idem-db-recovery-fp-null";
  const { fakeDeps, claimPayload, counters } = createPostClaimDbReplayDeps({
    findOrder: async () => ({
      id: "ord-db-3",
      orderRef: "HV-DB-3",
      pricingMode: "fixed",
      priceEuro: 120,
      requestFingerprint: null,
    }),
  });

  const response = await handleOrderPost(postClaimDbRequest(idempotencyKey), fakeDeps);
  const c = counters();

  assert.equal(response.status, 409);
  assert.equal(c.claimCalls, 1);
  assert.equal(c.saveCalls, 0);
  assert.equal(c.notifyCalls, 0);
  assert.equal(c.storeArgs.length, 0);
  assert.deepEqual(c.releaseCalls, [[idempotencyKey, claimPayload]]);
});

test("post-claim Supabase recovery propagates lookup errors and releases claim", async () => {
  const idempotencyKey = "idem-db-recovery-lookup-throw";
  const { fakeDeps, claimPayload, counters } = createPostClaimDbReplayDeps({
    findOrder: "throw",
  });

  const response = await handleOrderPost(postClaimDbRequest(idempotencyKey), fakeDeps);
  const body = (await response.json()) as { ok: boolean; error?: string };
  const c = counters();

  assert.equal(response.status, 502);
  assert.equal(body.ok, false);
  assert.equal(body.error, "test supabase lookup failure");
  assert.equal(c.claimCalls, 1);
  assert.equal(c.saveCalls, 0);
  assert.equal(c.notifyCalls, 0);
  assert.equal(c.storeArgs.length, 0);
  assert.deepEqual(c.releaseCalls, [[idempotencyKey, claimPayload]]);
});
