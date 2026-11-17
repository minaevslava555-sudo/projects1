-- SAFE migration: durable order idempotency key on projects1_orders
-- Idempotent: ADD COLUMN / CREATE INDEX IF NOT EXISTS only.
-- NO DROP / TRUNCATE / DELETE / UPDATE of existing order rows.
-- Apply in Supabase → SQL Editor → Run (after verifying table exists).
--
-- Purpose:
--   Persist client Idempotency-Key with each new order so duplicates cannot be
--   inserted after Redis/memory TTL expiry. Existing rows keep NULL keys and
--   remain valid under the partial unique index.
--
-- Prerequisites:
--   public.projects1_orders must already exist (safe_orders_migration /
--   safe_booking_wizard_migration / production).
--
-- Rollback considerations (manual; not executed by this script):
--   1) DROP INDEX IF EXISTS public.projects1_orders_idempotency_key_uidx;
--   2) ALTER TABLE public.projects1_orders DROP COLUMN IF EXISTS idempotency_key;
--   Dropping the column discards stored keys; only do this after application
--   code no longer writes/reads idempotency_key. Prefer keeping the nullable
--   column if rollback of app behavior alone is enough.
--
-- Re-run: safe — IF NOT EXISTS guards; no data mutation.

-- 1) Nullable idempotency_key (TEXT) if missing
alter table public.projects1_orders
  add column if not exists idempotency_key text;

comment on column public.projects1_orders.idempotency_key is
  'Client Idempotency-Key for POST /api/order. NULL for legacy rows. Non-null values must be unique (partial unique index).';

-- 2) Unique partial index: one order per non-null key
create unique index if not exists projects1_orders_idempotency_key_uidx
  on public.projects1_orders (idempotency_key)
  where idempotency_key is not null;

-- 3) Nullable request_fingerprint (TEXT) if missing — no index
alter table public.projects1_orders
  add column if not exists request_fingerprint text;

comment on column public.projects1_orders.request_fingerprint is
  'SHA-256 of canonical booking payload; verifies identical request data on idempotent replay.';

-- 4) Optional verification (read-only; uncomment to inspect after apply)
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'projects1_orders'
--   and column_name = 'idempotency_key';
--
-- select indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename = 'projects1_orders'
--   and indexname = 'projects1_orders_idempotency_key_uidx';
