-- =============================================================================
-- HAVENLY Phase 3B.1 — DISPOSABLE DATABASE TEST HARNESS
-- =============================================================================
-- Target: throwaway Supabase project / local Postgres ONLY.
-- NEVER run against Production.
--
-- This file does NOT apply the migration. Run migrations first (see plan).
--
-- Prerequisites (owner / postgres session):
--   1) Disposable empty(ish) database
--   2) Roles anon, authenticated, service_role exist (Supabase default)
--      For plain Postgres, create them before the migration (see instructions)
--   3) public.projects1_orders exists (minimal stub OK) BEFORE migration
--   4) supabase/safe_pricing_migration.sql applied successfully
--   5) supabase/safe_pricing_migration.sql applied a SECOND time (idempotency)
--   6) Then run THIS file as table owner (postgres / supabase_admin)
--
-- Concurrent serialization (test 11) requires TWO sessions — see section T11.
-- Automated checks below cover T1–T10, T12–T13 and a lock-protocol probe for T11.
-- =============================================================================

create schema if not exists projects1_pricing_test;

create or replace function projects1_pricing_test.assert(p_ok boolean, p_msg text)
returns void
language plpgsql
as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'FAIL: %', p_msg;
  end if;
  raise notice 'PASS: %', p_msg;
end;
$$;

create or replace function projects1_pricing_test.assert_raises(
  p_sql text,
  p_msg text,
  p_sqlstate text default null
)
returns void
language plpgsql
as $$
declare
  raised boolean := false;
  got_state text;
  got_msg text;
begin
  begin
    execute p_sql;
  exception
    when others then
      raised := true;
      got_state := sqlstate;
      got_msg := sqlerrm;
  end;

  if not raised then
    raise exception 'FAIL: % (expected error, statement succeeded)', p_msg;
  end if;

  if p_sqlstate is not null and got_state is distinct from p_sqlstate then
    raise exception
      'FAIL: % (expected sqlstate %, got % / %)',
      p_msg, p_sqlstate, got_state, got_msg;
  end if;

  raise notice 'PASS: % (got %: %)', p_msg, got_state, got_msg;
end;
$$;

-- -----------------------------------------------------------------------------
-- Fixture: sample order row to prove migration/tests do not rewrite history
-- -----------------------------------------------------------------------------
do $$
declare
  v_id uuid := 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
begin
  -- Minimal shape compatible with production orders after wizard migration.
  -- Disposable DB only — create stub columns if a bare table was used.
  if to_regclass('public.projects1_orders') is null then
    raise exception
      'projects1_orders missing. Create a stub table before migration (see test plan).';
  end if;

  delete from public.projects1_orders where id = v_id;

  insert into public.projects1_orders (
    id, name, phone, service, price_euro, pricing_mode, service_date, status
  ) values (
    v_id,
    'Pricing Test Fixture',
    '+10000000000',
    'cleaning',
    40.00,
    'fixed',
    current_date,
    'new'
  );
exception
  when undefined_column then
    -- Older stub without pricing_mode — try narrower insert
    insert into public.projects1_orders (
      id, name, phone, service, price_euro, service_date, status
    ) values (
      v_id,
      'Pricing Test Fixture',
      '+10000000000',
      'cleaning',
      40.00,
      current_date,
      'new'
    )
    on conflict (id) do update
      set price_euro = 40.00,
          name = excluded.name;
end $$;

-- Snapshot fixture fingerprint
drop table if exists projects1_pricing_test_order_snap;
create temporary table projects1_pricing_test_order_snap as
select
  id,
  name,
  phone,
  service,
  price_euro,
  status,
  pricing_config_id,
  pricing_version,
  hourly_rate_snapshot,
  pricing_snapshot
from public.projects1_orders
where id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

-- =============================================================================
-- T3–T5: Seeded active v1 prices
-- =============================================================================
do $$
declare
  v_id uuid;
  v_version integer;
  v_rate numeric;
  r record;
  expected numeric;
