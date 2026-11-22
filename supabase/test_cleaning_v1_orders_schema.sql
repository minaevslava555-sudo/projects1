-- =============================================================================
-- HAVENLY Stage 4F.D.6 — Test-only: projects1_orders schema for Cleaning v1
-- =============================================================================
-- Target: isolated Supabase project havenly-pricing-test ONLY.
-- Brings public.projects1_orders into column/index compatibility with lib/orders.ts.
--
-- Assumes existing 12 columns:
--   id, name, phone, service, price_euro, service_date, status, created_at,
--   pricing_config_id, pricing_version, hourly_rate_snapshot, pricing_snapshot
--
-- Additive only: ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.
-- No DROP, no data DML, no pricing / Storage / RLS changes.
-- Safe to rerun. DO NOT apply to Production.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1) Base booking fields (from safe_orders_migration.sql)
-- -----------------------------------------------------------------------------
alter table public.projects1_orders
  add column if not exists details text;

alter table public.projects1_orders
  add column if not exists rooms integer;

alter table public.projects1_orders
  add column if not exists hours integer;

alter table public.projects1_orders
  add column if not exists workers integer;

alter table public.projects1_orders
  add column if not exists massage_minutes integer;

-- -----------------------------------------------------------------------------
-- 2) Wizard booking fields (from safe_booking_wizard_migration.sql)
-- -----------------------------------------------------------------------------
alter table public.projects1_orders
  add column if not exists order_ref text;

alter table public.projects1_orders
  add column if not exists street_address text;

alter table public.projects1_orders
  add column if not exists city text;

alter table public.projects1_orders
  add column if not exists apartment_floor text;

alter table public.projects1_orders
  add column if not exists access_instructions text;

alter table public.projects1_orders
  add column if not exists preferred_time text;

alter table public.projects1_orders
  add column if not exists problem_description text;

alter table public.projects1_orders
  add column if not exists massage_category text;

alter table public.projects1_orders
  add column if not exists repair_photo_paths text[];

alter table public.projects1_orders
  add column if not exists pricing_mode text;

-- -----------------------------------------------------------------------------
-- 3) Idempotency / fingerprint (required by lib/orders.ts; not in prior SQL)
-- -----------------------------------------------------------------------------
alter table public.projects1_orders
  add column if not exists idempotency_key text;

alter table public.projects1_orders
  add column if not exists request_fingerprint text;

-- -----------------------------------------------------------------------------
-- 4) Unique indexes required by lib/orders.ts conflict handling
-- -----------------------------------------------------------------------------
create unique index if not exists projects1_orders_order_ref_uidx
  on public.projects1_orders (order_ref)
  where order_ref is not null;

create unique index if not exists projects1_orders_idempotency_key_uidx
  on public.projects1_orders (idempotency_key)
  where idempotency_key is not null;

commit;
