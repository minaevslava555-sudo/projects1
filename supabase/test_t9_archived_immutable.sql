-- =============================================================================
-- HAVENLY Phase 3B.1 — Standalone test T9 (disposable DB only)
-- =============================================================================
-- Target: havenly-pricing-test / throwaway Supabase project.
-- NEVER run against Production (mwlvxyszksogsyflxvuv).
--
-- Expected DB state after T7/T8:
--   version 1    = archived, €20
--   version 9001 = draft, €20
--   version 9002 = active, €20
--
-- Verifies archived version 1 (root + children) cannot be mutated.
-- Does not modify active version 9002.
-- Expected trigger errors are caught inside the test so the script ends successfully.
-- Outer transaction always ROLLBACKs (no leftover writes even if something slipped).
-- =============================================================================

begin;

do $$
declare
  v_arch_id uuid;
  v_arch_rate numeric(10, 2);
  v_arch_note text;
  v_arch_status text;

  v_plan_rooms integer := 1;
  v_plan_hours integer;
  v_plan_workers integer;

  v_massage_minutes integer := 60;
  v_massage_price numeric(10, 2);
  v_massage_active boolean;

  v_active_id uuid;
  v_active_version integer;
  v_active_rate numeric(10, 2);

  v_err text;
  v_blocked integer := 0;
