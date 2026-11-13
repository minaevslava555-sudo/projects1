-- =============================================================================
-- HAVENLY Phase 3B.1 — Standalone test T10 (disposable DB only)
-- =============================================================================
-- Target: havenly-pricing-test / throwaway Supabase project.
-- NEVER run against Production (mwlvxyszksogsyflxvuv).
--
-- Actual projects1_orders columns on havenly-pricing-test:
--   id, name, phone, service, price_euro, service_date, status, created_at,
--   pricing_config_id, pricing_version, hourly_rate_snapshot, pricing_snapshot
-- Missing (do NOT reference): pricing_mode, rooms, hours, workers, details, …
-- Extra booking fields for the test live inside pricing_snapshot JSONB.
--
-- Expected pricing state after T8/T9:
--   version 1    = archived, €20/h
--   version 9001 = draft, €20/h
--   version 9002 = active, €20/h
--
-- Flow:
--   1) Insert old order €120 snapshotted to active v9002 (€20/h)
--   2) Activate new draft at €25/h (plans copied from current active)
--   3) Assert old order fully unchanged (incl. JSONB)
--   4) Insert new order for rooms=3 using hours/workers from NEW active plans
--      →  hours*workers*25 = 4*2*25 = €200
--   5) ROLLBACK — no leftover data
--
-- €120 note: live matrix at €20 for rooms=3 would be €160. €120 is an
-- intentional frozen agreed total to prove historical orders are not recalculated.
-- =============================================================================

begin;

do $$
declare
  v_active_id uuid;
  v_active_version integer;
  v_active_rate numeric(10, 2);

  v_old_order_id uuid := gen_random_uuid();
  v_new_order_id uuid := gen_random_uuid();

  v_old_snapshot jsonb;
  v_old_price numeric(10, 2) := 120.00;
  v_old_rate_snap numeric(10, 2);
  v_old_version integer;
  v_old_config_id uuid;

  v_draft_id uuid;
  v_new_version integer;
  v_new_rate numeric(10, 2) := 25.00;

  v_plan_count integer;
  v_massage_count integer;

  v_hours integer;
  v_workers integer;
  v_new_live_total numeric(10, 2);

  v_got_price numeric(10, 2);
  v_got_version integer;
  v_got_rate_snap numeric(10, 2);
  v_got_config uuid;
  v_got_snapshot jsonb;
