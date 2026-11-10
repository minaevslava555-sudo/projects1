-- SAFE migration for HAVENLY orders
-- Idempotent: create/alter only. NO DROP / TRUNCATE / DELETE.
-- Apply in Supabase → SQL Editor → Run.

-- 1) Create table if missing (full shape expected by POST /api/order → lib/orders.ts)
create table if not exists public.projects1_orders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  service text not null,
  price_euro numeric(10, 2) not null,
  service_date date,
  details text,
  rooms integer,
  hours integer,
  workers integer,
  massage_minutes integer,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

-- 2) Add missing columns if an older table already exists
alter table public.projects1_orders add column if not exists name text;
alter table public.projects1_orders add column if not exists phone text;
alter table public.projects1_orders add column if not exists service text;
alter table public.projects1_orders add column if not exists price_euro numeric(10, 2);
alter table public.projects1_orders add column if not exists service_date date;
alter table public.projects1_orders add column if not exists details text;
alter table public.projects1_orders add column if not exists rooms integer;
alter table public.projects1_orders add column if not exists hours integer;
alter table public.projects1_orders add column if not exists workers integer;
alter table public.projects1_orders add column if not exists massage_minutes integer;
alter table public.projects1_orders add column if not exists status text;
alter table public.projects1_orders add column if not exists created_at timestamptz;

-- 3) Defaults for status / created_at (safe if already set)
alter table public.projects1_orders
  alter column status set default 'new';

alter table public.projects1_orders
  alter column created_at set default now();

-- 4) Constraints (added only when absent — no drop of existing rows)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'projects1_orders_service_check'
  ) then
    alter table public.projects1_orders
      add constraint projects1_orders_service_check
      check (service in ('cleaning', 'repair', 'massage'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'projects1_orders_price_check'
  ) then
    alter table public.projects1_orders
      add constraint projects1_orders_price_check
      check (price_euro > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'projects1_orders_status_check'
  ) then
    alter table public.projects1_orders
      add constraint projects1_orders_status_check
      check (status in ('new', 'confirmed', 'done', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'projects1_orders_rooms_check'
  ) then
    alter table public.projects1_orders
      add constraint projects1_orders_rooms_check
      check (rooms is null or (rooms >= 1 and rooms <= 6));
  end if;
end $$;

-- 5) Indexes
create index if not exists projects1_orders_created_at_idx
  on public.projects1_orders (created_at desc);

create index if not exists projects1_orders_status_idx
  on public.projects1_orders (status);

-- 6) Privileges for server-side inserts (service_role)
grant select, insert, update, delete on table public.projects1_orders to service_role;

comment on table public.projects1_orders is
  'HAVENLY landing orders: name, phone, service, price_euro, rooms, hours, workers, details';

-- 7) Optional verification (read-only)
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'projects1_orders'
-- order by ordinal_position;
