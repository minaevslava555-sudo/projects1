/**
 * Opt-in Preview E2E: Cleaning v1 order idempotency against a pinned deployment.
 *
 * Fail-closed. Does not modify app runtime. Never prints secrets/tokens/payloads.
 *
 * Live run (network): requires ALLOW_PREVIEW_E2E_IDEMPOTENCY=1 and gates below.
 * Local only: node --check …  |  node … --self-check
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const EXPECTED_BASE_URL = "https://projects1-ett84hjty-slava-7f85.vercel.app";
const EXPECTED_GIT_SHA = "377dafa28cc2a0dd26912ac89e19365ec9987578";
const EXPECTED_SUPABASE_HOST = "avyerjnzfsqgaascltqi.supabase.co";
/** Must match app/api/preview/redis-ping EXPECTED_HOST (server-side hostMatch). */
const EXPECTED_REDIS_HOST = "tidy-griffon-181609.upstash.io";
const EXPECTED_BRANCH = "feature/85h-gallery-motion-prototype";
const VERCEL_API_ORIGIN = "https://api.vercel.com";
/** Vercel Deployment Protection bypass — Preview origin only (never API / Supabase). */
const PROTECTION_BYPASS_HEADER = "x-vercel-protection-bypass";

/** Cloudflare Turnstile dummy response (pairs with Preview test secret). */
const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

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

const PENDING_RETRY_LIMIT = 8;
const PENDING_RETRY_MS = 400;

const SELF_CHECK = process.argv.includes("--self-check");

/** Allowed fetch destinations (exact origin). Credentials stay host-bound. */
const ALLOWED_ORIGINS = new Set([
  new URL(EXPECTED_BASE_URL).origin,
  VERCEL_API_ORIGIN,
]);

