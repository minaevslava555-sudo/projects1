-- =============================================================================
-- HAVENLY Phase 3B.1 — Standalone test T8 (disposable DB only)
-- =============================================================================
-- Target: havenly-pricing-test / throwaway Supabase project.
-- NEVER run against Production (mwlvxyszksogsyflxvuv).
--
-- Prerequisites:
--   - safe_pricing_migration.sql already applied
--   - Exactly one active pricing revision exists (typically version 1 after seed)
--   - Run as postgres / supabase_admin in SQL Editor
--
-- On failure any assert raises → whole transaction rolls back (no partial publish).
-- =============================================================================

begin;

do $$
declare
  v_prev_id uuid;
  v_prev_version integer;
  v_prev_rate numeric(10, 2);
  v_draft_id uuid;
  v_new_version integer;
  v_active_id uuid;
  v_active_version integer;
  v_active_rate numeric(10, 2);
  v_plan_count integer;
  v_massage_count integer;
  r record;
  v_expected numeric;
  v_got numeric;
begin
  -- -------------------------------------------------------------------------
  -- 0) Capture current active (source of truth for copy + totals)
  -- -------------------------------------------------------------------------
  select c.id, c.version, c.cleaning_hourly_rate_euro
  into v_prev_id, v_prev_version, v_prev_rate
  from public.projects1_pricing_config c
  where c.status = 'active'
  for update;

  if v_prev_id is null then
    raise exception 'T8 FAIL: no active pricing revision (run migration seed first)';
  end if;

  if (select count(*) from public.projects1_pricing_config where status = 'active') <> 1 then
    raise exception 'T8 FAIL: expected exactly one active revision before publish';
  end if;

  raise notice 'T8: previous active id=% version=% rate=%',
    v_prev_id, v_prev_version, v_prev_rate;

  -- -------------------------------------------------------------------------
  -- 1) Create complete draft with unique version; copy rate + children from active
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
    v_prev_rate,
    format('T8 standalone: copy of active v%s → draft v%s', v_prev_version, v_new_version),
    'pricing_test_t8'
  )
  returning id into v_draft_id;

  insert into public.projects1_cleaning_room_plans (
    pricing_config_id, rooms, hours, workers
  )
  select v_draft_id, p.rooms, p.hours, p.workers
  from public.projects1_cleaning_room_plans p
  where p.pricing_config_id = v_prev_id
  order by p.rooms;

  get diagnostics v_plan_count = row_count;

  if v_plan_count <> 6 then
    raise exception
      'T8 FAIL: expected 6 cleaning plans copied from active, got %', v_plan_count;
  end if;

  insert into public.projects1_massage_prices (
    pricing_config_id, minutes, price_euro, is_active
  )
  select v_draft_id, m.minutes, m.price_euro, m.is_active
  from public.projects1_massage_prices m
  where m.pricing_config_id = v_prev_id
  order by m.minutes;

  get diagnostics v_massage_count = row_count;

  if v_massage_count <> 3 then
    raise exception
      'T8 FAIL: expected 3 massage prices copied from active, got %', v_massage_count;
  end if;

  raise notice 'T8: draft ready id=% version=% (copied % plans, % massage rows)',
    v_draft_id, v_new_version, v_plan_count, v_massage_count;

  -- -------------------------------------------------------------------------
  -- 2) Activate
  -- -------------------------------------------------------------------------
  perform public.projects1_activate_pricing_config(v_draft_id);

  -- -------------------------------------------------------------------------
  -- 3) New version active; previous archived; single active
  -- -------------------------------------------------------------------------
  select c.id, c.version, c.cleaning_hourly_rate_euro
  into v_active_id, v_active_version, v_active_rate
  from public.projects1_pricing_config c
  where c.status = 'active';

  if v_active_id is distinct from v_draft_id then
    raise exception 'T8 FAIL: active id=% expected draft id=%', v_active_id, v_draft_id;
  end if;

  if v_active_version is distinct from v_new_version then
    raise exception
      'T8 FAIL: active version=% expected %', v_active_version, v_new_version;
  end if;

  if (select status from public.projects1_pricing_config where id = v_prev_id)
     is distinct from 'archived' then
    raise exception 'T8 FAIL: previous active id=% is not archived', v_prev_id;
  end if;

  if (select count(*) from public.projects1_pricing_config where status = 'active') <> 1 then
    raise exception 'T8 FAIL: expected exactly one active revision after publish';
  end if;

  raise notice 'T8 PASS: active=v% id=%; previous v% archived',
    v_active_version, v_active_id, v_prev_version;

  -- -------------------------------------------------------------------------
  -- 4) Totals unchanged vs canonical production matrix (and vs previous rate)
  -- -------------------------------------------------------------------------
  if v_active_rate is distinct from v_prev_rate then
    raise exception
      'T8 FAIL: hourly rate changed (% → %)', v_prev_rate, v_active_rate;
  end if;

  if v_active_rate is distinct from 20.00 then
    raise exception 'T8 FAIL: expected hourly rate 20, got %', v_active_rate;
  end if;

  for r in
    select p.rooms, p.hours, p.workers
    from public.projects1_cleaning_room_plans p
    where p.pricing_config_id = v_active_id
    order by p.rooms
  loop
    v_got := r.hours * r.workers * v_active_rate;
    v_expected := case r.rooms
      when 1 then 40
      when 2 then 60
      when 3 then 160
      when 4 then 200
      when 5 then 360
      when 6 then 360
      else null
    end;

    if v_expected is null then
      raise exception 'T8 FAIL: unexpected rooms=% in active plans', r.rooms;
    end if;

    if v_got is distinct from v_expected then
      raise exception
        'T8 FAIL: rooms=% total=% expected %', r.rooms, v_got, v_expected;
    end if;

    raise notice 'T8 PASS: cleaning rooms=% → €%', r.rooms, v_got;
  end loop;

  if (select count(*) from public.projects1_cleaning_room_plans
      where pricing_config_id = v_active_id) <> 6 then
    raise exception 'T8 FAIL: active must have exactly 6 cleaning plans';
  end if;

  select m.price_euro into v_got
  from public.projects1_massage_prices m
  where m.pricing_config_id = v_active_id and m.minutes = 60;
  if v_got is distinct from 45.00 then
    raise exception 'T8 FAIL: massage 60=% expected 45', v_got;
  end if;
  raise notice 'T8 PASS: massage 60 → €%', v_got;

  select m.price_euro into v_got
  from public.projects1_massage_prices m
  where m.pricing_config_id = v_active_id and m.minutes = 90;
  if v_got is distinct from 67.50 then
    raise exception 'T8 FAIL: massage 90=% expected 67.50', v_got;
  end if;
  raise notice 'T8 PASS: massage 90 → €%', v_got;

  select m.price_euro into v_got
  from public.projects1_massage_prices m
  where m.pricing_config_id = v_active_id and m.minutes = 120;
  if v_got is distinct from 90.00 then
    raise exception 'T8 FAIL: massage 120=% expected 90', v_got;
  end if;
  raise notice 'T8 PASS: massage 120 → €%', v_got;

  -- Bit-identical copy check vs archived previous children
  if exists (
    select 1
    from (
      select rooms, hours, workers
      from public.projects1_cleaning_room_plans
      where pricing_config_id = v_prev_id
    ) a
    full outer join (
      select rooms, hours, workers
      from public.projects1_cleaning_room_plans
      where pricing_config_id = v_active_id
    ) b
      on a.rooms = b.rooms
    where a.hours is distinct from b.hours
       or a.workers is distinct from b.workers
       or a.rooms is null
       or b.rooms is null
  ) then
    raise exception 'T8 FAIL: cleaning plans differ from previous active (now archived)';
  end if;

  if exists (
    select 1
    from (
      select minutes, price_euro, is_active
      from public.projects1_massage_prices
      where pricing_config_id = v_prev_id
    ) a
    full outer join (
      select minutes, price_euro, is_active
      from public.projects1_massage_prices
      where pricing_config_id = v_active_id
    ) b
      on a.minutes = b.minutes
    where a.price_euro is distinct from b.price_euro
       or a.is_active is distinct from b.is_active
       or a.minutes is null
       or b.minutes is null
  ) then
    raise exception 'T8 FAIL: massage prices differ from previous active (now archived)';
  end if;

  raise notice '========================================';
  raise notice 'T8 PASS: draft v% activated; v% archived; totals unchanged',
    v_new_version, v_prev_version;
  raise notice '========================================';
end $$;

commit;

-- Optional read-only confirmation (after successful commit):
-- select version, status, cleaning_hourly_rate_euro, activated_at, archived_at
-- from public.projects1_pricing_config
-- order by version;
