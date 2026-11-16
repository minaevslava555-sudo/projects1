import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handleOrderPost,
  type OrderRouteDeps,
} from "./order-route-handler";

test("successful claim then pre-save validation error releases pending claim", async () => {
  const idempotencyKey = "idem-order-claim-then-validation";
  const claimToken = "a1b2c3d4-e5f6-4789-a012-3456789abcde";
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
    notifyAdminAboutOrder: async () => undefined,
  } satisfies OrderRouteDeps;

  const request = new Request("http://localhost/api/order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      turnstileToken: "test-turnstile-token",
      idempotencyKey,
      // name intentionally omitted → failBeforeSave after claim
      phone: "+351900000000",
      service: "cleaning",
    }),
  });

  const response = await handleOrderPost(request, fakeDeps);
  const body = (await response.json()) as { ok: boolean; error?: string };

  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(typeof body.error, "string");
  assert.deepEqual(releaseCalls, [[idempotencyKey, claimPayload]]);
  assert.equal(saveCalls, 0);
  assert.equal(storeCalls, 0);
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