begin
  select c.id, c.version, c.cleaning_hourly_rate_euro
  into v_id, v_version, v_rate
  from public.projects1_pricing_config c
  where c.status = 'active';

  perform projects1_pricing_test.assert(
    v_id is not null,
    'T3: exactly one active config exists'
  );
  perform projects1_pricing_test.assert(
    (select count(*) from public.projects1_pricing_config where status = 'active') = 1,
    'T3: single active row'
  );
  perform projects1_pricing_test.assert(v_version = 1, 'T3: active version is 1');
  perform projects1_pricing_test.assert(v_rate = 20.00, 'T4: hourly rate is 20');

  for r in
    select p.rooms, p.hours, p.workers,
           (p.hours * p.workers * v_rate) as total
    from public.projects1_cleaning_room_plans p
    where p.pricing_config_id = v_id
    order by p.rooms
  loop
    expected := case r.rooms
      when 1 then 40
      when 2 then 60
      when 3 then 160
      when 4 then 200
      when 5 then 360
      when 6 then 360
    end;
    perform projects1_pricing_test.assert(
      r.total = expected,
      format('T4: rooms=%s total=%s (expected %s)', r.rooms, r.total, expected)
    );
  end loop;

  perform projects1_pricing_test.assert(
    (select price_euro from public.projects1_massage_prices
     where pricing_config_id = v_id and minutes = 60) = 45.00,
    'T5: massage 60 = 45'
  );
  perform projects1_pricing_test.assert(
    (select price_euro from public.projects1_massage_prices
     where pricing_config_id = v_id and minutes = 90) = 67.50,
    'T5: massage 90 = 67.50'
  );
  perform projects1_pricing_test.assert(
    (select price_euro from public.projects1_massage_prices
     where pricing_config_id = v_id and minutes = 120) = 90.00,
    'T5: massage 120 = 90'
  );
end $$;

-- =============================================================================
-- T6: service_role cannot update lifecycle columns
-- =============================================================================
do $$
begin
  -- Requires ability to SET ROLE service_role (owner session).
  begin
    execute 'set local role service_role';
  exception
    when insufficient_privilege then
      raise exception
        'FAIL: T6 setup — cannot SET ROLE service_role. Run as postgres/supabase_admin on a DB where service_role exists.';
    when undefined_object then
      raise exception
        'FAIL: T6 setup — role service_role does not exist. Create it on disposable plain Postgres first.';
  end;

  perform projects1_pricing_test.assert_raises(
    $sql$
      update public.projects1_pricing_config
      set status = 'archived'
      where status = 'active'
    $sql$,
    'T6: service_role cannot UPDATE status'
  );

  perform projects1_pricing_test.assert_raises(
    $sql$
      update public.projects1_pricing_config
      set activated_at = now()
      where status = 'active'
    $sql$,
    'T6: service_role cannot UPDATE activated_at'
  );

  perform projects1_pricing_test.assert_raises(
    $sql$
      update public.projects1_pricing_config
      set archived_at = now()
      where status = 'active'
    $sql$,
    'T6: service_role cannot UPDATE archived_at'
  );

  execute 'reset role';
end $$;

-- =============================================================================
-- T7: Incomplete draft cannot be activated
-- =============================================================================
do $$
declare
  v_draft uuid;
begin
  insert into public.projects1_pricing_config (
    version, status, cleaning_hourly_rate_euro, note, created_by
  ) values (
    9001, 'draft', 20.00, 'test incomplete', 'pricing_test'
  )
  returning id into v_draft;

  -- Only one room plan — incomplete
  insert into public.projects1_cleaning_room_plans (
    pricing_config_id, rooms, hours, workers
  ) values (v_draft, 1, 2, 1);

  perform projects1_pricing_test.assert_raises(
    format(
      'select public.projects1_activate_pricing_config(%L::uuid)',
      v_draft
    ),
    'T7: incomplete draft activation rejected'
  );

  perform projects1_pricing_test.assert(
    (select status from public.projects1_pricing_config where id = v_draft) = 'draft',
    'T7: incomplete draft remains draft'
  );
end $$;

-- =============================================================================
-- T8: Complete draft activates; previous active becomes archived
-- =============================================================================
do $$
declare
  v_prev uuid;
  v_prev_version integer;
  v_draft uuid;
  v_active uuid;
  v_active_version integer;