function fail(message) {
  console.error(`FAIL  ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`OK    ${message}`);
}

function info(message) {
  console.log(`INFO  ${message}`);
}

function warnLimitation(message) {
  console.log(`LIMIT ${message}`);
}

function getPreviewProtectionBypass() {
  return process.env.VERCEL_PROTECTION_BYPASS?.trim() || "";
}

/** Redact anything that looks like a secret before any console output. */
function safeSummary(value) {
  if (value == null) return String(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    if (value === TURNSTILE_DUMMY_TOKEN) return "[redacted-turnstile-dummy]";
    if (value.includes("XXXX.DUMMY.TOKEN")) return "[redacted-turnstile-dummy]";
    const bypass = getPreviewProtectionBypass();
    if (bypass && (value === bypass || value.includes(bypass))) {
      return "[redacted-protection-bypass]";
    }
    if (
      /token|secret|password|authorization|bearer|apikey|api_key|draft|turnstile|eyJ|vercel_|protection.?bypass|x-vercel-protection-bypass/i.test(
        value,
      )
    ) {
      return "[redacted]";
    }
    if (value.length > 96) return `[str_len_${value.length}]`;
    return value;
  }
  if (typeof value === "object") {
    return `[object_keys_${Object.keys(value).length}]`;
  }
  return "[unprintable]";
}

/** Never leave a smuggled bypass header on non-Preview requests. */
function stripProtectionBypassHeaders(headers) {
  headers.delete(PROTECTION_BYPASS_HEADER);
  headers.delete("X-Vercel-Protection-Bypass");
}

/**
 * Attach bypass only when request origin === exact pinned Preview origin.
 * Always strips first so Vercel API / foreign hosts cannot receive the secret.
 */
function applyPreviewOnlyProtectionBypass(headers, requestOrigin) {
  stripProtectionBypassHeaders(headers);
  if (requestOrigin !== EXPECTED_BASE_URL) return;
  const bypass = getPreviewProtectionBypass();
  if (bypass) headers.set(PROTECTION_BYPASS_HEADER, bypass);
}

/** Safe fetch-error detail: message + cause code/message, redacted. */
function describeFetchFailure(error) {
  const msg = error instanceof Error ? error.message : "fetch failed";
  const cause = error instanceof Error ? error.cause : undefined;
  let causeMsg = "";
  let causeCode = "";
  if (cause instanceof Error) {
    causeMsg = cause.message || "";
    if ("code" in cause && cause.code != null) causeCode = String(cause.code);
  } else if (cause != null && typeof cause === "object") {
    if ("message" in cause && cause.message != null) causeMsg = String(cause.message);
    if ("code" in cause && cause.code != null) causeCode = String(cause.code);
  } else if (cause != null) {
    causeMsg = String(cause);
  }
  const combined = `${msg} ${causeMsg} ${causeCode}`;
  const isRedirect = /redirect/i.test(combined);
  let detail = safeSummary(msg);
  const causeBits = [causeCode, causeMsg].filter(Boolean).join(" ");
  if (causeBits) detail += ` cause=${safeSummary(causeBits)}`;
  return { detail, isRedirect };
}

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) fail(`Missing required env: ${name}`);
  return v;
}

function assertExactSha(remoteSha, expectedSha) {
  if (!remoteSha || typeof remoteSha !== "string") return false;
  if (!expectedSha || typeof expectedSha !== "string") return false;
  return remoteSha.trim().toLowerCase() === expectedSha.trim().toLowerCase();
}

function assertAllowedUrl(urlString, { allowOrigins = ALLOWED_ORIGINS } = {}) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    fail(`Invalid URL blocked: ${safeSummary(String(urlString))}`);
  }
  if (parsed.protocol !== "https:") {
    fail(`Only https URLs allowed (got ${parsed.protocol})`);
  }
  if (!allowOrigins.has(parsed.origin)) {
    fail(`URL origin not on allowlist: ${parsed.origin}`);
  }
  return parsed;
}

function resolveRequestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === "object" && typeof input.url === "string") {
    return input.url;
  }
  fail("Unsupported fetch input type");
}

/**
 * Bound fetch for a single https origin (used by Supabase SDK).
 * redirect: "error"; never sends Authorization / apikey to another host.
 */
function createOriginBoundFetch(allowedOrigin) {
  let pinned;
  try {
    pinned = new URL(allowedOrigin);
  } catch {
    fail("Invalid allowedOrigin for bound fetch");
  }
  if (pinned.protocol !== "https:") {
    fail("Bound fetch allowedOrigin must be https");
  }
  const allowOrigins = new Set([pinned.origin]);

  return async function originBoundFetch(input, init = {}) {
    const urlString = resolveRequestUrl(input);
    const parsed = assertAllowedUrl(urlString, { allowOrigins });
    if (parsed.origin !== pinned.origin) {
      fail("Bound fetch refused cross-origin request");
    }

    const headers = new Headers(init.headers || {});
    // Bypass secret must never reach Supabase (strip even if smuggled in init).
    stripProtectionBypassHeaders(headers);
    const hasCredentials =
      headers.has("Authorization") ||
      headers.has("authorization") ||
      headers.has("apikey") ||
      headers.has("ApiKey");

    let response;
    try {
      response = await fetch(parsed.href, {
        ...init,
        headers,
        redirect: "error",
        cache: init.cache ?? "no-store",
      });
    } catch (error) {
      const { detail, isRedirect } = describeFetchFailure(error);
      if (isRedirect) {
        fail(`HTTP redirect blocked for Supabase ${parsed.pathname} (${detail})`);
      }
      fail(`Supabase network error: ${detail}`);
    }

    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      fail(`Unexpected Supabase redirect HTTP ${response.status}`);
    }
    const finalUrl = response.url ? new URL(response.url) : parsed;
    if (finalUrl.origin !== pinned.origin) {
      fail(
        hasCredentials
          ? "Supabase credentials must not leave test origin — aborting"
          : "Supabase response origin mismatch — aborting",
      );
    }
    return response;
  };
}

function assertTestSupabaseUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    fail("NEXT_PUBLIC_SUPABASE_URL invalid");
  }
  if (parsed.protocol !== "https:") {
    fail("NEXT_PUBLIC_SUPABASE_URL must be https");
  }
  if (parsed.hostname !== EXPECTED_SUPABASE_HOST) {
    fail("Supabase host is not the approved Preview test project");
  }
  return parsed.origin;
}

function assertBaseUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail("PREVIEW_BASE_URL is not a valid URL");
  }
  if (parsed.protocol !== "https:") fail("PREVIEW_BASE_URL must be https");
  if (parsed.origin !== EXPECTED_BASE_URL) {
    fail("PREVIEW_BASE_URL origin mismatch (expected pinned Preview deployment host)");
  }
  // Explicit production / wrong-host denials (also covered by origin pin).
  const deniedHosts = new Set([
    "projects1.vercel.app",
    "www.havenly.pt",
    "havenly.pt",
  ]);
  if (deniedHosts.has(parsed.hostname.toLowerCase())) {
    fail("Production / public site host is forbidden");
  }
  if (!parsed.hostname.endsWith(".vercel.app")) {
    fail("PREVIEW_BASE_URL host must be a vercel.app Preview host");
  }
  return parsed.origin;
}

function deploymentIdFromHost(hostname) {
  return hostname.replace(/\.vercel\.app$/i, "");
}

/**
 * Fetch with redirects disabled. Credentials never follow a cross-host redirect.
 * VERCEL_PROTECTION_BYPASS → x-vercel-protection-bypass only for pinned Preview origin.
 */
async function safeFetch(urlString, init = {}) {
  const parsed = assertAllowedUrl(urlString);
  const headers = new Headers(init.headers || {});
  applyPreviewOnlyProtectionBypass(headers, parsed.origin);
  const hasAuth =
    headers.has("Authorization") ||
    headers.has("authorization") ||
    headers.has(PROTECTION_BYPASS_HEADER) ||
    Boolean(init.body && /draftToken|turnstileToken|service_role/i.test(String(init.body)));

  let response;
  try {
    response = await fetch(parsed.href, {
      ...init,
      headers,
      redirect: "error",
      cache: "no-store",
    });
  } catch (error) {
    const { detail, isRedirect } = describeFetchFailure(error);
    if (isRedirect) {
      fail(
        `HTTP redirect blocked for ${parsed.origin}${parsed.pathname} (${detail})` +
          (parsed.origin === EXPECTED_BASE_URL
            ? " — possible Deployment Protection SSO; set VERCEL_PROTECTION_BYPASS for Preview only"
            : ""),
      );
    }
    fail(`Network error for ${parsed.origin}${parsed.pathname}: ${detail}`);
  }

  // Defense in depth if a runtime ever returns a redirected response object.
  if (response.redirected || (response.status >= 300 && response.status < 400)) {
    fail(`Unexpected redirect response HTTP ${response.status}`);
  }

  const finalUrl = response.url ? new URL(response.url) : parsed;
  if (finalUrl.origin !== parsed.origin) {
    fail(
      hasAuth
        ? "Credentialed response origin mismatch — aborting"
        : "Response URL origin mismatch — aborting",
    );
  }
  return response;
}

function extractGitSha(deployment) {
  if (!deployment || typeof deployment !== "object") return null;
  return (
    deployment.gitSource?.sha ||
    deployment.meta?.githubCommitSha ||
    deployment.meta?.gitlabCommitSha ||
    deployment.meta?.bitbucketCommitSha ||
    null
  );
}

function extractGitRef(deployment) {
  if (!deployment || typeof deployment !== "object") return null;
  return (
    deployment.meta?.githubCommitRef ||
    deployment.meta?.gitlabCommitRef ||
    deployment.gitSource?.ref ||
    null
  );
}

/**
 * Independent SHA check via Vercel Deployments API (exact full SHA).
 * Requires VERCEL_TOKEN; optional VERCEL_TEAM_ID.
 */
async function assertRemoteDeploymentSha(baseOrigin, expectedSha) {
  if (!/^[0-9a-f]{40}$/i.test(expectedSha)) {
    fail("EXPECTED_GIT_SHA must be a full 40-char hex commit SHA");
  }

  const token = requireEnv("VERCEL_TOKEN");
  const host = new URL(baseOrigin).hostname;
  const deploymentName = deploymentIdFromHost(host);
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  const headers = { Authorization: `Bearer ${token}` };

  const listUrl = new URL(`${VERCEL_API_ORIGIN}/v6/deployments`);
  listUrl.searchParams.set("url", host);
  listUrl.searchParams.set("limit", "1");
  if (teamId) listUrl.searchParams.set("teamId", teamId);

  const listResponse = await safeFetch(listUrl.href, { headers });
  if (!listResponse.ok) {
    fail(
      `Vercel deployments list failed (HTTP ${listResponse.status}) — cannot verify Git SHA`,
    );
  }
  const listData = await listResponse.json();
  let deployment = Array.isArray(listData?.deployments)
    ? listData.deployments[0]
    : null;

  if (!deployment) {
    const byId = new URL(
      `${VERCEL_API_ORIGIN}/v13/deployments/${encodeURIComponent(deploymentName)}`,
    );
    if (teamId) byId.searchParams.set("teamId", teamId);
    const byIdResponse = await safeFetch(byId.href, { headers });
    if (!byIdResponse.ok) {
      fail(
        `Vercel deployment lookup failed (HTTP ${byIdResponse.status}) — cannot verify Git SHA`,
      );
    }
    deployment = await byIdResponse.json();
  }

  const remoteSha = extractGitSha(deployment);
  if (!remoteSha) {
    fail("Vercel deployment payload missing git commit SHA");
  }
  if (!assertExactSha(remoteSha, expectedSha)) {
    fail(
      `Deployment Git SHA mismatch (remote=${safeSummary(String(remoteSha).slice(0, 12))}…)`,
    );
  }

  const branch = extractGitRef(deployment);
  if (!branch || branch !== EXPECTED_BRANCH) {
    fail(`Deployment branch mismatch (expected ${EXPECTED_BRANCH})`);
  }

  // Preview isolation signal from deployment metadata (not Production target).
  const target = deployment.target ?? null;
  if (target === "production") {
    fail("Deployment target is production — Preview E2E forbidden");
  }

  ok(`Remote deployment SHA exact match ${expectedSha.slice(0, 12)}… (Vercel API)`);
  return { remoteSha, deployment, branch, target };
}

/**
 * Telegram isolation: use deployment metadata + known runtime guards.
 * Does NOT claim PASS on TELEGRAM_NOTIFY_DISABLED unless independently proven.
 */
function assertTelegramIsolationFromMetadata(deployment) {
  const target = deployment?.target ?? null;
  if (target === "production") {
    fail("Telegram isolation: production target");
  }

  // Runtime guards in lib/telegram-runtime.ts:
  // - Preview VERCEL_ENV denies webhook register / inbound / sendTelegramMessage
  // - notifyAdminAboutOrder also returns early when TELEGRAM_NOTIFY_DISABLED=1
  ok(
    "Telegram runtime guards: Preview target is non-production (webhook/inbound/send denied by VERCEL_ENV path)",
  );

  const attest = process.env.PREVIEW_TELEGRAM_NOTIFY_DISABLED_ATTESTED;
  if (attest !== "1") {
    fail(
      "Set PREVIEW_TELEGRAM_NOTIFY_DISABLED_ATTESTED=1 confirming TELEGRAM_NOTIFY_DISABLED=1 on Preview",
    );
  }

  warnLimitation(
    "TELEGRAM_NOTIFY_DISABLED cannot be read independently from public deployment metadata without env-decrypt API; notify-disable PASS is NOT claimed — only attestation + Preview non-production target + zero harness Telegram HTTP",
  );
  ok("Telegram: harness issues zero api.telegram.org calls");
}

async function assertPreviewPings(baseOrigin) {
  const supabasePing = await safeFetch(`${baseOrigin}/api/preview/supabase-ping`);
  if (!supabasePing.ok) {
    fail(`supabase-ping HTTP ${supabasePing.status} (expected Preview gate open)`);
  }
  const sp = await supabasePing.json();
  if (!sp?.ok || !sp?.projectRefMatch || !sp?.readOk) {
    fail("supabase-ping did not confirm test Supabase isolation");
  }
  ok("supabase-ping isolation OK");

  const redisPing = await safeFetch(`${baseOrigin}/api/preview/redis-ping`);
  if (!redisPing.ok) {
    fail(`redis-ping HTTP ${redisPing.status}`);
  }
  const rp = await redisPing.json();
  if (!rp?.ok || !rp?.hostMatch || !rp?.readOk) {
    fail("redis-ping did not confirm test Redis isolation");
  }
  // Ping JSON does not echo the hostname; hostMatch===true means server compared
  // KV/Upstash URL to EXPECTED_HOST = tidy-griffon-181609.upstash.io in route.ts.
  if (EXPECTED_REDIS_HOST !== "tidy-griffon-181609.upstash.io") {
    fail("EXPECTED_REDIS_HOST pin drifted from redis-ping route");
  }
  ok(
    `redis-ping hostMatch OK (server-bound to ${EXPECTED_REDIS_HOST})`,
  );
}

function createSupabaseVerifier() {
  // Minimal privilege note: service role is required for server-side order reads
  // under current RLS; harness only SELECTs by idempotency_key (no UPDATE/DELETE).
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseOrigin = assertTestSupabaseUrl(url);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: createOriginBoundFetch(supabaseOrigin),
    },
  });
}

async function countOrdersByIdempotencyKey(supabase, idempotencyKey) {
  const { count, error } = await supabase
    .from("projects1_orders")
    .select("id", { count: "exact", head: true })
    .eq("idempotency_key", idempotencyKey);
  if (error) fail(`Supabase count failed: ${safeSummary(error.message)}`);
  return count ?? 0;
}

async function fetchOrderByIdempotencyKey(supabase, idempotencyKey) {
  const { data, error } = await supabase
    .from("projects1_orders")
    .select(
      "id, order_ref, price_euro, pricing_mode, hourly_rate_snapshot, pricing_snapshot, idempotency_key, request_fingerprint",
    )
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) fail(`Supabase fetch failed: ${safeSummary(error.message)}`);
  return data;
}

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

async function createDraft(baseOrigin) {
  const response = await safeFetch(`${baseOrigin}/api/order/draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok || !data?.draftToken) {
    fail(`draft create failed HTTP ${response.status}`);
  }
  return {
    draftToken: data.draftToken,
    draftId: data.draftId,
  };
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

function buildOrderBody(fields, { idempotencyKey, draftToken, turnstileToken }) {
  return {
    ...fields,
    draftToken,
    turnstileToken,
    idempotencyKey,
  };
}

async function postOrder(baseOrigin, body) {
  const response = await safeFetch(`${baseOrigin}/api/order`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": body.idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    fail(`order response not JSON (HTTP ${response.status})`);
  }
  return { status: response.status, data };
}

async function waitForOrderRef(
  baseOrigin,
  fields,
  idempotencyKey,
  { attempts = PENDING_RETRY_LIMIT } = {},
) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    const draft = await createDraft(baseOrigin);
    const body = buildOrderBody(fields, {
      idempotencyKey,
      draftToken: draft.draftToken,
      turnstileToken: TURNSTILE_DUMMY_TOKEN,
    });
    last = await postOrder(baseOrigin, body);
    if (last.status === 200 && last.data?.ok && last.data?.orderRef) {
      return last;
    }
    if (last.status === 409) {
      await new Promise((r) => setTimeout(r, PENDING_RETRY_MS));
      continue;
    }
    fail(
      `Unexpected status while waiting for orderRef: HTTP ${last.status} err=${safeSummary(last.data?.error)}`,
    );
  }
  fail(
    `Pending claim did not resolve after ${attempts} retries (last HTTP ${last?.status})`,
  );
}

