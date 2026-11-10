-- =============================================================================
-- HAVENLY — SAFE migration: Premium Booking Wizard (FINAL)
-- =============================================================================
-- Production findings incorporated:
--   * projects1_orders_price_check expected as:
--       CHECK ((price_euro > (0)::numeric))
--   * No user triggers on projects1_orders
--   * RLS already enabled
--   * storage.objects: no custom policies yet
--   * Broad anon grants (incl. TRUNCATE) → full revoke
--
-- Single transaction: any error rolls back the entire script.
-- Idempotent where practical. No DROP TABLE / TRUNCATE / DELETE of order rows.
-- Data change: ONLY backfill pricing_mode NULL → 'fixed'.
-- Does NOT change existing price_euro values or Cleaning/Massage rates.
--
-- DO NOT auto-apply. Manual review → Supabase SQL Editor → Run after approval.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1) Structured address + scheduling + wizard fields
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

comment on column public.projects1_orders.order_ref is
  'Short client-facing reference (e.g. HV-A1B2C3). UUID id remains primary key.';
comment on column public.projects1_orders.street_address is
  'Street address of the property / client location.';
comment on column public.projects1_orders.city is
  'City (separate field for filtering and Telegram).';
comment on column public.projects1_orders.apartment_floor is
  'Optional apartment / floor / unit.';
comment on column public.projects1_orders.access_instructions is
  'Optional gate codes, parking, entry notes.';
comment on column public.projects1_orders.preferred_time is
  'Preferred start time HH:MM (slots 09:00–19:00 / 30 min). Not a confirmed booking.';
comment on column public.projects1_orders.problem_description is
  'Home Repairs free-text problem description (up to ~2000 chars in API).';
comment on column public.projects1_orders.massage_category is
  'Massage menu category id or title (e.g. back-neck / Back & Neck Massage).';
comment on column public.projects1_orders.repair_photo_paths is
  'Private Storage object paths for repair photos (bucket repair-order-photos).';
comment on column public.projects1_orders.pricing_mode is
  'fixed = price_euro set at order time; quote = repair awaiting assessment (price_euro null).';

-- -----------------------------------------------------------------------------
-- 2) Backfill pricing_mode + NOT NULL + DEFAULT 'fixed'
-- -----------------------------------------------------------------------------
update public.projects1_orders
set pricing_mode = 'fixed'
where pricing_mode is null;

alter table public.projects1_orders
  alter column pricing_mode set default 'fixed';

alter table public.projects1_orders
  alter column pricing_mode set not null;

-- -----------------------------------------------------------------------------
-- 3) Price model for quote repairs
--    Exact Production legacy definition required before drop:
--      CHECK ((price_euro > (0)::numeric))
--    Unexpected definition → raise and abort transaction (constraint kept).
-- -----------------------------------------------------------------------------
do $$
declare
  def text;
  expected constant text := 'CHECK ((price_euro > (0)::numeric))';
begin
  select pg_get_constraintdef(c.oid)
  into def
  from pg_constraint c
  where c.conname = 'projects1_orders_price_check'
    and c.conrelid = 'public.projects1_orders'::regclass;

  if def is null then
    -- Already removed on a previous successful run — OK if new check exists.
    if not exists (
      select 1 from pg_constraint
      where conname = 'projects1_orders_price_mode_check'
        and conrelid = 'public.projects1_orders'::regclass
    ) then
      raise exception
        'projects1_orders_price_check is missing and projects1_orders_price_mode_check is not present. Aborting — inspect Production constraints before re-running.';
    end if;
  elsif def = expected then
    alter table public.projects1_orders drop constraint projects1_orders_price_check;
  else
    raise exception
      'Unexpected projects1_orders_price_check definition. Expected: %. Found: %. Constraint NOT dropped. Aborting.',
      expected,
      def;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects1_orders'
      and column_name = 'price_euro'
      and is_nullable = 'NO'
  ) then
    alter table public.projects1_orders
      alter column price_euro drop not null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'projects1_orders_price_mode_check'
      and conrelid = 'public.projects1_orders'::regclass
  ) then
    alter table public.projects1_orders
      add constraint projects1_orders_price_mode_check
      check (
        (
          pricing_mode = 'fixed'
          and price_euro is not null
          and price_euro > 0
        )
        or
        (
          pricing_mode = 'quote'
          and price_euro is null
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'projects1_orders_pricing_mode_values'
      and conrelid = 'public.projects1_orders'::regclass
  ) then
    alter table public.projects1_orders
      add constraint projects1_orders_pricing_mode_values
      check (pricing_mode in ('fixed', 'quote'));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4) Soft validation CHECKs (NULL OK for legacy rows without wizard fields)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'projects1_orders_preferred_time_check'
      and conrelid = 'public.projects1_orders'::regclass
  ) then
    alter table public.projects1_orders
      add constraint projects1_orders_preferred_time_check
      check (
        preferred_time is null
        or preferred_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'projects1_orders_problem_description_len'
      and conrelid = 'public.projects1_orders'::regclass
  ) then
    alter table public.projects1_orders
      add constraint projects1_orders_problem_description_len
      check (
        problem_description is null
        or char_length(problem_description) <= 2000
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'projects1_orders_repair_photos_len'
      and conrelid = 'public.projects1_orders'::regclass
  ) then
    alter table public.projects1_orders
      add constraint projects1_orders_repair_photos_len
      check (
        repair_photo_paths is null
        or cardinality(repair_photo_paths) <= 5
      );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5) Indexes