begin
  -- -------------------------------------------------------------------------
  -- 0) Schema gate — only columns that exist on havenly-pricing-test
  -- -------------------------------------------------------------------------
  if to_regclass('public.projects1_orders') is null then
    raise exception 'T10 FAIL: public.projects1_orders does not exist';
  end if;

  if exists (
    select 1
    from (
      values
        ('id'),
        ('name'),
        ('phone'),
        ('service'),
        ('price_euro'),
        ('service_date'),
        ('status'),
        ('created_at'),
        ('pricing_config_id'),
        ('pricing_version'),
        ('hourly_rate_snapshot'),
        ('pricing_snapshot')
    ) as req(col)
    where not exists (
      select 1
      from information_schema.columns ic
      where ic.table_schema = 'public'
        and ic.table_name = 'projects1_orders'
        and ic.column_name = req.col
    )
  ) then
    raise exception
      'T10 FAIL: projects1_orders is missing one or more required columns for this test DB';
  end if;

  raise notice 'T10 PASS: required order/snapshot columns present';

  -- -------------------------------------------------------------------------
  -- 1) Current active tariff (expect v9002 @ €20)
  -- -------------------------------------------------------------------------
  select c.id, c.version, c.cleaning_hourly_rate_euro
  into v_active_id, v_active_version, v_active_rate
  from public.projects1_pricing_config c
  where c.status = 'active'
  for update;

  if v_active_id is null then
    raise exception 'T10 FAIL: no active pricing revision';
  end if;

  if v_active_version is distinct from 9002 then
    raise exception
      'T10 FAIL: expected active version 9002, got %', v_active_version;
  end if;

  if v_active_rate is distinct from 20.00 then
    raise exception
      'T10 FAIL: expected active rate 20, got %', v_active_rate;
  end if;

  raise notice 'T10: active tariff id=% version=% rate=%',
    v_active_id, v_active_version, v_active_rate;

  -- Canonical 3-room plan on current active (for snapshot metadata only)
  select p.hours, p.workers
  into v_hours, v_workers
  from public.projects1_cleaning_room_plans p
  where p.pricing_config_id = v_active_id
    and p.rooms = 3;

  if v_hours is null or v_workers is null then
    raise exception
      'T10 FAIL: active tariff missing cleaning plan for rooms=3';
  end if;

  v_old_config_id := v_active_id;
  v_old_version := v_active_version;
  v_old_rate_snap := v_active_rate;
  v_old_snapshot := jsonb_build_object(
    'rooms', 3,
    'hours', v_hours,
    'workers', v_workers,
    'rate', v_old_rate_snap,
    'mode', 'fixed',
    'priceEuro', v_old_price,
    'note', 'T10 frozen agreed total €120 (live 3-room at €20 would be €160)'
  );

  -- -------------------------------------------------------------------------
  -- 2) Old order €120 bound to v9002 snapshot (unique id, no DELETE)
  -- -------------------------------------------------------------------------
  insert into public.projects1_orders (
    id,
    name,
    phone,
    service,
    price_euro,
    service_date,
    status,
    pricing_config_id,
    pricing_version,
    hourly_rate_snapshot,
    pricing_snapshot
  ) values (
    v_old_order_id,
    'T10 Snapshot Fixture',
    '+10000000010',
    'cleaning',
    v_old_price,
    current_date,
    'new',
    v_old_config_id,
    v_old_version,
    v_old_rate_snap,
    v_old_snapshot
  );

  raise notice 'T10 PASS: old order id=% price_euro=120 version=%',
    v_old_order_id, v_old_version;

  -- -------------------------------------------------------------------------
  -- 3) New draft @ €25/h — copy plans from current active — activate
  -- -------------------------------------------------------------------------
  select coalesce(max(c.version), 0) + 1
  into v_new_version
  from public.projects1_pricing_config c;

  insert into public.projects1_pricing_config (
    version,
    status,
    cleaning_hourly_rate_euro,
    note,
    created_by
  ) values (
    v_new_version,
    'draft',
    v_new_rate,
    format('T10 draft rate %s copied from active v%s', v_new_rate, v_active_version),
    'pricing_test_t10'
  )
  returning id into v_draft_id;

  insert into public.projects1_cleaning_room_plans (
    pricing_config_id, rooms, hours, workers
  )
  select v_draft_id, p.rooms, p.hours, p.workers
  from public.projects1_cleaning_room_plans p
  where p.pricing_config_id = v_active_id
  order by p.rooms;

  get diagnostics v_plan_count = row_count;
  if v_plan_count <> 6 then
    raise exception 'T10 FAIL: expected 6 cleaning plans copied, got %', v_plan_count;
  end if;

  insert into public.projects1_massage_prices (
    pricing_config_id, minutes, price_euro, is_active
  )
  select v_draft_id, m.minutes, m.price_euro, m.is_active
  from public.projects1_massage_prices m
  where m.pricing_config_id = v_active_id
  order by m.minutes;

  get diagnostics v_massage_count = row_count;
  if v_massage_count <> 3 then
    raise exception 'T10 FAIL: expected 3 massage rows copied, got %', v_massage_count;
  end if;

  perform public.projects1_activate_pricing_config(v_draft_id);

  if (
    select c.status from public.projects1_pricing_config c where c.id = v_draft_id
  ) is distinct from 'active' then
    raise exception 'T10 FAIL: new draft did not become active';
  end if;

  if (
    select c.status from public.projects1_pricing_config c where c.id = v_old_config_id
  ) is distinct from 'archived' then
    raise exception 'T10 FAIL: previous active v% was not archived', v_old_version;
  end if;

  if (
    select c.cleaning_hourly_rate_euro
    from public.projects1_pricing_config c
    where c.id = v_draft_id
  ) is distinct from v_new_rate then
    raise exception 'T10 FAIL: new active rate is not %', v_new_rate;
  end if;

  raise notice 'T10 PASS: activated version=% rate=%; previous v% archived',
    v_new_version, v_new_rate, v_old_version;

  -- -------------------------------------------------------------------------
  -- 4) Old order fully unchanged (scalar snapshots + JSONB)
  -- -------------------------------------------------------------------------
  select
    o.price_euro,
    o.pricing_version,
    o.hourly_rate_snapshot,
    o.pricing_config_id,
    o.pricing_snapshot
  into
    v_got_price,
    v_got_version,
    v_got_rate_snap,
    v_got_config,
    v_got_snapshot
  from public.projects1_orders o
  where o.id = v_old_order_id;

  if v_got_price is distinct from v_old_price then
    raise exception 'T10 FAIL: old order price_euro=% (expected %)', v_got_price, v_old_price;
  end if;

  if v_got_version is distinct from v_old_version then
    raise exception
      'T10 FAIL: old order pricing_version=% (expected %)', v_got_version, v_old_version;
  end if;

  if v_got_rate_snap is distinct from v_old_rate_snap then
    raise exception
      'T10 FAIL: old order hourly_rate_snapshot=% (expected %)',
      v_got_rate_snap, v_old_rate_snap;
  end if;

  if v_got_config is distinct from v_old_config_id then
    raise exception 'T10 FAIL: old order pricing_config_id changed';
  end if;

  if v_got_snapshot is distinct from v_old_snapshot then
    raise exception
      'T10 FAIL: old order pricing_snapshot JSONB changed (got %, expected %)',
      v_got_snapshot, v_old_snapshot;
  end if;

  raise notice 'T10 PASS: old order immutable (€120 / v% / rate 20 / JSONB)',
    v_old_version;

  -- -------------------------------------------------------------------------
  -- 5) New order: hours/workers from NEW active plans for rooms=3 → €200
  -- -------------------------------------------------------------------------
  select p.hours, p.workers
  into v_hours, v_workers
  from public.projects1_cleaning_room_plans p
  where p.pricing_config_id = v_draft_id
    and p.rooms = 3;

  if v_hours is null or v_workers is null then
    raise exception
      'T10 FAIL: new active tariff missing cleaning plan for rooms=3';
  end if;

  v_new_live_total := v_hours * v_workers * v_new_rate;

  if v_new_live_total is distinct from 200.00 then
    raise exception
      'T10 FAIL: expected rooms=3 total 200 at rate 25 (hours=% workers=% got %)',
      v_hours, v_workers, v_new_live_total;
  end if;

  insert into public.projects1_orders (
    id,
    name,
    phone,
    service,
    price_euro,
    service_date,
    status,
    pricing_config_id,
    pricing_version,
    hourly_rate_snapshot,
    pricing_snapshot
  ) values (
    v_new_order_id,
    'T10 New Tariff Fixture',
    '+10000000011',
    'cleaning',
    v_new_live_total,
    current_date,
    'new',
    v_draft_id,
    v_new_version,
    v_new_rate,
    jsonb_build_object(
      'rooms', 3,
      'hours', v_hours,
      'workers', v_workers,
      'rate', v_new_rate,
      'mode', 'fixed',
      'priceEuro', v_new_live_total
    )
  );

  select o.price_euro, o.pricing_version, o.hourly_rate_snapshot, o.pricing_config_id
  into v_got_price, v_got_version, v_got_rate_snap, v_got_config
  from public.projects1_orders o
  where o.id = v_new_order_id;

  if v_got_price is distinct from 200.00 then
    raise exception 'T10 FAIL: new order price_euro=% (expected 200)', v_got_price;
  end if;

  if v_got_version is distinct from v_new_version then
    raise exception
      'T10 FAIL: new order pricing_version=% (expected %)',
      v_got_version, v_new_version;
  end if;

  if v_got_rate_snap is distinct from v_new_rate then
    raise exception
      'T10 FAIL: new order hourly_rate_snapshot=% (expected %)',
      v_got_rate_snap, v_new_rate;
  end if;

  if v_got_config is distinct from v_draft_id then
    raise exception 'T10 FAIL: new order pricing_config_id mismatch';
  end if;

  -- Old order still isolated after new insert
  select o.price_euro, o.pricing_snapshot
  into v_got_price, v_got_snapshot
  from public.projects1_orders o
  where o.id = v_old_order_id;

  if v_got_price is distinct from v_old_price
     or v_got_snapshot is distinct from v_old_snapshot then
    raise exception 'T10 FAIL: old order changed after inserting new order';
  end if;

  raise notice 'T10 PASS: new order €% on version=% (hours=% workers=%); old still €120',
    v_new_live_total, v_new_version, v_hours, v_workers;
  raise notice '========================================';
  raise notice 'T10 PASS: order pricing snapshots survive tariff changes';
  raise notice '========================================';
end $$;

rollback;

-- After ROLLBACK, tariff state returns to pre-T10 (active v9002).
-- select version, status, cleaning_hourly_rate_euro
-- from public.projects1_pricing_config
-- order by version;
