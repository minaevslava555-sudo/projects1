-- Заказы с лендинга HAVENLY (калькулятор → POST /api/order)
-- Применить в Supabase → SQL Editor.

create table if not exists projects1_orders (
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
  created_at timestamptz not null default now(),
  constraint projects1_orders_service_check check (
    service in ('cleaning', 'repair', 'massage')
  ),
  constraint projects1_orders_price_check check (price_euro > 0),
  constraint projects1_orders_status_check check (
    status in ('new', 'confirmed', 'done', 'cancelled')
  )
);

-- Если таблица уже создана без rooms:
alter table projects1_orders add column if not exists rooms integer;

comment on table projects1_orders is 'Заявки с сайта: имя, телефон, услуга, сумма, дата, комнаты, детали расчёта';

create index if not exists projects1_orders_created_at_idx
  on projects1_orders (created_at desc);

create index if not exists projects1_orders_status_idx
  on projects1_orders (status);

grant select, insert, update, delete on table projects1_orders to service_role;
