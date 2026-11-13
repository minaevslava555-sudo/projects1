# HAVENLY — Phase 3B.1 Production Runbook

**Versioned pricing database preparation only**

| Field | Value |
|---|---|
| Phase | 3B.1 |
| Scope | Supabase Production schema + seed mirroring current hardcoded rates |
| App cutover | **Not in this phase** — booking still uses `lib/booking-pricing.ts` |
| Migration file | `supabase/safe_pricing_migration.sql` |
| Production project (ref) | `mwlvxyszksogsyflxvuv` |
| Disposable test project (ref) | `avyerjnzfsqgaascltqi` (havenly-pricing-test; T1–T11 passed) |

**Do not paste credentials, service-role keys, or database passwords into this document or into chat logs.**

---

## 0) Manual approval checkpoint (required)

No Production SQL, deploy, or env change is authorized until **all** of the following are explicitly approved by the project owner:

- [ ] Read-only Production prerequisites (Section 2) have been executed and results reviewed.
- [ ] Pre-migration order fingerprint captured (Section 2.3.1) and stored in ops notes (hashes/counts only — no PII).
- [ ] Backup availability verified per Section 5.1 (daily backups **and/or** PITR — **do not assume PITR**). Retention, restore procedure, and restore limitations recorded.
- [ ] This runbook has been read end-to-end.
- [ ] Owner understands: **after migration, the live website still prices from hardcoded TypeScript until Phase 3B.2**.
- [ ] Owner gives a clear written go-ahead for Production SQL Editor Run of `safe_pricing_migration.sql` only.

**Without that approval, stop here.**

Suggested approval phrase:

> APPROVED: Apply `supabase/safe_pricing_migration.sql` to Production Supabase project `mwlvxyszksogsyflxvuv` per Phase 3B.1 runbook. No app deploy. No 3B.2 cutover.

---

## 1) What this phase does / does not do

### Does

- Creates `projects1_pricing_config`, `projects1_cleaning_room_plans`, `projects1_massage_prices`.
- Seeds **active version 1** with the same numbers as production hardcode (€20/h cleaning; massage 45 / 67.50 / 90).
- Adds nullable order snapshot columns: `pricing_config_id`, `pricing_version`, `hourly_rate_snapshot`, `pricing_snapshot`.
- Installs publish helper `projects1_activate_pricing_config`, immutability triggers, RLS, and restricted grants.

### Does not

- Change `lib/booking-pricing.ts`, Booking Wizard, or `POST /api/order` pricing logic.
- Write snapshot fields from the application (`lib/orders.ts` still omits them).
- Enable admin UI for rate changes.
- Make the database the authoritative price source for customers (that is **Phase 3B.2**).

Until 3B.2, treating DB rates as “live customer pricing” is incorrect. The DB book is prepared and tested; the app continues to use constants.

---

## 2) Prerequisites

### 2.1 Environment identity

- Confirm you are in the **Production** Supabase project (`mwlvxyszksogsyflxvuv`), not havenly-pricing-test.
- Prefer SQL Editor while logged into that project dashboard.
- Do **not** run test scripts (`supabase/test_*.sql`, `scripts/test_t11_pricing_concurrency.py`) against Production.

### 2.2 Schema prerequisites

`public.projects1_orders` must already exist (from earlier orders / booking-wizard migrations). The pricing migration **ALTER**s this table; it does not create it.

Expected prior migrations (already applied on Production in earlier phases):

1. `supabase/safe_orders_migration.sql` (or equivalent orders bootstrap)
2. `supabase/safe_booking_wizard_migration.sql`

### 2.3 Read-only verification SQL (run before any migration)

Execute in Production SQL Editor. **No writes.**

```sql
-- A) Confirm projects1_orders exists
select to_regclass('public.projects1_orders') as orders_table;

-- B) Pricing tables must NOT exist yet (fresh 3B.1 apply)
select to_regclass('public.projects1_pricing_config') as pricing_config;
select to_regclass('public.projects1_cleaning_room_plans') as cleaning_plans;
select to_regclass('public.projects1_massage_prices') as massage_prices;

-- C) Snapshot columns on orders (may be absent before 3B.1)
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'projects1_orders'
  and column_name in (
    'pricing_config_id',
    'pricing_version',
    'hourly_rate_snapshot',
    'pricing_snapshot',
    'price_euro',
    'pricing_mode',
    'rooms',
    'hours',
    'workers'
  )
order by column_name;

-- D) Activate function must NOT exist yet (optional check)
select proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'projects1_activate_pricing_config';

-- E) Order volume
select count(*) as order_count from public.projects1_orders;
```