begin
  select id, version into v_prev, v_prev_version
  from public.projects1_pricing_config
  where status = 'active';

  perform projects1_pricing_test.assert(v_prev is not null, 'T8 setup: active exists');

  insert into public.projects1_pricing_config (
    version, status, cleaning_hourly_rate_euro, note, created_by
  ) values (
    9002, 'draft', 20.00, 'test complete publish', 'pricing_test'
  )
  returning id into v_draft;

  insert into public.projects1_cleaning_room_plans (
    pricing_config_id, rooms, hours, workers
  ) values
    (v_draft, 1, 2, 1),
    (v_draft, 2, 3, 1),
    (v_draft, 3, 4, 2),
    (v_draft, 4, 5, 2),
    (v_draft, 5, 6, 3),
    (v_draft, 6, 6, 3);

  insert into public.projects1_massage_prices (
    pricing_config_id, minutes, price_euro, is_active
  ) values
    (v_draft, 60, 45.00, true),
    (v_draft, 90, 67.50, true),
    (v_draft, 120, 90.00, true);

  perform public.projects1_activate_pricing_config(v_draft);

  select id, version into v_active, v_active_version
  from public.projects1_pricing_config
  where status = 'active';

  perform projects1_pricing_test.assert(v_active = v_draft, 'T8: new draft is active');
  perform projects1_pricing_test.assert(v_active_version = 9002, 'T8: active version 9002');
  perform projects1_pricing_test.assert(
    (select status from public.projects1_pricing_config where id = v_prev) = 'archived',
    'T8: previous active is archived'
  );
  perform projects1_pricing_test.assert(
    (select count(*) from public.projects1_pricing_config where status = 'active') = 1,
    'T8: still exactly one active'
  );
end $$;

-- =============================================================================
-- T9: Archived pricing cannot be modified
-- =============================================================================
do $$
declare
  v_archived uuid;
begin
  select id into v_archived
  from public.projects1_pricing_config
  where status = 'archived'
  order by version
  limit 1;

  perform projects1_pricing_test.assert(v_archived is not null, 'T9 setup: archived exists');

  perform projects1_pricing_test.assert_raises(
    format(
      'update public.projects1_pricing_config set note = %L where id = %L::uuid',
      'should fail',
      v_archived
    ),
    'T9: archived root immutable'
  );

  perform projects1_pricing_test.assert_raises(
    format(
      'update public.projects1_pricing_config set status = %L where id = %L::uuid',
      'draft',
      v_archived
    ),
    'T9: archived cannot return to draft'
  );
end $$;

-- =============================================================================
-- T10: Child rows immutable after publication (active + archived)
-- =============================================================================
do $$
declare
  v_active uuid;
  v_archived uuid;
begin
  select id into v_active from public.projects1_pricing_config where status = 'active';
  select id into v_archived
  from public.projects1_pricing_config
  where status = 'archived'
  order by version
  limit 1;

  perform projects1_pricing_test.assert_raises(
    format(
      'update public.projects1_cleaning_room_plans set hours = hours + 1 where pricing_config_id = %L::uuid and rooms = 1',
      v_active
    ),
    'T10: cannot update cleaning plan on active'
  );

  perform projects1_pricing_test.assert_raises(
    format(
      'delete from public.projects1_massage_prices where pricing_config_id = %L::uuid and minutes = 60',
      v_active
    ),
    'T10: cannot delete massage row on active'
  );

  perform projects1_pricing_test.assert_raises(
    format(
      'insert into public.projects1_cleaning_room_plans (pricing_config_id, rooms, hours, workers) values (%L::uuid, 1, 9, 9)',
      v_active
    ),
    'T10: cannot insert cleaning plan on active'
  );

  perform projects1_pricing_test.assert_raises(
    format(
      'update public.projects1_cleaning_room_plans set hours = 99 where pricing_config_id = %L::uuid and rooms = 1',
      v_archived
    ),
    'T10: cannot update cleaning plan on archived'
  );
end $$;

-- =============================================================================
-- T11 probe (single session): lock protocol FOR UPDATE vs FOR SHARE
-- Full two-session concurrency checklist is in the header / Russian plan.
-- =============================================================================
do $$
declare
  v_draft uuid;
  v_blocked boolean := false;
begin
  insert into public.projects1_pricing_config (
    version, status, cleaning_hourly_rate_euro, note, created_by
  ) values (
    9003, 'draft', 20.00, 'lock probe draft', 'pricing_test'
  )
  returning id into v_draft;

  insert into public.projects1_cleaning_room_plans (
    pricing_config_id, rooms, hours, workers
  ) values
    (v_draft, 1, 2, 1),
    (v_draft, 2, 3, 1),
    (v_draft, 3, 4, 2),
    (v_draft, 4, 5, 2),
    (v_draft, 5, 6, 3),
    (v_draft, 6, 6, 3);

  insert into public.projects1_massage_prices (
    pricing_config_id, minutes, price_euro, is_active
  ) values
    (v_draft, 60, 45.00, true),
    (v_draft, 90, 67.50, true),
    (v_draft, 120, 90.00, true);

  -- Hold FOR UPDATE like activate does, then attempt FOR SHARE (child path).
  perform 1
  from public.projects1_pricing_config c
  where c.id = v_draft
  for update;

  -- In the same session FOR SHARE after FOR UPDATE succeeds (same txn).
  -- Cross-session blocking must be verified manually (Session A/B below).
  perform 1
  from public.projects1_pricing_config c
  where c.id = v_draft
  for share;

  perform projects1_pricing_test.assert(
    true,
    'T11 probe: same-session FOR UPDATE then FOR SHARE OK (manual 2-session still required)'
  );

  -- Leave draft 9003 for manual concurrency test; do not activate here.
  raise notice 'T11 MANUAL: use draft version=9003 id=% for two-session lock test', v_draft;
