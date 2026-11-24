# Cleaning v1 pricing (ADR)

## Status

Accepted for HAVENLY booking on branch `feature/85h-gallery-motion-prototype`.

## Context

Two cleaning calculators coexist:

- **Legacy** — room count 1–6 → wall-clock hours × cleaner count × €20/h (`cleaningPlan` / pricing book).
- **Cleaning v1** — room composition + cleaning type (+ optional add-ons) → **person-minutes** → billable steps → customer price.

v1 customer price does **not** depend on how many cleaners HAVENLY later assigns. `billableHours` are person-hours of work, not visit duration. Area (m²) is **not** part of v1 pricing.

## Formula (source of truth: `lib/booking-pricing.ts`)

1. Sum room person-minutes from fixed per-type constants (bedroom 30, living 40, kitchen 60, bathroom 45, separate WC 25, hallway 20, other 30).
2. Add optional add-on person-minutes from the shared catalog.
3. Multiply by cleaning type: standard ×1, deep ×1.5, post-renovation ×2.
4. Round **up** to the next 30-minute billable step (float-safe epsilon).
5. `priceEuro = max(40, billableHours × 20)` (VAT-inclusive customer price).

Per-type room counts are capped (UI + parser). Add-on counts are capped per catalog id.

## Feature flags

| Flag | Where | Role |
|------|--------|------|
| `NEXT_PUBLIC_CLEANING_V1_BOOKING_ENABLED` | Client | Show v1 configure UI / preview |
| `NEXT_PUBLIC_CLEANING_V1_ORDERS_ENABLED` | Client | Allow submit UX (hide preview-only banner) |
| `CLEANING_V1_ORDERS_ENABLED` | Server | Accept `cleaningPricingVersion: "v1"` orders |

Set the two ORDERS flags together when enabling live v1 bookings. Preview with booking UI on and orders off is intentional: estimate works, submit is blocked client-side and rejected server-side.

## Security invariants

- Client never supplies `priceEuro`; server recomputes via `calculateCleaningV1Price`.
- Strict parse allowlists for rooms / add-ons; unexpected keys (including legacy `areaM2`) rejected.
- Add-ons and room counts participate in order fingerprint + `pricingSnapshot` when used.
- Do not trust i18n or UI-only prices for billing.
- Historical order snapshots may still contain `areaM2` / `areaAdjustmentMinutes`; new v1 orders omit them. Do not rewrite stored rows.

## Legacy

Leave `cleaningPlan` unchanged until a deliberate cutover. Do not fall back from failed v1 parse to legacy room pricing.