### 2.3.1 Pre-migration order fingerprint (read-only, no PII)

Capture these results **before** apply and keep them in ops notes. They must match Section 4.5 after apply.

**Do not select `name`, `phone`, addresses, or free-text customer fields.**

```sql
-- F1) Row count
select count(*)::bigint as order_row_count
from public.projects1_orders;

-- F2) Monetary + identity aggregate (deterministic; no personal data)
-- Includes all order ids and price_euro values via ordered digests.
select
  count(*)::bigint as order_row_count,
  coalesce(sum(price_euro), 0) as sum_price_euro,
  count(*) filter (where price_euro is null) as null_price_count,
  count(*) filter (where pricing_mode = 'fixed') as fixed_count,
  count(*) filter (where pricing_mode = 'quote') as quote_count,
  md5(
    string_agg(id::text, ',' order by id::text)
  ) as md5_order_ids,
  md5(
    string_agg(
      id::text || ':' || coalesce(price_euro::text, 'NULL'),
      ',' order by id::text
    )
  ) as md5_id_price_pairs
from public.projects1_orders;

-- F3) Optional: status histogram (still non-PII)
select status, count(*)::bigint as n
from public.projects1_orders
group by status
order by status;
```

Record at minimum: `order_row_count`, `sum_price_euro`, `null_price_count`, `md5_order_ids`, `md5_id_price_pairs`, and the UTC timestamp of the capture.

If `pricing_mode` is unexpectedly missing on Production, **Abort** and reconcile schema before 3B.1 (wizard migration should already have applied).

### 2.4 Abort if (before apply)

| Condition | Action |
|---|---|
| Wrong Supabase project | **Abort** |
| `projects1_orders` missing | **Abort** — fix orders schema first |
| `projects1_pricing_config` already exists with unexpected data | **Abort** — investigate; do not re-seed blindly |
| Pre-migration fingerprint (2.3.1) not captured | **Abort** |
| Backup posture not verified (Section 5.1) | **Abort** |
| Ongoing incident / peak booking risk | **Defer** |
| No owner approval (Section 0) | **Abort** |

If pricing tables already exist and match the intended seed (idempotent re-run), see Section 3.3.

---

## 3) Migration execution

### 3.1 Exact file

```
supabase/safe_pricing_migration.sql
```

- Single transactional script (`BEGIN` … `COMMIT`).
- Idempotent where practical (`IF NOT EXISTS`, seed skips if an `active` row already exists).

### 3.2 Safe sequence

1. Complete Section 0 approval and Section 2 read-only checks (including **2.3.1 fingerprint**).
2. Complete Section 5.1 backup verification (do not assume PITR).
3. Open Production → **SQL Editor**.
4. Paste the **entire** contents of `supabase/safe_pricing_migration.sql` (do not run fragments).
5. Run once. Wait for success.
6. Immediately run Section 4 post-verification (pricing seed **and** order fingerprint compare).
7. Record timestamp, runner identity, fingerprint pre/post values, and verification outcomes (no secrets, no PII).
8. **Do not** deploy application changes as part of 3B.1.
9. **Do not** change Production rates via `activate` unless a separate change request says so (seed already matches hardcode).

### 3.3 Idempotent re-run

If the script is run again:

- Tables/indexes/functions are created or replaced safely.
- Seed **skips** when an `active` pricing row already exists (does not overwrite published rates).
- Still prefer a single successful apply; treat unexpected re-runs as an incident review.

---

## 4) Post-migration verification

Run in Production SQL Editor after apply.

### 4.1 Active book = version 1 @ €20

```sql
select version, status, cleaning_hourly_rate_euro, activated_at
from public.projects1_pricing_config
where status = 'active';
-- Expect: exactly one row, version = 1, cleaning_hourly_rate_euro = 20.00
```

```sql
select count(*) as active_count
from public.projects1_pricing_config
where status = 'active';
-- Expect: 1
```

### 4.2 Cleaning totals (€20 × hours × workers)

```sql
select
  p.rooms,
  p.hours,
  p.workers,
  (p.hours * p.workers * c.cleaning_hourly_rate_euro) as total_euro
from public.projects1_cleaning_room_plans p
join public.projects1_pricing_config c on c.id = p.pricing_config_id
where c.status = 'active'
order by p.rooms;
```

| rooms | expected total_euro |
|---|---|
| 1 | 40 |
| 2 | 60 |
| 3 | 160 |
| 4 | 200 |
| 5 | 360 |
| 6 | 360 |