end $$;

-- =============================================================================
-- T12: Existing order fixture unchanged
-- =============================================================================
do $$
declare
  n integer;
begin
  select count(*) into n
  from public.projects1_orders o
  join projects1_pricing_test_order_snap s on s.id = o.id
  where o.name is not distinct from s.name
    and o.phone is not distinct from s.phone
    and o.service is not distinct from s.service
    and o.price_euro is not distinct from s.price_euro
    and o.status is not distinct from s.status
    and o.pricing_config_id is not distinct from s.pricing_config_id
    and o.pricing_version is not distinct from s.pricing_version
    and o.hourly_rate_snapshot is not distinct from s.hourly_rate_snapshot
    and o.pricing_snapshot is not distinct from s.pricing_snapshot;

  perform projects1_pricing_test.assert(n = 1, 'T12: fixture order row unchanged');
end $$;

-- =============================================================================
-- T13: Effective privileges + function ownership
-- =============================================================================
do $$
declare
  has_status_update boolean;
  has_activated_update boolean;
  has_archived_update boolean;
  activate_owner text;
  activate_security text;
begin
  select exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'projects1_pricing_config'
      and column_name = 'status'
      and grantee = 'service_role'
      and privilege_type = 'UPDATE'
  ) into has_status_update;

  select exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'projects1_pricing_config'
      and column_name = 'activated_at'
      and grantee = 'service_role'
      and privilege_type = 'UPDATE'
  ) into has_activated_update;

  select exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'projects1_pricing_config'
      and column_name = 'archived_at'
      and grantee = 'service_role'
      and privilege_type = 'UPDATE'
  ) into has_archived_update;

  perform projects1_pricing_test.assert(
    not has_status_update,
    'T13: service_role has no UPDATE on status'
  );
  perform projects1_pricing_test.assert(
    not has_activated_update,
    'T13: service_role has no UPDATE on activated_at'
  );
  perform projects1_pricing_test.assert(
    not has_archived_update,
    'T13: service_role has no UPDATE on archived_at'
  );

  select pg_get_userbyid(p.proowner), CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END
  into activate_owner, activate_security
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'projects1_activate_pricing_config';

  perform projects1_pricing_test.assert(
    activate_owner is not null,
    'T13: activate function exists'
  );
  perform projects1_pricing_test.assert(
    activate_security = 'DEFINER',
    format('T13: activate is SECURITY DEFINER (owner=%s)', activate_owner)
  );

  raise notice 'T13 info: activate owner=%s security=%s', activate_owner, activate_security;

  -- Inherited role membership dump (informational)
  raise notice 'T13 info: service_role memberships:';
  raise notice '%', (
    select coalesce(string_agg(r.rolname, ', ' order by r.rolname), '(none)')
    from pg_auth_members m
    join pg_roles r on r.oid = m.roleid
    join pg_roles mbr on mbr.oid = m.member
    where mbr.rolname = 'service_role'
  );
end $$;

-- =============================================================================
-- Summary
-- =============================================================================
do $$
begin
  raise notice '========================================';
  raise notice 'Automated pricing tests finished.';
  raise notice 'T1/T2 (migration apply x2) are manual prerequisites.';
  raise notice 'T11 full concurrency requires two sessions (see plan).';
  raise notice '========================================';
end $$;

-- -----------------------------------------------------------------------------
-- T11 MANUAL — two sessions (replace :draft_id with version 9003 id from notice)
-- -----------------------------------------------------------------------------
-- Session A (owner):
--   begin;
--   select * from public.projects1_activate_pricing_config(':draft_id'::uuid);
--   -- do NOT commit yet
--
-- Session B (service_role or owner):
--   begin;
--   update public.projects1_cleaning_room_plans
--   set hours = hours
--   where pricing_config_id = ':draft_id'::uuid and rooms = 1;
--   -- MUST block until Session A commits/rolls back
--
-- Session A:
--   commit;
-- Session B:
--   -- after A commits, update should fail (parent now active) or, if A rolled
--   -- back, succeed while still draft
--   commit;
