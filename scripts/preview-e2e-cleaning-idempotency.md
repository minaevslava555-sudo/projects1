# Preview E2E — Cleaning v1 idempotency harness

Opt-in script: `scripts/preview-e2e-cleaning-idempotency.mjs`
Shared infra: `scripts/lib/preview-e2e-shared.mjs`, `scripts/lib/preview-e2e-pins.mjs`
(Massage harness reuses the same shared module.)

Pinned target lives in `preview-e2e-pins.mjs`. While `REPIN_PENDING === true`, **live** runs exit before orders (safe gate after SHA/URL drift). Offline `--self-check` still runs.

Legacy Cleaning-validated pin (reference only until repin):

| Pin | Value |
|-----|--------|
| Preview URL | `https://projects1-ett84hjty-slava-7f85.vercel.app` |
| Git SHA (full) | `377dafa28cc2a0dd26912ac89e19365ec9987578` |
| Supabase host | `avyerjnzfsqgaascltqi.supabase.co` |
| Redis host | `tidy-griffon-181609.upstash.io` (via `redis-ping` `hostMatch`) |
| Branch | `feature/85h-gallery-motion-prototype` |

Does **not** modify application runtime, Production, main, or env from this script. Does **not** delete orders.

## Safety gates (live run)

Live execution requires **all** of:

1. `ALLOW_PREVIEW_E2E_IDEMPOTENCY=1`
2. `REPIN_PENDING=false` with `EXPECTED_BASE_URL` + `EXPECTED_GIT_SHA` updated together for the target Preview
3. `PREVIEW_TELEGRAM_NOTIFY_DISABLED_ATTESTED=1` — operator attests Preview has `TELEGRAM_NOTIFY_DISABLED=1`
4. `PREVIEW_BASE_URL` equal to the pinned Preview origin (or omit to use the pin)
5. `EXPECTED_GIT_SHA` = **full 40-char** SHA (or omit to use the pin). Prefix match is rejected.
6. `VERCEL_TOKEN` — independent deployment Git SHA lookup via Vercel API
7. Optional `VERCEL_TEAM_ID` if the token is team-scoped
8. Optional `VERCEL_PROTECTION_BYPASS` — Vercel **Protection Bypass for Automation** secret (local only). Required in practice when Deployment Protection / SSO is enabled on the pinned Preview.
9. `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for the **test** project only (host must match pin)
10. Successful `GET /api/preview/supabase-ping` and `GET /api/preview/redis-ping` on the Preview host
11. Preview `CLEANING_V1_ORDERS_ENABLED=true` (server) for Cleaning v1 orders

On any gate failure the script exits before placing orders.

### HTTP redirects

All harness network calls use `safeFetch` with `redirect: "error"`. Request URL origin must be on an allowlist (`Preview origin` or `https://api.vercel.com`). Response URL origin must match the request origin. Credentialed requests never follow a cross-host redirect. Network failures log a redacted `error.cause` (e.g. `unexpected redirect` under Deployment Protection SSO).

### Vercel Protection Bypass (Preview only)

When `VERCEL_PROTECTION_BYPASS` is set, `safeFetch` sends header `x-vercel-protection-bypass` **only** if the request origin equals the exact pinned Preview origin (`EXPECTED_BASE_URL`). The header is stripped for:

- `https://api.vercel.com` (SHA lookup uses `VERCEL_TOKEN` only)
- Supabase bound fetch (always strips; never applies bypass)
- any other host

Deployment Protection itself is **not** disabled by this harness. Do not put the bypass secret in app env / Vercel project env from this script.

### Supabase SDK fetch

`createClient` is constructed with `global.fetch = createOriginBoundFetch(testSupabaseOrigin)`:

- `redirect: "error"`
- request origin must equal `https://avyerjnzfsqgaascltqi.supabase.co`
- `Authorization` / `apikey` never leave that origin (response URL origin checked)
- Preview / Vercel API hosts are **not** allowed on this bound fetch
- `x-vercel-protection-bypass` is always stripped before Supabase requests

### Credentials (minimal)

| Secret | Use |
|--------|-----|
| `VERCEL_TOKEN` | Read deployment metadata (SHA / branch / target) only |
| `VERCEL_PROTECTION_BYPASS` | Preview Deployment Protection automation bypass header only (pinned Preview origin) |
| `SUPABASE_SERVICE_ROLE_KEY` | **SELECT** by `idempotency_key` + head counts only (no UPDATE/DELETE) |