begin
  -- -------------------------------------------------------------------------
  -- 0) Resolve archived v1 + snapshot; confirm active 9002 untouched baseline
  -- -------------------------------------------------------------------------
  select c.id, c.cleaning_hourly_rate_euro, c.note, c.status
  into v_arch_id, v_arch_rate, v_arch_note, v_arch_status
  from public.projects1_pricing_config c
  where c.version = 1;

  if v_arch_id is null then
    raise exception 'T9 FAIL: pricing version 1 not found';
  end if;

  if v_arch_status is distinct from 'archived' then
    raise exception
      'T9 FAIL: version 1 status=% (expected archived)', v_arch_status;
  end if;

  if v_arch_rate is distinct from 20.00 then
    raise exception 'T9 FAIL: version 1 rate=% (expected 20)', v_arch_rate;
  end if;

  select p.hours, p.workers
  into v_plan_hours, v_plan_workers
  from public.projects1_cleaning_room_plans p
  where p.pricing_config_id = v_arch_id
    and p.rooms = v_plan_rooms;

  if v_plan_hours is null then
    raise exception 'T9 FAIL: archived v1 missing cleaning plan rooms=%', v_plan_rooms;
  end if;

  select m.price_euro, m.is_active
  into v_massage_price, v_massage_active
  from public.projects1_massage_prices m
  where m.pricing_config_id = v_arch_id
    and m.minutes = v_massage_minutes;

  if v_massage_price is null then
    raise exception
      'T9 FAIL: archived v1 missing massage minutes=%', v_massage_minutes;
  end if;

  select c.id, c.version, c.cleaning_hourly_rate_euro
  into v_active_id, v_active_version, v_active_rate
  from public.projects1_pricing_config c
  where c.status = 'active';

  if v_active_version is distinct from 9002 then
    raise exception
      'T9 FAIL: expected active version 9002, got % (abort to avoid touching wrong active)',
      v_active_version;
  end if;

  raise notice 'T9: archived v1 id=% rate=%; active v% id=%',
    v_arch_id, v_arch_rate, v_active_version, v_active_id;

  -- -------------------------------------------------------------------------
  -- 1) Attempt: change Cleaning hourly rate on archived v1
  -- -------------------------------------------------------------------------
  begin
    update public.projects1_pricing_config
    set cleaning_hourly_rate_euro = 99.00
    where id = v_arch_id;

    raise exception 'T9 FAIL: archived rate UPDATE unexpectedly succeeded';
  exception
    when others then
      if sqlerrm like 'T9 FAIL:%' then
        raise;
      end if;
      v_err := sqlerrm;
      v_blocked := v_blocked + 1;
      raise notice 'T9 PASS: archived rate UPDATE blocked (% )', v_err;
  end;

  -- -------------------------------------------------------------------------
  -- 2) Attempt: change one Cleaning room plan on archived v1
  -- -------------------------------------------------------------------------
  begin
    update public.projects1_cleaning_room_plans
    set hours = hours + 1
    where pricing_config_id = v_arch_id
      and rooms = v_plan_rooms;

    raise exception 'T9 FAIL: archived cleaning plan UPDATE unexpectedly succeeded';
  exception
    when others then
      if sqlerrm like 'T9 FAIL:%' then
        raise;
      end if;
      v_err := sqlerrm;
      v_blocked := v_blocked + 1;
      raise notice 'T9 PASS: archived cleaning plan UPDATE blocked (% )', v_err;
  end;

  -- -------------------------------------------------------------------------
  -- 3) Attempt: change one Massage price on archived v1
  -- -------------------------------------------------------------------------
  begin
    update public.projects1_massage_prices
    set price_euro = 999.00
    where pricing_config_id = v_arch_id
      and minutes = v_massage_minutes;

    raise exception 'T9 FAIL: archived massage price UPDATE unexpectedly succeeded';
  exception
    when others then
      if sqlerrm like 'T9 FAIL:%' then
        raise;
      end if;
      v_err := sqlerrm;
      v_blocked := v_blocked + 1;
      raise notice 'T9 PASS: archived massage price UPDATE blocked (% )', v_err;
  end;

  if v_blocked <> 3 then
    raise exception 'T9 FAIL: expected 3 blocked mutations, got %', v_blocked;
  end if;

  -- -------------------------------------------------------------------------
  -- 4) Archived v1 data unchanged
  -- -------------------------------------------------------------------------
  if (
    select c.cleaning_hourly_rate_euro
    from public.projects1_pricing_config c
    where c.id = v_arch_id
  ) is distinct from v_arch_rate then
    raise exception 'T9 FAIL: archived v1 rate changed after blocked updates';
  end if;

  if (
    select c.note
    from public.projects1_pricing_config c
    where c.id = v_arch_id
  ) is distinct from v_arch_note then
    raise exception 'T9 FAIL: archived v1 note changed';
  end if;

  if (
    select c.status
    from public.projects1_pricing_config c
    where c.id = v_arch_id
  ) is distinct from 'archived' then
    raise exception 'T9 FAIL: archived v1 status changed';
  end if;

  if (
    select p.hours
    from public.projects1_cleaning_room_plans p
    where p.pricing_config_id = v_arch_id and p.rooms = v_plan_rooms
  ) is distinct from v_plan_hours
  or (
    select p.workers
    from public.projects1_cleaning_room_plans p
    where p.pricing_config_id = v_arch_id and p.rooms = v_plan_rooms
  ) is distinct from v_plan_workers then
    raise exception 'T9 FAIL: archived cleaning plan rooms=% changed', v_plan_rooms;
  end if;

  if (
    select m.price_euro
    from public.projects1_massage_prices m
    where m.pricing_config_id = v_arch_id and m.minutes = v_massage_minutes
  ) is distinct from v_massage_price
  or (
    select m.is_active
    from public.projects1_massage_prices m
    where m.pricing_config_id = v_arch_id and m.minutes = v_massage_minutes
  ) is distinct from v_massage_active then
    raise exception
      'T9 FAIL: archived massage minutes=% changed', v_massage_minutes;
  end if;

  raise notice 'T9 PASS: archived v1 data unchanged';

  -- -------------------------------------------------------------------------
  -- 5) Active 9002 still active and unchanged
  -- -------------------------------------------------------------------------
  if (
    select c.status
    from public.projects1_pricing_config c
    where c.id = v_active_id
  ) is distinct from 'active' then
    raise exception 'T9 FAIL: active revision is no longer active';
  end if;

  if (
    select c.version
    from public.projects1_pricing_config c
    where c.id = v_active_id
  ) is distinct from 9002 then
    raise exception 'T9 FAIL: active version is no longer 9002';
  end if;

  if (
    select c.cleaning_hourly_rate_euro
    from public.projects1_pricing_config c
    where c.id = v_active_id
  ) is distinct from v_active_rate then
    raise exception 'T9 FAIL: active 9002 rate changed during T9';
  end if;

  raise notice 'T9 PASS: active v9002 untouched';
  raise notice '========================================';
  raise notice 'T9 PASS: archived pricing is immutable';
  raise notice '========================================';
end $$;

rollback;

-- Optional read-only confirmation after ROLLBACK:
-- select version, status, cleaning_hourly_rate_euro
-- from public.projects1_pricing_config
-- order by version;
