# Preview E2E — Massage & Wellness v1 harness

Opt-in script: `scripts/preview-e2e-massage-idempotency.mjs`
Shared infra: `scripts/lib/preview-e2e-shared.mjs`, `scripts/lib/preview-e2e-pins.mjs`

Does **not** modify application runtime, Production, main, or env from this script. Does **not** delete orders.

## Repin (required before live)

Live runs refuse orders while `REPIN_PENDING === true` in `preview-e2e-pins.mjs`.

After this harness is committed and Vercel Preview finishes:

1. Set `EXPECTED_BASE_URL` to the new Preview `*.vercel.app` URL.
2. Set `EXPECTED_GIT_SHA` to that deployment’s **full 40-char** Git SHA.
3. Set `REPIN_PENDING = false`.
4. Never leave URL and SHA from different deployments.

Do **not** run Massage live against the legacy Cleaning pin (`LEGACY_PINNED_*` @ `377dafa`).

## Safety gates (live)

1. `ALLOW_PREVIEW_E2E_MASSAGE_IDEMPOTENCY=1`
2. `PREVIEW_TELEGRAM_NOTIFY_DISABLED_ATTESTED=1`
3. `REPIN_PENDING=false` with matching URL+SHA pins
4. `VERCEL_TOKEN` (+ optional `VERCEL_TEAM_ID`)
5. Optional `VERCEL_PROTECTION_BYPASS` — Preview origin only (`x-vercel-protection-bypass`)
6. Test `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (host pin)
7. Successful supabase-ping / redis-ping
8. `redirect: "error"` on all harness fetches; credential + bypass isolation unchanged

## Feature flags (Preview only — full names)

| Variable | Value | Role |
|----------|-------|------|
| `NEXT_PUBLIC_MASSAGE_V1_UI_ENABLED` | `true` | Landing + wizard Massage v1 UI |
| `NEXT_PUBLIC_MASSAGE_V1_ORDERS_ENABLED` | `true` | Client Confirm submit for `massageVersion: v1` |
| `MASSAGE_V1_ORDERS_ENABLED` | `true` | Server accepts Massage v1 order payloads |
| `NEXT_PUBLIC_MASSAGE_V1_EQUIPMENT_BOOKABLE` | `true` | Client equipment checkboxes / Add |
| `MASSAGE_V1_EQUIPMENT_BOOKABLE` | `true` | Server accepts non-empty `wellnessEquipmentIds` |
| `NEXT_PUBLIC_MASSAGE_V1_PREMIUM_WELLNESS_BOOKABLE` | `true` | Client Premium selection path |
| `MASSAGE_V1_PREMIUM_WELLNESS_BOOKABLE` | `true` | Server accepts `premium-wellness-120` |
| `TELEGRAM_NOTIFY_DISABLED` | `1` | Preview notify no-op (attestation + runtime deny) |

Also keep Cleaning flags only if running the Cleaning harness on the same Preview.

Harness does **not** decrypt or assert these flags from Vercel; missing server flags surface as HTTP 400 on order.

## Matrix

| ID | Case | € | Visit min |
|----|------|---|-----------|
| M1 | Relaxing 60 | 70 | 60 |
| M2 | Sports 60 | 80 | 60 |
| M3a/b | Targeted 30 / 60 | 55 / 85 | 30 / 60 |
| M4–M7 | Relaxing + Foot / Eye / Moxi / TopRelax | 90 / 85 / 80 / 80 | 90 / 85 / 60 / 60 |
| M8 | Sports + Foot + Eye | 115 | 115 |
| M9 | Relaxing + all 4 | 125 | 115 |
| M10 | Premium Wellness | 120 | 120 |
| MX | Sports + all 4 | 135 | 115 |
| M11 | Premium + equipment ids | **4xx** | — |
| — | Client `priceEuro` / `totalSessionMinutes` | **4xx** | — |
| — | Unknown / duplicate equipment | **4xx** | — |
| M12 | Sequential replay + equipment order swap | same ref | count=1 |
| M13 | Concurrent race | one row | — |
| M14 | Fingerprint mismatch (tariff / equipment set) | **409** | DB intact |

Assertions: full `pricing_snapshot`, `price_euro`, `massage_category` (= tariff id), `massage_minutes` (= **base** duration), `request_fingerprint`.

## Commands

```powershell
node --check scripts/lib/preview-e2e-pins.mjs
node --check scripts/lib/preview-e2e-shared.mjs
node --check scripts/preview-e2e-massage-idempotency.mjs
node scripts/preview-e2e-massage-idempotency.mjs --self-check
```

Live only after repin + explicit approval (not documented as a default habit).

## Client vs server equipment/premium flags

See harness report / readiness note: wizard estimate calls `calculateMassageV1Price` with `equipmentBookable: true` and `premiumWellnessBookable: true` always, while submit/UI gates use `NEXT_PUBLIC_*`. Server enforces `MASSAGE_V1_*`. Runtime not changed by this harness — E2E assumes Preview has matching client+server flags all `true`.