### 4.3 Massage prices

```sql
select m.minutes, m.price_euro, m.is_active
from public.projects1_massage_prices m
join public.projects1_pricing_config c on c.id = m.pricing_config_id
where c.status = 'active'
order by m.minutes;
```

| minutes | expected price_euro |
|---|---|
| 60 | 45.00 |
| 90 | 67.50 |
| 120 | 90.00 |

### 4.4 Order snapshot columns present

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'projects1_orders'
  and column_name in (
    'pricing_config_id',
    'pricing_version',
    'hourly_rate_snapshot',
    'pricing_snapshot'
  )
order by column_name;
-- Expect all four names
```

### 4.5 Existing orders unchanged (required fingerprint compare)

Re-run the **same** queries as Section **2.3.1** immediately after migration success.

```sql
-- Post: same as F1/F2 (no PII columns)
select count(*)::bigint as order_row_count
from public.projects1_orders;

select
  count(*)::bigint as order_row_count,
  coalesce(sum(price_euro), 0) as sum_price_euro,
  count(*) filter (where price_euro is null) as null_price_count,
  count(*) filter (where pricing_mode = 'fixed') as fixed_count,
  count(*) filter (where pricing_mode = 'quote') as quote_count,
  md5(
    string_agg(id::text, ',' order by id::text)
  ) as md5_order_ids,
  md5(
    string_agg(
      id::text || ':' || coalesce(price_euro::text, 'NULL'),
      ',' order by id::text
    )
  ) as md5_id_price_pairs
from public.projects1_orders;