-- -----------------------------------------------------------------------------
create unique index if not exists projects1_orders_order_ref_uidx
  on public.projects1_orders (order_ref)
  where order_ref is not null;

create index if not exists projects1_orders_city_idx
  on public.projects1_orders (city);

create index if not exists projects1_orders_pricing_mode_idx
  on public.projects1_orders (pricing_mode);

create index if not exists projects1_orders_service_date_idx
  on public.projects1_orders (service_date);

-- -----------------------------------------------------------------------------
-- 6) Privileges + RLS (PII)
--    Next.js API: SUPABASE_SERVICE_ROLE_KEY bypasses RLS.
--    TRUNCATE must be revoked explicitly (not blocked like SELECT under RLS).
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on table public.projects1_orders to service_role;

revoke all privileges on table public.projects1_orders from anon;
revoke all privileges on table public.projects1_orders from authenticated;
revoke all privileges on table public.projects1_orders from public;

revoke select, insert, update, delete, truncate, references, trigger
  on table public.projects1_orders
  from anon, authenticated, public;

alter table public.projects1_orders enable row level security;

drop policy if exists "projects1_orders_anon_all" on public.projects1_orders;
drop policy if exists "projects1_orders_authenticated_all" on public.projects1_orders;
drop policy if exists "Enable read access for all users" on public.projects1_orders;
drop policy if exists "Enable insert for all users" on public.projects1_orders;

drop policy if exists "projects1_orders_restrict_anon" on public.projects1_orders;
drop policy if exists "projects1_orders_restrict_authenticated" on public.projects1_orders;

create policy "projects1_orders_restrict_anon"
  on public.projects1_orders
  as restrictive
  for all
  to anon
  using (false)
  with check (false);

create policy "projects1_orders_restrict_authenticated"
  on public.projects1_orders
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

comment on table public.projects1_orders is
  'HAVENLY orders: wizard booking — address, preferred_time, quote repairs, massage_category, order_ref. PII locked to service_role.';

-- -----------------------------------------------------------------------------
-- 7) Private Storage: repair-order-photos
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'repair-order-photos',
  'repair-order-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "repair_photos_no_anon_select" on storage.objects;
drop policy if exists "repair_photos_no_anon_insert" on storage.objects;
drop policy if exists "repair_photos_no_anon_update" on storage.objects;
drop policy if exists "repair_photos_no_anon_delete" on storage.objects;

drop policy if exists "repair_photos_restrict_anon" on storage.objects;
drop policy if exists "repair_photos_restrict_authenticated" on storage.objects;

create policy "repair_photos_restrict_anon"
  on storage.objects
  as restrictive
  for all
  to anon
  using (bucket_id <> 'repair-order-photos')
  with check (bucket_id <> 'repair-order-photos');

create policy "repair_photos_restrict_authenticated"
  on storage.objects
  as restrictive
  for all
  to authenticated
  using (bucket_id <> 'repair-order-photos')
  with check (bucket_id <> 'repair-order-photos');

commit;