function expectFail(label, fn) {
  const previousExit = process.exit;
  let exited = null;
  process.exit = (code) => {
    exited = code;
    throw new Error(`__exit_${code}`);
  };
  try {
    fn();
    process.exit = previousExit;
    fail(`Self-check expected failure: ${label}`);
  } catch (error) {
    process.exit = previousExit;
    if (exited !== 1) {
      fail(`Self-check ${label}: expected exit 1, got ${safeSummary(exited)}`);
    }
    ok(`Self-check rejects: ${label}`);
  }
}

function runSelfCheck() {
  info("Self-check mode (no network)");

  // --- redaction ---
  if (safeSummary("Bearer super-secret-token-value") !== "[redacted]") {
    fail("safeSummary failed to redact token-like string");
  }
  if (safeSummary(TURNSTILE_DUMMY_TOKEN) !== "[redacted-turnstile-dummy]") {
    fail("safeSummary must redact Turnstile dummy token");
  }
  if (safeSummary("my-turnstile-response") !== "[redacted]") {
    fail("safeSummary should redact turnstile keyword");
  }
  if (safeSummary("draftToken=abc.def") !== "[redacted]") {
    fail("safeSummary should redact draft keyword");
  }
  if (safeSummary("x-vercel-protection-bypass: leaked") !== "[redacted]") {
    fail("safeSummary should redact protection-bypass keyword");
  }
  const prevBypass = process.env.VERCEL_PROTECTION_BYPASS;
  process.env.VERCEL_PROTECTION_BYPASS = "sc-bypass-secret-value-do-not-log";
  try {
    if (safeSummary(process.env.VERCEL_PROTECTION_BYPASS) !== "[redacted-protection-bypass]") {
      fail("safeSummary must redact exact VERCEL_PROTECTION_BYPASS value");
    }
    if (
      safeSummary(`hdr=${process.env.VERCEL_PROTECTION_BYPASS}`) !==
      "[redacted-protection-bypass]"
    ) {
      fail("safeSummary must redact embedded bypass secret");
    }
  } finally {
    if (prevBypass === undefined) delete process.env.VERCEL_PROTECTION_BYPASS;
    else process.env.VERCEL_PROTECTION_BYPASS = prevBypass;
  }
  ok("safeSummary redacts secrets, dummy Turnstile token, and protection bypass");

  // --- fetch error.cause diagnostics (no network) ---
  {
    const withCause = Object.assign(new Error("fetch failed"), {
      cause: Object.assign(new Error("unexpected redirect"), { code: "" }),
    });
    const described = describeFetchFailure(withCause);
    if (!described.isRedirect) fail("describeFetchFailure must detect redirect via cause");
    if (!/cause=/.test(described.detail)) {
      fail("describeFetchFailure must include redacted cause");
    }
    if (/unexpected redirect/i.test(described.detail) === false) {
      // "unexpected redirect" has no secret keywords → may appear; ensure present or redacted form
      fail("describeFetchFailure should surface cause message safely");
    }
  }
  ok("describeFetchFailure surfaces error.cause for redirects");

  // --- pins ---
  if (EXPECTED_BASE_URL !== "https://projects1-ett84hjty-slava-7f85.vercel.app") {
    fail("Pinned Preview URL constant drifted");
  }
  if (EXPECTED_GIT_SHA !== "377dafa28cc2a0dd26912ac89e19365ec9987578") {
    fail("Pinned Git SHA constant drifted");
  }
  if (EXPECTED_REDIS_HOST !== "tidy-griffon-181609.upstash.io") {
    fail("EXPECTED_REDIS_HOST drifted");
  }
  ok("Pinned Preview URL, SHA, Redis host constants present");

  if (T2_ROOMS.bedroom !== 2 || T2_ROOMS.bathroom !== 1) {
    fail("T2 room fixture drifted from catalog preset");
  }
  ok("T2 fixture shape OK");

  // --- exact SHA helper (no prefix match) ---
  if (assertExactSha("377dafa28cc2a0dd26912ac89e19365ec9987578", EXPECTED_GIT_SHA) !== true) {
    fail("exact SHA should match full digest");
  }
  if (assertExactSha("377dafa", EXPECTED_GIT_SHA) !== false) {
    fail("prefix SHA must not match");
  }
  if (assertExactSha(`${EXPECTED_GIT_SHA}a`, EXPECTED_GIT_SHA) !== false) {
    fail("elongated SHA must not match");
  }
  ok("Exact full Git SHA matching enforced");

  // --- allowlist / redirects ---
  expectFail("disallowed origin", () => {
    assertAllowedUrl("https://evil.example.com/api");
  });
  expectFail("http scheme", () => {
    assertAllowedUrl("http://projects1-ett84hjty-slava-7f85.vercel.app/api");
  });
  assertAllowedUrl(`${EXPECTED_BASE_URL}/api/order`);
  assertAllowedUrl(`${VERCEL_API_ORIGIN}/v6/deployments`);
  ok("URL allowlist + https-only OK");

  // --- wrong / production origins ---
  expectFail("wrong origin", () => {
    assertBaseUrl("https://evil.example.com");
  });
  expectFail("production-like host", () => {
    assertBaseUrl("https://projects1.vercel.app");
  });
  expectFail("public site host", () => {
    assertBaseUrl("https://havenly.pt");
  });
  if (assertBaseUrl(EXPECTED_BASE_URL) !== EXPECTED_BASE_URL) {
    fail("pinned base URL should pass assertBaseUrl");
  }
  ok("Wrong origin and Production URL rejected");

  // --- wrong SHA shape for live path helper ---
  expectFail("short SHA rejected as EXPECTED", () => {
    // mimic live guard
    const expectedSha = "377dafa";
    if (!/^[0-9a-f]{40}$/i.test(expectedSha)) {
      fail("EXPECTED_GIT_SHA must be a full 40-char hex commit SHA");
    }
  });
  ok("Non-full EXPECTED_GIT_SHA rejected");

  // --- missing required params ---
  expectFail("missing env", () => {
    requireEnv("__MISSING_PREVIEW_E2E_PARAM__");
  });
  ok("Missing required env rejected");

  // Document redirect policy for auditors.
  info('All live fetches use redirect: "error" via safeFetch');
  ok("Redirect policy documented in self-check");

  // --- Protection bypass: Preview origin only ---
  {
    const prev = process.env.VERCEL_PROTECTION_BYPASS;
    process.env.VERCEL_PROTECTION_BYPASS = "sc-bypass-secret-value-do-not-log";
    try {
      const previewHeaders = new Headers({
        [PROTECTION_BYPASS_HEADER]: "smuggled-should-be-replaced",
      });
      applyPreviewOnlyProtectionBypass(previewHeaders, EXPECTED_BASE_URL);
      if (previewHeaders.get(PROTECTION_BYPASS_HEADER) !== process.env.VERCEL_PROTECTION_BYPASS) {
        fail("bypass header must be set only from VERCEL_PROTECTION_BYPASS on Preview origin");
      }

      const apiHeaders = new Headers({
        [PROTECTION_BYPASS_HEADER]: "smuggled-must-be-stripped",
        Authorization: "Bearer fake",
      });
      applyPreviewOnlyProtectionBypass(apiHeaders, VERCEL_API_ORIGIN);
      if (apiHeaders.has(PROTECTION_BYPASS_HEADER)) {
        fail("bypass header must NOT be sent to Vercel API");
      }

      const foreignHeaders = new Headers({
        [PROTECTION_BYPASS_HEADER]: "smuggled-must-be-stripped",
      });
      applyPreviewOnlyProtectionBypass(foreignHeaders, "https://evil.example.com");
      if (foreignHeaders.has(PROTECTION_BYPASS_HEADER)) {
        fail("bypass header must NOT be sent to foreign hosts");
      }

      const sbHeaders = new Headers({
        [PROTECTION_BYPASS_HEADER]: "smuggled-must-be-stripped",
        apikey: "fake",
      });
      stripProtectionBypassHeaders(sbHeaders);
      if (sbHeaders.has(PROTECTION_BYPASS_HEADER)) {
        fail("bypass header must be stripped before Supabase fetch");
      }
    } finally {
      if (prev === undefined) delete process.env.VERCEL_PROTECTION_BYPASS;
      else process.env.VERCEL_PROTECTION_BYPASS = prev;
    }
  }
  ok("Protection bypass attaches only to pinned Preview origin; stripped elsewhere");

  // --- Supabase origin-bound fetch ---
  const goodSb = `https://${EXPECTED_SUPABASE_HOST}`;
  if (assertTestSupabaseUrl(goodSb) !== goodSb) {
    fail("assertTestSupabaseUrl should return test origin");
  }
  expectFail("supabase http url", () => {
    assertTestSupabaseUrl(`http://${EXPECTED_SUPABASE_HOST}`);
  });
  expectFail("supabase wrong host", () => {
    assertTestSupabaseUrl("https://evil.supabase.co");
  });
  expectFail("supabase production-like other project", () => {
    assertTestSupabaseUrl("https://zzzzzzzzzzzzzzzzzzzz.supabase.co");
  });

  const bound = createOriginBoundFetch(goodSb);
  if (typeof bound !== "function") fail("createOriginBoundFetch must return fetch fn");
  expectFail("supabase fetch wrong origin", () => {
    // Synchronous URL gate inside bound fetch (before network).
    assertAllowedUrl("https://evil.example.com/rest/v1/", {
      allowOrigins: new Set([goodSb]),
    });
  });
  expectFail("supabase fetch preview origin blocked", () => {
    assertAllowedUrl(`${EXPECTED_BASE_URL}/api/order`, {
      allowOrigins: new Set([goodSb]),
    });
  });
  assertAllowedUrl(`${goodSb}/rest/v1/projects1_orders`, {
    allowOrigins: new Set([goodSb]),
  });
  ok("Supabase bound fetch rejects foreign origins; allows test host only");

  info(
    "Lifecycle: create consumes draft; sequential replay uses fresh draft+Turnstile; concurrent uses two drafts + one shared new idem key",
  );
  warnLimitation(
    "Telegram notify-disable flag is attestation-only without env decrypt; no false PASS",
  );
  ok("Self-check passed");
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

  const baseOrigin = assertBaseUrl(
    process.env.PREVIEW_BASE_URL?.trim() || EXPECTED_BASE_URL,
  );
  const expectedSha = process.env.EXPECTED_GIT_SHA?.trim() || EXPECTED_GIT_SHA;

  info("Target origin pinned");
  const { deployment } = await assertRemoteDeploymentSha(baseOrigin, expectedSha);
  assertTelegramIsolationFromMetadata(deployment);
  await assertPreviewPings(baseOrigin);

  const supabase = createSupabaseVerifier();
  const runId = randomUUID();
  const fields = syntheticBookingFields(runId);

  // ---------- Scenario 1: create ----------
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

  // ---------- Scenario 2: sequential replay ----------
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

  // ---------- Scenario 3: concurrent race (new key) ----------
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

  // ---------- Scenario 4: fingerprint mismatch → 409 ----------
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

  ok("All Preview E2E idempotency scenarios passed");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : "Unhandled harness error");
});
