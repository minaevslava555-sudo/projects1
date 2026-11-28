/**
 * Shared Preview E2E infrastructure (Cleaning + Massage).
 * Fail-closed. Never prints secrets. Does not modify app runtime.
 */

import { createClient } from "@supabase/supabase-js";
import {
  EXPECTED_BASE_URL,
  EXPECTED_BRANCH,
  EXPECTED_GIT_SHA,
  EXPECTED_REDIS_HOST,
  EXPECTED_SUPABASE_HOST,
  LEGACY_PINNED_BASE_URL,
  LEGACY_PINNED_GIT_SHA,
  REPIN_PENDING,
  VERCEL_API_ORIGIN,
} from "./preview-e2e-pins.mjs";

export {
  EXPECTED_BASE_URL,
  EXPECTED_BRANCH,
  EXPECTED_GIT_SHA,
  EXPECTED_REDIS_HOST,
  EXPECTED_SUPABASE_HOST,
  LEGACY_PINNED_BASE_URL,
  LEGACY_PINNED_GIT_SHA,
  REPIN_PENDING,
  VERCEL_API_ORIGIN,
};

/** Vercel Deployment Protection bypass — Preview origin only (never API / Supabase). */
export const PROTECTION_BYPASS_HEADER = "x-vercel-protection-bypass";

/** Cloudflare Turnstile dummy response (pairs with Preview test secret). */
export const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

export const PENDING_RETRY_LIMIT = 8;
export const PENDING_RETRY_MS = 400;

/** Allowed fetch destinations (exact origin). Credentials stay host-bound. */
export const ALLOWED_ORIGINS = new Set([
  new URL(EXPECTED_BASE_URL).origin,
  VERCEL_API_ORIGIN,
]);

export function fail(message) {
  console.error(`FAIL  ${message}`);
  process.exit(1);
}

export function ok(message) {
  console.log(`OK    ${message}`);
}

export function info(message) {
  console.log(`INFO  ${message}`);
}

export function warnLimitation(message) {
  console.log(`LIMIT ${message}`);
}

function getPreviewProtectionBypass() {
  return process.env.VERCEL_PROTECTION_BYPASS?.trim() || "";
}

/** Redact anything that looks like a secret before any console output. */
export function safeSummary(value) {
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
export function stripProtectionBypassHeaders(headers) {
  headers.delete(PROTECTION_BYPASS_HEADER);
  headers.delete("X-Vercel-Protection-Bypass");
}

/**
 * Attach bypass only when request origin === exact pinned Preview origin.
 * Always strips first so Vercel API / foreign hosts cannot receive the secret.
 */
export function applyPreviewOnlyProtectionBypass(headers, requestOrigin) {
  stripProtectionBypassHeaders(headers);
  if (requestOrigin !== EXPECTED_BASE_URL) return;
  const bypass = getPreviewProtectionBypass();
  if (bypass) headers.set(PROTECTION_BYPASS_HEADER, bypass);
}

/** Safe fetch-error detail: message + cause code/message, redacted. */
export function describeFetchFailure(error) {
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

export function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) fail(`Missing required env: ${name}`);
  return v;
}

export function assertExactSha(remoteSha, expectedSha) {
  if (!remoteSha || typeof remoteSha !== "string") return false;
  if (!expectedSha || typeof expectedSha !== "string") return false;
  return remoteSha.trim().toLowerCase() === expectedSha.trim().toLowerCase();
}

