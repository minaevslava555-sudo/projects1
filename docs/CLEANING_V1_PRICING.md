# Cleaning v1 pricing (ADR)

## Status

Accepted for HAVENLY booking on branch `feature/85h-gallery-motion-prototype`.

## Context

Two cleaning calculators coexist:

- **Legacy** — room count 1–6 → wall-clock hours × cleaner count × €20/h (`cleaningPlan` / pricing book).
- **Cleaning v1** — room composition + cleaning type (+ optional add-ons) → **person-minutes** → billable steps → customer price.

v1 customer price does **not** depend on how many cleaners HAVENLY later assigns. `billableHours` are person-hours of work, not visit duration. Area (m²) is **not** part of v1 pricing.

## Formula (source of truth: `lib/booking-pricing.ts`)

1. Sum room person-minutes from fixed per-type constants (bedroom 40, living 40, kitchen 60, bathroom 45, separate WC 25, hallway 20, other 30).
2. Multiply **room** person-minutes by cleaning type: standard ×1, deep ×1.5, post-renovation ×2.
3. Add optional add-on person-minutes from the shared catalog (**not** scaled by cleaning type): oven 30, fridge 30, windows 20, balcony 20, ironing 60.
4. Round **up** the sum to the next 30-minute billable step (float-safe epsilon).
5. `priceEuro = max(40, billableHours × 20)` (VAT-inclusive customer price).

```
totalPersonMinutes = roomMinutes × typeMultiplier + addonMinutes
```

Per-type room counts are capped (UI + parser). Add-on caps: most ids ≤ 3; windows ≤ 30 (one unit = one standard window, both sashes).

## Recommended crew (display / ops only)

Pure helper `recommendCleaningV1Crew(billablePersonMinutes)`:

| Billable person-hours | Recommended cleaners |
|-----------------------|----------------------|
| ≤ 4 | 1 |
| > 4 and ≤ 8 | 2 |
| > 8 and ≤ 12 | 3 |
| > 12 | 4 |

Estimated visit minutes = `billablePersonMinutes / cleaners`, rounded **up** to 15 minutes for display. Crew size does **not** change customer price.

Server writes `recommendedCleaners` and `estimatedVisitMinutes` into `pricingSnapshot` after recomputing. Clients must not send these fields (rejected). They are excluded from order fingerprints.

## Quote-engine revision (client attempts)

`CLEANING_V1_QUOTE_REVISION` is stored only on the client booking-attempt record (`quoteRevision`). It is **not** part of the server order fingerprint.

When norms/formula change, bump the revision. An unresolved attempt with a missing/old revision keeps its **idempotency key**, but submit is blocked until the customer confirms the live estimate. Field-fingerprint mismatches still use the existing `attemptPayloadChanged` path. Historical order replay and duplicate protection stay unchanged.

## Feature flags

| Flag | Where | Role |
|------|--------|------|
| `NEXT_PUBLIC_CLEANING_V1_BOOKING_ENABLED` | Client | Show v1 configure UI / preview |
| `NEXT_PUBLIC_CLEANING_V1_ORDERS_ENABLED` | Client | Allow submit UX (hide preview-only banner) |
| `CLEANING_V1_ORDERS_ENABLED` | Server | Accept `cleaningPricingVersion: "v1"` orders |

Set the two ORDERS flags together when enabling live v1 bookings. Preview with booking UI on and orders off is intentional: estimate works, submit is blocked client-side and rejected server-side.

## Security invariants

- Client never supplies `priceEuro`, `recommendedCleaners`, or `estimatedVisitMinutes`; server recomputes via `calculateCleaningV1Price` / `recommendCleaningV1Crew`.
- Strict parse allowlists for rooms / add-ons; unexpected keys (including legacy `areaM2` and client crew fields) rejected.
- Add-ons and room counts participate in order fingerprint + `pricingSnapshot` when used. Crew/visit fields do not enter the fingerprint.
- Do not trust i18n or UI-only prices for billing.
- Historical order snapshots may still contain `areaM2` / `areaAdjustmentMinutes` and may omit crew fields; new v1 orders include crew/visit. Do not rewrite stored rows.

## Legacy

Leave `cleaningPlan` unchanged until a deliberate cutover. Do not fall back from failed v1 parse to legacy room pricing.