Service role is required under current order RLS for server-side verification reads. No new DB roles or migrations are created. Prefer a Preview-scoped Vercel token with read-only deployment access when available.

## Turnstile

Preview uses Cloudflare **test** sitekey/secret. Harness sends dummy response `XXXX.DUMMY.TOKEN.XXXX` on every `POST /api/order`. Server `siteverify` still runs. Dummy token strings are redacted in logs.

## Draft token lifecycle

| Step | Behavior |
|------|----------|
| Create | `POST /api/order/draft` → fresh draft; successful order **consumes** draft |
| Sequential replay | New draft + Turnstile; completed Redis path returns before draft consume; row count unchanged |
| Concurrent | **Two** distinct drafts, **one new** idempotency key |
| Pending `409` | Limited retries with fresh draft + Turnstile |
| Fingerprint mismatch | Fresh draft; same create key; `cleaningType=deep` → HTTP `409` |

## Scenarios

1. **Create** — Cleaning Standard T2 (€90). Assert `price_euro`, `hourly_rate_snapshot=20`, snapshot rate/min/step.
2. **Sequential replay** — same key + fingerprint → same `orderRef` / price; count stays `1`.
3. **Concurrent race** — **new** idempotency key; parallel POSTs; exactly one DB row.
4. **Fingerprint mismatch** — same key, different type → `409`; original `order_ref`, `request_fingerprint`, `price_euro` unchanged; still one row.

### API limitation (409 reason)

The HTTP `409` body may be a **generic** idempotency/processing message. The harness does **not** claim the client response uniquely identifies fingerprint mismatch; **DB invariants** (fingerprint, price, single row) are authoritative.

## Telegram isolation

Runtime guards (`lib/telegram-runtime.ts`): Preview / non-production Vercel denies webhook register, inbound updates, and `sendTelegramMessage`. `notifyAdminAboutOrder` also no-ops when `TELEGRAM_NOTIFY_DISABLED=1`.

Harness checks:

- Deployment `target !== "production"` (Vercel metadata)
- Feature-branch ref match
- Operator attestation for `TELEGRAM_NOTIFY_DISABLED=1`
- Zero harness calls to `api.telegram.org`

### Limitation (no false PASS)

`TELEGRAM_NOTIFY_DISABLED` is **not** independently readable from public deployment metadata without an env-decrypt API. The harness logs `LIMIT …` and does **not** claim an independent PASS on the notify-disable flag.

## Redis host binding

`GET /api/preview/redis-ping` returns `hostMatch: true` only when the server compared the configured Upstash/KV URL to `EXPECTED_HOST = tidy-griffon-181609.upstash.io` in `app/api/preview/redis-ping/route.ts`. The JSON does not echo the hostname; the harness pins the same host constant and requires `hostMatch === true`.

## Logging

No secrets, Turnstile/draft tokens, Authorization headers, protection-bypass values, or full JSON payloads. Only statuses, redacted summaries, `orderRef`, prices, and counts. `error.cause` is included in network FAIL lines after `safeSummary`.

## Commands

### Local syntax + self-check (no network)

```powershell
node --check scripts/lib/preview-e2e-pins.mjs
node --check scripts/lib/preview-e2e-shared.mjs
node --check scripts/preview-e2e-cleaning-idempotency.mjs
node scripts/preview-e2e-cleaning-idempotency.mjs --self-check
```

Self-check covers shared allowlist/bypass/redaction/REPIN gate plus Cleaning T2 fixture.

### Live Preview E2E (only when explicitly approved + repinned)

```powershell
$env:ALLOW_PREVIEW_E2E_IDEMPOTENCY = "1"
$env:PREVIEW_TELEGRAM_NOTIFY_DISABLED_ATTESTED = "1"
$env:PREVIEW_BASE_URL = "<repinned-preview-url>"
$env:EXPECTED_GIT_SHA = "<full-40-char-sha>"
$env:VERCEL_TOKEN = "<vercel-token>"
$env:VERCEL_PROTECTION_BYPASS = "<protection-bypass-secret>"
$env:NEXT_PUBLIC_SUPABASE_URL = "<test-supabase-url>"
$env:SUPABASE_SERVICE_ROLE_KEY = "<test-service-role>"

node scripts/preview-e2e-cleaning-idempotency.mjs
```

## Out of scope

- Changing `package.json`, app runtime, Production/main
- Disabling Deployment Protection / creating bypass secrets from this harness
- Backfill / DELETE of orders
- Commit / push / deploy from this harness