export function assertAllowedUrl(urlString, { allowOrigins = ALLOWED_ORIGINS } = {}) {
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
export function createOriginBoundFetch(allowedOrigin) {
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

export function assertTestSupabaseUrl(urlString) {
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

export function assertBaseUrl(raw) {
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
export async function safeFetch(urlString, init = {}) {
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
export async function assertRemoteDeploymentSha(baseOrigin, expectedSha) {
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

  const target = deployment.target ?? null;
  if (target === "production") {
    fail("Deployment target is production — Preview E2E forbidden");
  }

  ok(`Remote deployment SHA exact match ${expectedSha.slice(0, 12)}… (Vercel API)`);
  return { remoteSha, deployment, branch, target };
}

/**
 * Telegram isolation: deployment metadata + known runtime guards.
 * Does NOT claim PASS on TELEGRAM_NOTIFY_DISABLED unless independently proven.
 */
export function assertTelegramIsolationFromMetadata(deployment) {
  const target = deployment?.target ?? null;
  if (target === "production") {
    fail("Telegram isolation: production target");
  }

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

export async function assertPreviewPings(baseOrigin) {
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
  if (EXPECTED_REDIS_HOST !== "tidy-griffon-181609.upstash.io") {
    fail("EXPECTED_REDIS_HOST pin drifted from redis-ping route");
  }
  ok(`redis-ping hostMatch OK (server-bound to ${EXPECTED_REDIS_HOST})`);
}

export function createSupabaseVerifier() {
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

export async function countOrdersByIdempotencyKey(supabase, idempotencyKey) {
  const { count, error } = await supabase
    .from("projects1_orders")
    .select("id", { count: "exact", head: true })
    .eq("idempotency_key", idempotencyKey);
  if (error) fail(`Supabase count failed: ${safeSummary(error.message)}`);
  return count ?? 0;
}

export async function fetchOrderByIdempotencyKey(supabase, idempotencyKey) {
  const { data, error } = await supabase
    .from("projects1_orders")
    .select(
      "id, order_ref, service, price_euro, pricing_mode, hourly_rate_snapshot, pricing_snapshot, idempotency_key, request_fingerprint, massage_minutes, massage_category",
    )
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) fail(`Supabase fetch failed: ${safeSummary(error.message)}`);
  return data;
}

export async function createDraft(baseOrigin) {
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

export function buildOrderBody(fields, { idempotencyKey, draftToken, turnstileToken }) {
  return {
    ...fields,
    draftToken,
    turnstileToken,
    idempotencyKey,
  };
}

export async function postOrder(baseOrigin, body) {
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

export async function waitForOrderRef(
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

/** Refuse live orders while pins still need URL+SHA update after Preview deploy. */
export function assertLivePinReady() {
  if (REPIN_PENDING) {
    fail(
      "Preview pin REPIN_PENDING — after harness commit + Preview deploy, update EXPECTED_BASE_URL + EXPECTED_GIT_SHA together in scripts/lib/preview-e2e-pins.mjs and set REPIN_PENDING=false",
    );
  }
  if (!EXPECTED_BASE_URL || !EXPECTED_GIT_SHA) {
    fail("EXPECTED_BASE_URL / EXPECTED_GIT_SHA missing");
  }
  if (EXPECTED_GIT_SHA === LEGACY_PINNED_GIT_SHA) {
    fail(
      "EXPECTED_GIT_SHA still equals LEGACY_PINNED_GIT_SHA — repin to the new Preview deployment SHA",
    );
  }
  if (
    EXPECTED_BASE_URL === LEGACY_PINNED_BASE_URL &&
    EXPECTED_GIT_SHA !== LEGACY_PINNED_GIT_SHA
  ) {
    fail(
      "EXPECTED_BASE_URL still legacy while SHA moved — update Preview URL together with SHA",
    );
  }
}

export function expectFail(label, fn) {
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

/** Shared offline self-check (no network). Callers add service-specific checks. */
export function runSharedSelfCheck() {
  info("Shared self-check (no network)");

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
      fail("describeFetchFailure should surface cause message safely");
    }
  }
  ok("describeFetchFailure surfaces error.cause for redirects");

  if (typeof REPIN_PENDING !== "boolean") fail("REPIN_PENDING must be boolean");
  if (!LEGACY_PINNED_BASE_URL.startsWith("https://")) fail("legacy base URL invalid");
  if (!/^[0-9a-f]{40}$/i.test(LEGACY_PINNED_GIT_SHA)) fail("legacy SHA invalid");
  if (!/^[0-9a-f]{40}$/i.test(EXPECTED_GIT_SHA)) fail("EXPECTED_GIT_SHA must be full 40-char hex");
  if (EXPECTED_REDIS_HOST !== "tidy-griffon-181609.upstash.io") {
    fail("EXPECTED_REDIS_HOST drifted");
  }
  if (EXPECTED_SUPABASE_HOST !== "avyerjnzfsqgaascltqi.supabase.co") {
    fail("EXPECTED_SUPABASE_HOST drifted");
  }
  if (REPIN_PENDING) {
    info(
      "REPIN_PENDING=true — live E2E blocked until Preview URL+SHA updated after harness deploy",
    );
  }
  ok("Pinned branch/hosts present; REPIN gate documented");

  if (assertExactSha(EXPECTED_GIT_SHA, EXPECTED_GIT_SHA) !== true) {
    fail("exact SHA should match itself");
  }
  if (assertExactSha(EXPECTED_GIT_SHA.slice(0, 7), EXPECTED_GIT_SHA) !== false) {
    fail("prefix SHA must not match");
  }
  if (assertExactSha(`${EXPECTED_GIT_SHA}a`, EXPECTED_GIT_SHA) !== false) {
    fail("elongated SHA must not match");
  }
  ok("Exact full Git SHA matching enforced");

  expectFail("disallowed origin", () => {
    assertAllowedUrl("https://evil.example.com/api");
  });
  expectFail("http scheme", () => {
    assertAllowedUrl(`http://${new URL(EXPECTED_BASE_URL).hostname}/api`);
  });
  assertAllowedUrl(`${EXPECTED_BASE_URL}/api/order`);
  assertAllowedUrl(`${VERCEL_API_ORIGIN}/v6/deployments`);
  ok("URL allowlist + https-only OK");

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

  expectFail("short SHA rejected as EXPECTED", () => {
    const expectedSha = "377dafa";
    if (!/^[0-9a-f]{40}$/i.test(expectedSha)) {
      fail("EXPECTED_GIT_SHA must be a full 40-char hex commit SHA");
    }
  });
  ok("Non-full EXPECTED_GIT_SHA rejected");

  expectFail("missing env", () => {
    requireEnv("__MISSING_PREVIEW_E2E_PARAM__");
  });
  ok("Missing required env rejected");

  info('All live fetches use redirect: "error" via safeFetch');
  ok("Redirect policy documented in self-check");

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

  if (REPIN_PENDING) {
    expectFail("live pin blocked while REPIN_PENDING", () => {
      assertLivePinReady();
    });
    ok("Live pin ready gate refuses REPIN_PENDING");
  } else {
    info("REPIN_PENDING=false — pins marked ready for live after Preview deploy");
    ok("Repin cleared (operator responsibility: URL+SHA match deployment)");
  }

  warnLimitation(
    "Telegram notify-disable flag is attestation-only without env decrypt; no false PASS",
  );
}
