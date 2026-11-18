import assert from "node:assert/strict";
import { test } from "node:test";
import { bookingMemory } from "./booking-memory";
import {
  claimIdempotencyKeyWithToken,
  finalizePendingIdempotencyKey,
  releasePendingIdempotencyKey,
  type IdempotentOrderResult,
  type RedisDeps,
} from "./booking-idempotency";

const PENDING_PLACEHOLDER: IdempotentOrderResult = {
  id: "__pending__",
  orderRef: "",
  pricingMode: "fixed",
  priceEuro: null,
  telegramOk: false,
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function forceMemoryBackend() {
  delete process.env.KV_REST_API_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.VERCEL;
}

function uniqueKey(label: string) {
  return `idem-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createFakeRedisDeps(options?: {
  credentials?: boolean;
  required?: boolean;
  throwOnCommand?: boolean;
}): {
  deps: RedisDeps;
  store: Map<string, string>;
  commands: (string | number)[][];
} {
  const store = new Map<string, string>();
  const commands: (string | number)[][] = [];
  const hasCredentials = options?.credentials !== false;

  const deps: RedisDeps = {
    redisCreds: () =>
      hasCredentials ? { url: "https://fake.redis.test", token: "fake" } : null,
    redisRequired: () => options?.required === true,
    redisCommand: async (command: (string | number)[]) => {
      commands.push([...command]);
      if (options?.throwOnCommand) {
        throw new Error("Simulated Redis failure");
      }

      const [op] = command;
      if (op === "SET") {
        const redisKey = String(command[1]);
        const value = String(command[2]);
        const flags = command.slice(3).map(String);
        assert.ok(flags.includes("EX"));
        assert.ok(flags.includes("NX"));
        const exIndex = flags.indexOf("EX");
        assert.equal(Number(flags[exIndex + 1]), 86400);
        if (store.has(redisKey)) return null;
        store.set(redisKey, value);
        return "OK";
      }

      if (op === "EVAL") {
        assert.equal(Number(command[2]), 1);
        const redisKey = String(command[3]);
        const expected = String(command[4]);
        const current = store.get(redisKey);
        // Finalize CAS: EVAL script key expected next ttl
        if (command.length >= 7) {
          const next = String(command[5]);
          assert.equal(Number(command[6]), 86400);
          if (current === expected) {
            store.set(redisKey, next);
            return 1;
          }
          return 0;
        }
        // Release CAS delete: EVAL script key expected
        if (current === expected) {
          store.delete(redisKey);
          return 1;
        }
        return 0;
      }

      if (op === "GET") {
        const redisKey = String(command[1]);
        return store.get(redisKey) ?? null;
      }

      throw new Error(`Unexpected Redis command: ${String(op)}`);
    },
  };

  return { deps, store, commands };
}

test("releasePendingIdempotencyKey deletes a matching pending claim with claimToken", async () => {
  forceMemoryBackend();
  const key = uniqueKey("match");
  const claimPayload = JSON.stringify({
    id: "__pending__",
    orderRef: "",
    pricingMode: "fixed",
    priceEuro: null,
    telegramOk: false,
    claimToken: "token-match-1",
  });

  assert.equal(bookingMemory.claimIdem(key, claimPayload), true);
  assert.equal(await releasePendingIdempotencyKey(key, claimPayload), true);
  assert.equal(bookingMemory.getIdem(key), null);
});

test("releasePendingIdempotencyKey rejects a mismatched claimToken", async () => {
  forceMemoryBackend();
  const key = uniqueKey("mismatch");
  const stored = JSON.stringify({
    id: "__pending__",
    orderRef: "",
    pricingMode: "fixed",
    priceEuro: null,
    telegramOk: false,
    claimToken: "token-stored",
  });
  const wrong = JSON.stringify({
    id: "__pending__",
    orderRef: "",
    pricingMode: "fixed",
    priceEuro: null,
    telegramOk: false,
    claimToken: "token-other",
  });

  assert.equal(bookingMemory.claimIdem(key, stored), true);
  assert.equal(await releasePendingIdempotencyKey(key, wrong), false);
  assert.equal(bookingMemory.getIdem(key), stored);
});

test("releasePendingIdempotencyKey returns false for a missing key", async () => {
  forceMemoryBackend();
  const key = uniqueKey("missing");
  const claimPayload = JSON.stringify({
    id: "__pending__",
    orderRef: "",
    pricingMode: "fixed",
    priceEuro: null,
    telegramOk: false,
    claimToken: "token-missing",
  });

  assert.equal(await releasePendingIdempotencyKey(key, claimPayload), false);
  assert.equal(bookingMemory.getIdem(key), null);
});

test("releasePendingIdempotencyKey rejects legacy pending without claimToken", async () => {
  forceMemoryBackend();
  const key = uniqueKey("legacy");
  const legacy = JSON.stringify({
    id: "__pending__",
    orderRef: "",
    pricingMode: "fixed",
    priceEuro: null,
    telegramOk: false,
  });

  assert.equal(bookingMemory.claimIdem(key, legacy), true);
  assert.equal(await releasePendingIdempotencyKey(key, legacy), false);
  assert.equal(bookingMemory.getIdem(key), legacy);
});

test("releasePendingIdempotencyKey cannot delete a completed order", async () => {
  forceMemoryBackend();
  const key = uniqueKey("completed");
  const completed = JSON.stringify({
    id: "order-completed-1",
    orderRef: "REF1",
    pricingMode: "fixed",
    priceEuro: 60,
    telegramOk: true,
  });

  bookingMemory.setIdem(key, completed);
  assert.equal(await releasePendingIdempotencyKey(key, completed), false);
  assert.equal(bookingMemory.getIdem(key), completed);
});

test("releasePendingIdempotencyKey cannot delete a replaced claim with an older payload", async () => {
  forceMemoryBackend();
  const key = uniqueKey("replaced");
  const oldPending = JSON.stringify({
    id: "__pending__",
    orderRef: "",
    pricingMode: "fixed",
    priceEuro: null,
    telegramOk: false,
    claimToken: "old-token",
  });
  const newPending = JSON.stringify({
    id: "__pending__",
    orderRef: "",
    pricingMode: "fixed",
    priceEuro: null,
    telegramOk: false,
    claimToken: "new-token",
  });

  assert.equal(bookingMemory.claimIdem(key, oldPending), true);
  bookingMemory.setIdem(key, newPending);
  assert.equal(await releasePendingIdempotencyKey(key, oldPending), false);
  assert.equal(bookingMemory.getIdem(key), newPending);
});

test("claimIdempotencyKeyWithToken returns claimed payload with pending id and UUID token", async () => {
  forceMemoryBackend();
  const key = uniqueKey("claim-success");
  const result = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER);

  assert.equal(result.status, "claimed");
  if (result.status !== "claimed") return;

  const parsed = JSON.parse(result.claimPayload) as {
    id?: unknown;
    claimToken?: unknown;
  };
  assert.equal(parsed.id, "__pending__");
  assert.equal(typeof parsed.claimToken, "string");
  assert.ok(
    typeof parsed.claimToken === "string" && UUID_RE.test(parsed.claimToken),
  );
});

test("claimIdempotencyKeyWithToken stores the exact returned claimPayload", async () => {
  forceMemoryBackend();
  const key = uniqueKey("claim-exact");
  const result = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER);

  assert.equal(result.status, "claimed");
  if (result.status !== "claimed") return;
  assert.equal(bookingMemory.getIdem(key), result.claimPayload);
});

test("claimIdempotencyKeyWithToken second claim returns exists without overwrite", async () => {
  forceMemoryBackend();
  const key = uniqueKey("claim-second");
  const first = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER);
  assert.equal(first.status, "claimed");
  if (first.status !== "claimed") return;

  const second = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER);
  assert.equal(second.status, "exists");
  assert.equal(bookingMemory.getIdem(key), first.claimPayload);
});

test("claimIdempotencyKeyWithToken issues different tokens for different keys", async () => {
  forceMemoryBackend();
  const keyA = uniqueKey("claim-token-a");
  const keyB = uniqueKey("claim-token-b");
  const a = await claimIdempotencyKeyWithToken(keyA, PENDING_PLACEHOLDER);
  const b = await claimIdempotencyKeyWithToken(keyB, PENDING_PLACEHOLDER);

  assert.equal(a.status, "claimed");
  assert.equal(b.status, "claimed");
  if (a.status !== "claimed" || b.status !== "claimed") return;

  const tokenA = (JSON.parse(a.claimPayload) as { claimToken: string }).claimToken;
  const tokenB = (JSON.parse(b.claimPayload) as { claimToken: string }).claimToken;
  assert.notEqual(tokenA, tokenB);
  assert.notEqual(a.claimPayload, b.claimPayload);
});

test("claimIdempotencyKeyWithToken rejects non-pending placeholder without claiming", async () => {
  forceMemoryBackend();
  const key = uniqueKey("claim-nonpending");
  const result = await claimIdempotencyKeyWithToken(key, {
    id: "not-pending",
    orderRef: "",
    pricingMode: "fixed",
    priceEuro: null,
    telegramOk: false,
  });

  assert.equal(result.status, "unavailable");
  assert.equal(bookingMemory.getIdem(key), null);
});

test("claimIdempotencyKeyWithToken release succeeds and allows a subsequent claim", async () => {
  forceMemoryBackend();
  const key = uniqueKey("claim-release-retry");
  const first = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER);
  assert.equal(first.status, "claimed");
  if (first.status !== "claimed") return;

  assert.equal(await releasePendingIdempotencyKey(key, first.claimPayload), true);
  assert.equal(bookingMemory.getIdem(key), null);

  const second = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER);
  assert.equal(second.status, "claimed");
  if (second.status !== "claimed") return;
  assert.notEqual(second.claimPayload, first.claimPayload);
});

test("claimIdempotencyKeyWithToken old payload cannot release a replacement claim", async () => {
  forceMemoryBackend();
  const key = uniqueKey("claim-stale-release");
  const first = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER);
  assert.equal(first.status, "claimed");
  if (first.status !== "claimed") return;

  assert.equal(await releasePendingIdempotencyKey(key, first.claimPayload), true);
  const second = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER);
  assert.equal(second.status, "claimed");
  if (second.status !== "claimed") return;

  assert.equal(await releasePendingIdempotencyKey(key, first.claimPayload), false);
  assert.equal(bookingMemory.getIdem(key), second.claimPayload);
});

test("fake Redis SET NX EX successfully claims and returns exact payload", async () => {
  const key = uniqueKey("redis-claim");
  const { deps, store, commands } = createFakeRedisDeps();
  const result = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER, deps);

  assert.equal(result.status, "claimed");
  if (result.status !== "claimed") return;

  const redisKey = `booking:idem:${key}`;
  assert.equal(store.get(redisKey), result.claimPayload);
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.[0], "SET");
  assert.equal(commands[0]?.[1], redisKey);
  assert.equal(commands[0]?.[2], result.claimPayload);
  assert.deepEqual(commands[0]?.slice(3), ["EX", 86400, "NX"]);
});

test("fake Redis duplicate SET NX returns exists without overwrite", async () => {
  const key = uniqueKey("redis-dup");
  const { deps, store } = createFakeRedisDeps();
  const first = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER, deps);
  assert.equal(first.status, "claimed");
  if (first.status !== "claimed") return;

  const second = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER, deps);
  assert.equal(second.status, "exists");
  assert.equal(store.get(`booking:idem:${key}`), first.claimPayload);
});

test("fake Redis EVAL with exact payload deletes the claim", async () => {
  const key = uniqueKey("redis-eval-match");
  const { deps, store, commands } = createFakeRedisDeps();
  const claimed = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER, deps);
  assert.equal(claimed.status, "claimed");
  if (claimed.status !== "claimed") return;

  assert.equal(
    await releasePendingIdempotencyKey(key, claimed.claimPayload, deps),
    true,
  );
  assert.equal(store.has(`booking:idem:${key}`), false);
  const evalCmd = commands.find((command) => command[0] === "EVAL");
  assert.ok(evalCmd);
  assert.equal(evalCmd?.[3], `booking:idem:${key}`);
  assert.equal(evalCmd?.[4], claimed.claimPayload);
});

test("fake Redis EVAL with different payload preserves the claim", async () => {
  const key = uniqueKey("redis-eval-mismatch");
  const { deps, store } = createFakeRedisDeps();
  const claimed = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER, deps);
  assert.equal(claimed.status, "claimed");
  if (claimed.status !== "claimed") return;

  const wrong = JSON.stringify({
    ...PENDING_PLACEHOLDER,
    claimToken: "00000000-0000-4000-8000-000000000000",
  });
  assert.equal(await releasePendingIdempotencyKey(key, wrong, deps), false);
  assert.equal(store.get(`booking:idem:${key}`), claimed.claimPayload);
});

test("fake Redis command error during release returns false", async () => {
  const key = uniqueKey("redis-eval-error");
  const good = createFakeRedisDeps();
  const claimed = await claimIdempotencyKeyWithToken(
    key,
    PENDING_PLACEHOLDER,
    good.deps,
  );
  assert.equal(claimed.status, "claimed");
  if (claimed.status !== "claimed") return;

  const broken = createFakeRedisDeps({ throwOnCommand: true });
  broken.store.set(`booking:idem:${key}`, claimed.claimPayload);
  assert.equal(
    await releasePendingIdempotencyKey(key, claimed.claimPayload, broken.deps),
    false,
  );
  assert.equal(broken.store.get(`booking:idem:${key}`), claimed.claimPayload);
});

test("fake Redis required without credentials returns unavailable and false", async () => {
  const key = uniqueKey("redis-required");
  const { deps } = createFakeRedisDeps({ credentials: false, required: true });
  const claim = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER, deps);
  assert.equal(claim.status, "unavailable");

  const release = await releasePendingIdempotencyKey(
    key,
    JSON.stringify({ ...PENDING_PLACEHOLDER, claimToken: "token" }),
    deps,
  );
  assert.equal(release, false);
});

test("fake Redis expiry and replacement: old claim cannot delete new claim", async () => {
  const key = uniqueKey("redis-expire-replace");
  const { deps, store } = createFakeRedisDeps();
  const first = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER, deps);
  assert.equal(first.status, "claimed");
  if (first.status !== "claimed") return;

  store.delete(`booking:idem:${key}`);
  const second = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER, deps);
  assert.equal(second.status, "claimed");
  if (second.status !== "claimed") return;

  assert.equal(await releasePendingIdempotencyKey(key, first.claimPayload, deps), false);
  assert.equal(store.get(`booking:idem:${key}`), second.claimPayload);
});

const COMPLETED: IdempotentOrderResult = {
  id: "ord-finalize-1",
  orderRef: "HV-FIN-1",
  pricingMode: "fixed",
  priceEuro: 120,
  telegramOk: true,
};

test("finalizePendingIdempotencyKey replaces owned pending claim in memory", async () => {
  forceMemoryBackend();
  const key = uniqueKey("fin-mem-ok");
  const claimed = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER);
  assert.equal(claimed.status, "claimed");
  if (claimed.status !== "claimed") return;

  const status = await finalizePendingIdempotencyKey(
    key,
    claimed.claimPayload,
    COMPLETED,
  );
  assert.equal(status, "finalized");
  assert.equal(bookingMemory.getIdem(key), JSON.stringify(COMPLETED));
});

test("finalizePendingIdempotencyKey rejects mismatched claimToken in memory", async () => {
  forceMemoryBackend();
  const key = uniqueKey("fin-mem-mismatch");
  const claimed = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER);
  assert.equal(claimed.status, "claimed");
  if (claimed.status !== "claimed") return;

  const stale = JSON.stringify({
    ...PENDING_PLACEHOLDER,
    claimToken: "00000000-0000-4000-8000-000000000099",
  });
  const status = await finalizePendingIdempotencyKey(key, stale, COMPLETED);
  assert.equal(status, "mismatch");
  assert.equal(bookingMemory.getIdem(key), claimed.claimPayload);
});

test("finalizePendingIdempotencyKey returns missing for absent memory key", async () => {
  forceMemoryBackend();
  const key = uniqueKey("fin-mem-missing");
  const payload = JSON.stringify({
    ...PENDING_PLACEHOLDER,
    claimToken: "11111111-1111-4111-8111-111111111111",
  });
  const status = await finalizePendingIdempotencyKey(key, payload, COMPLETED);
  assert.equal(status, "missing");
  assert.equal(bookingMemory.getIdem(key), null);
});

test("finalizePendingIdempotencyKey cannot overwrite completed result in memory", async () => {
  forceMemoryBackend();
  const key = uniqueKey("fin-mem-completed");
  const claimed = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER);
  assert.equal(claimed.status, "claimed");
  if (claimed.status !== "claimed") return;

  assert.equal(
    await finalizePendingIdempotencyKey(key, claimed.claimPayload, COMPLETED),
    "finalized",
  );
  const other: IdempotentOrderResult = {
    ...COMPLETED,
    id: "ord-other",
    telegramOk: false,
  };
  assert.equal(
    await finalizePendingIdempotencyKey(key, claimed.claimPayload, other),
    "mismatch",
  );
  assert.equal(bookingMemory.getIdem(key), JSON.stringify(COMPLETED));
});

test("fake Redis finalizePendingIdempotencyKey replaces owned pending claim", async () => {
  const key = uniqueKey("fin-redis-ok");
  const { deps, store } = createFakeRedisDeps();
  const claimed = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER, deps);
  assert.equal(claimed.status, "claimed");
  if (claimed.status !== "claimed") return;

  const status = await finalizePendingIdempotencyKey(
    key,
    claimed.claimPayload,
    COMPLETED,
    deps,
  );
  assert.equal(status, "finalized");
  assert.equal(store.get(`booking:idem:${key}`), JSON.stringify(COMPLETED));
});

test("fake Redis finalizePendingIdempotencyKey rejects foreign or stale claim", async () => {
  const key = uniqueKey("fin-redis-stale");
  const { deps, store } = createFakeRedisDeps();
  const first = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER, deps);
  assert.equal(first.status, "claimed");
  if (first.status !== "claimed") return;

  store.delete(`booking:idem:${key}`);
  const second = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER, deps);
  assert.equal(second.status, "claimed");
  if (second.status !== "claimed") return;

  assert.equal(
    await finalizePendingIdempotencyKey(key, first.claimPayload, COMPLETED, deps),
    "mismatch",
  );
  assert.equal(store.get(`booking:idem:${key}`), second.claimPayload);
});

test("fake Redis concurrent finalize: only matching owner wins", async () => {
  const key = uniqueKey("fin-redis-race");
  const { deps, store } = createFakeRedisDeps();
  const claimed = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER, deps);
  assert.equal(claimed.status, "claimed");
  if (claimed.status !== "claimed") return;

  const winner: IdempotentOrderResult = {
    ...COMPLETED,
    id: "ord-winner",
    orderRef: "HV-WIN",
  };
  const loser: IdempotentOrderResult = {
    ...COMPLETED,
    id: "ord-loser",
    orderRef: "HV-LOSE",
    telegramOk: false,
  };

  const first = await finalizePendingIdempotencyKey(
    key,
    claimed.claimPayload,
    winner,
    deps,
  );
  const second = await finalizePendingIdempotencyKey(
    key,
    claimed.claimPayload,
    loser,
    deps,
  );
  assert.equal(first, "finalized");
  assert.equal(second, "mismatch");
  assert.equal(store.get(`booking:idem:${key}`), JSON.stringify(winner));
});

test("fake Redis EVAL failure during finalize returns error not missing", async () => {
  const key = uniqueKey("fin-redis-eval-err");
  const good = createFakeRedisDeps();
  const claimed = await claimIdempotencyKeyWithToken(
    key,
    PENDING_PLACEHOLDER,
    good.deps,
  );
  assert.equal(claimed.status, "claimed");
  if (claimed.status !== "claimed") return;

  const broken = createFakeRedisDeps({ throwOnCommand: true });
  broken.store.set(`booking:idem:${key}`, claimed.claimPayload);

  assert.equal(
    await finalizePendingIdempotencyKey(
      key,
      claimed.claimPayload,
      COMPLETED,
      broken.deps,
    ),
    "error",
  );
  assert.equal(broken.store.get(`booking:idem:${key}`), claimed.claimPayload);
});

test("fake Redis finalize returns missing when owned key expired", async () => {
  const key = uniqueKey("fin-redis-expired");
  const { deps, store } = createFakeRedisDeps();
  const claimed = await claimIdempotencyKeyWithToken(key, PENDING_PLACEHOLDER, deps);
  assert.equal(claimed.status, "claimed");
  if (claimed.status !== "claimed") return;

  store.delete(`booking:idem:${key}`);
  assert.equal(
    await finalizePendingIdempotencyKey(
      key,
      claimed.claimPayload,
      COMPLETED,
      deps,
    ),
    "missing",
  );
});

test("Redis required without credentials finalize returns error", async () => {
  const key = uniqueKey("fin-redis-required");
  const { deps } = createFakeRedisDeps({ credentials: false, required: true });
  const payload = JSON.stringify({
    ...PENDING_PLACEHOLDER,
    claimToken: "token-required",
  });
  assert.equal(
    await finalizePendingIdempotencyKey(key, payload, COMPLETED, deps),
    "error",
  );
});