select count(*) as orders_with_pricing_config_id
from public.projects1_orders
where pricing_config_id is not null;
-- Expect: 0 immediately after 3B.1 (app does not write snapshots yet)
```

**Pass only if all match the pre-migration capture:**

| Field | Must match pre-migration |
|---|---|
| `order_row_count` | Yes |
| `sum_price_euro` | Yes |
| `null_price_count` | Yes |
| `fixed_count` / `quote_count` | Yes |
| `md5_order_ids` | Yes |
| `md5_id_price_pairs` | Yes |
| `orders_with_pricing_config_id` | 0 (unless pre-existing non-null existed — then investigate) |

Note: a **new customer order** placed between pre-capture and post-capture will change fingerprints. If that happens, either re-capture a fresh pre-fingerprint during a quiet window and re-compare, or abort and schedule a maintenance window with no new bookings.

Smoke the live site booking flow manually (cleaning / massage / repair quote). Prices must still match hardcode; no deploy required.

### 4.6 Abort if (after apply)

| Condition | Action |
|---|---|
| No active row, or active version ≠ 1 | **Abort / incident** — do not proceed to 3B.2; investigate |
| Rate ≠ 20 or cleaning/massage totals wrong | **Abort / incident** |
| Any order fingerprint field differs from pre-migration (Section 4.5) | **Abort / incident** — treat as possible data change; do not continue; escalate (see Section 5). Do **not** “fix forward” without owner review |
| `order_row_count` increased and fingerprints differ with known new bookings | **Abort or re-baseline** only with owner approval; preferred: quiet window + redo compare |
| Migration failed mid-transaction | Transaction should have rolled back; re-check Section 2; do not partial-fix |
| Customer-facing prices wrong on site | Unrelated to DB seed if app still on hardcode — investigate deploy/cache; DB alone should not change UI |

---

## 5) Backup, abort, rollback / recovery

### 5.1 Daily backups vs PITR (verify — do not assume)

These are **different** capabilities. Confirm what Production actually has in the Supabase dashboard (project plan / Database → Backups) **before** Section 0 approval.

| Mechanism | What it is | Typical restore shape | Limitations |
|---|---|---|---|
| **Daily backups** | Scheduled full/logical snapshots (often plan-dependent) | Restore to a **backup point** (e.g. yesterday’s snapshot), not an arbitrary second | May **not** restore to “one minute before migration”; retention window may be short; restore can replace or fork the project DB; downtime / data loss of post-backup writes |
| **PITR (Point-in-Time Recovery)** | Continuous WAL-style recovery to a chosen timestamp | Restore to a **specific UTC time** before migration | **Not enabled on all plans**; must be explicitly verified; restore still affects the **whole** database, not only pricing tables; RPO/RTO and how Supabase applies restore (in-place vs new project) must be read from current docs/dashboard |

**Required verification before approval (record answers in ops notes):**

1. Are **daily backups** enabled for Production? Retention length?
2. Is **PITR** enabled? If yes, retention window and earliest restore time?
3. What is the **documented restore procedure** for this project (dashboard steps / support)?
4. What are **restore limitations** (whole-DB restore, downtime, loss of writes after restore point, need to re-point app)?
5. If **neither** adequate backup nor PITR is available: **Abort** Phase 3B.1 Production apply until backup posture is acceptable.

**Do not assume PITR is on** merely because the project is “Production.”

Also note the approximate UTC time **immediately before** running the migration (useful if PITR exists).

This migration is additive (new tables + nullable columns). It does **not** intentionally rewrite historical `price_euro` values. Order fingerprint compare (Sections 2.3.1 / 4.5) is the primary proof that monetary order data stayed intact.

### 5.2 Realistic recovery options

**Do not assume “DROP TABLE projects1_pricing_*” is a safe full reverse.**

Reasons:

- After 3B.1, `projects1_orders.pricing_config_id` may gain a **foreign key** to `projects1_pricing_config`. Dropping pricing tables without clearing/dropping that FK fails or requires cascading decisions.
- Future 3B.2+ may write non-null snapshots; dropping then destroys audit trail.
- Functions/triggers/policies would need coordinated removal.

**Preferred recovery postures:**

| Situation | Recovery |
|---|---|
| Migration transaction **failed** before `COMMIT` | No durable schema change; fix cause; re-run whole file after approval |
| Migration **succeeded**, pricing seed wrong, order fingerprints **match**, no snapshots reference pricing rows | Controlled repair: new draft + `projects1_activate_pricing_config` (separate approval). Prefer over DROP |
| Migration **succeeded** but **order fingerprints differ** | **Stop**. Do not apply further DDL. Escalate. Use pre-captured fingerprints + Section 5.1 restore options only after owner decision. Investigate whether new bookings explain the delta |
| Need to abandon pricing feature before any snapshots | Separate approved teardown script (FK/columns/functions/tables) — not a one-liner |
| Catastrophic / unknown corruption | Restore via **verified** daily backup and/or **verified** PITR (last resort; whole DB). If neither exists, escalate outside this runbook |

**Application rollback:** none required for 3B.1 — no app deploy. Hardcoded pricing remains authoritative for customers.

---

## 6) Security reminders (post-apply)

- `anon` / `authenticated` must not read/write pricing tables (RLS deny + revoked grants).
- `service_role` must not update lifecycle columns (`status`, `activated_at`, `archived_at`) directly; publish only via `projects1_activate_pricing_config`.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.

Optional negative check (owner/sql role only; expect privilege errors if tested as `service_role`):

```sql
-- Do not run as a role that bypasses intended grants unless verifying deliberately.
-- Expect failure for service_role on lifecycle columns.
```

---

## 7) After 3B.1 — handoff to Phase 3B.2

Only after Section 4 passes and owner confirms:

1. Keep Production DB book in sync with hardcode (do not silently diverge).
2. Plan 3B.2: DB-backed `resolveBookingPricing`, fail-closed when no active book, order snapshot writes, preview/submit version mismatch handling, admin activate path.
3. Do not enable admin rate edits in Production until 3B.2 fail-closed and snapshot behavior are live.

---

## 8) Execution checklist (copy for ops notes)

```
Date (UTC):
Runner:
Approval recorded: yes/no
Project ref confirmed: mwlvxyszksogsyflxvuv
Pre-check orders table: OK / FAIL
Pre-check pricing tables absent (or reviewed): OK / FAIL
Pre order_row_count:
Pre sum_price_euro:
Pre null_price_count:
Pre md5_order_ids:
Pre md5_id_price_pairs:
Daily backups enabled / retention: 
PITR enabled (yes/no) / retention:
Restore procedure reviewed: OK / FAIL
Restore limitations noted: OK / FAIL
Migration file: supabase/safe_pricing_migration.sql
Migration result: SUCCESS / FAIL
Active v1 @ 20: OK / FAIL
Cleaning totals 40/60/160/200/360/360: OK / FAIL
Massage 45/67.50/90: OK / FAIL
Snapshot columns present: OK / FAIL
Post order fingerprint match pre: OK / FAIL
Site smoke (hardcode prices unchanged): OK / FAIL
App deploy performed: NO (expected)
```

---

## Document control

| | |
|---|---|
| Created for | Phase 3B.1 Production apply |
| Related code | `supabase/safe_pricing_migration.sql`, `lib/booking-pricing.ts` |
| Related tests | Disposable project only — T1–T11 |
| Next phase | 3B.2 application cutover to versioned pricing |
