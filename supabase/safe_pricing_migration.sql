-- =============================================================================
-- HAVENLY Phase 3B.1 — SAFE pricing database preparation (security-hardened)
-- =============================================================================
-- Idempotent: CREATE / ALTER / ADD CONSTRAINT only when missing.
-- NO DROP TABLE, TRUNCATE, DELETE of business/order rows.
-- NO ALTER TABLE DISABLE/ENABLE TRIGGER.
-- NO changes to app code (resolver / wizard remain authoritative until 3B.2).
--
-- DO NOT RUN until explicitly approved.
-- Apply in Supabase → SQL Editor → Run (Production only after approval).
--
-- Authorization model (PostgreSQL / Supabase):
--   - anon / authenticated: no table privileges; RLS restrictive deny.
--   - service_role (server key only, never in browser):
--       SELECT / INSERT / DELETE on pricing tables;
--       column-level UPDATE on draft-editable columns only
--       (not status, activated_at, archived_at);
--       EXECUTE projects1_activate_pricing_config(uuid) to publish.
--   - Lifecycle column writes for service_role are denied by GRANT (primary control).
--   - Guard trigger enforces allowed transitions and draft completeness for any
--     role that can write lifecycle columns (table owner / SECURITY DEFINER).
--   - Publication path: activate holds FOR UPDATE on config; child DML takes
--     FOR SHARE on the same parent; validates; archives active; activates draft.
--     Triggers stay enabled. No DISABLE TRIGGER.
--   - current_user is NEVER used for caller identity / authorization.
--   - set_config / GUC is NOT used.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1) projects1_pricing_config  (= pricing revision / version root)
-- -----------------------------------------------------------------------------
create table if not exists public.projects1_pricing_config (
  id uuid primary key default gen_random_uuid(),
  version integer not null,
  status text not null default 'draft',
  cleaning_hourly_rate_euro numeric(10, 2) not null,
  note text,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  archived_at timestamptz,
  created_by text,
  constraint projects1_pricing_config_version_positive
    check (version >= 1),
  constraint projects1_pricing_config_status_check
    check (status in ('draft', 'active', 'archived')),
  constraint projects1_pricing_config_rate_positive
    check (cleaning_hourly_rate_euro > 0),
  constraint projects1_pricing_config_active_has_activated_at
    check (status <> 'active' or activated_at is not null),
  constraint projects1_pricing_config_archived_has_archived_at
    check (status <> 'archived' or archived_at is not null)
);

create unique index if not exists projects1_pricing_config_version_uidx
  on public.projects1_pricing_config (version);

create unique index if not exists projects1_pricing_config_one_active_uidx
  on public.projects1_pricing_config (status)
  where status = 'active';

comment on table public.projects1_pricing_config is
  'HAVENLY pricing revision root. Active row is the authoritative price book (Phase 3B.2+). Version increments on each publish.';
comment on column public.projects1_pricing_config.version is
  'Monotonic pricing version shown to clients for preview/submit mismatch detection.';
comment on column public.projects1_pricing_config.cleaning_hourly_rate_euro is
  'Euro per cleaner-hour; all cleaning types share this rate.';
comment on column public.projects1_pricing_config.status is
  'draft = editable; active = live book; archived = immutable historical revision. Not updatable by service_role.';

-- -----------------------------------------------------------------------------
-- 2) projects1_cleaning_room_plans
-- -----------------------------------------------------------------------------
create table if not exists public.projects1_cleaning_room_plans (
  pricing_config_id uuid not null
    references public.projects1_pricing_config (id)
    on delete restrict,
  rooms integer not null,
  hours integer not null,
  workers integer not null,
  created_at timestamptz not null default now(),
  primary key (pricing_config_id, rooms),
  constraint projects1_cleaning_room_plans_rooms_check
    check (rooms >= 1 and rooms <= 6),
  constraint projects1_cleaning_room_plans_hours_positive
    check (hours > 0),
  constraint projects1_cleaning_room_plans_workers_positive
    check (workers >= 1 and workers <= 10)
);

create index if not exists projects1_cleaning_room_plans_config_idx
  on public.projects1_cleaning_room_plans (pricing_config_id);

comment on table public.projects1_cleaning_room_plans is
  'Cleaning duration/crew matrix per pricing revision. Total = workers × hours × cleaning_hourly_rate_euro.';

-- -----------------------------------------------------------------------------
-- 3) projects1_massage_prices
-- -----------------------------------------------------------------------------
create table if not exists public.projects1_massage_prices (
  pricing_config_id uuid not null
    references public.projects1_pricing_config (id)
    on delete restrict,
  minutes integer not null,
  price_euro numeric(10, 2) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (pricing_config_id, minutes),
  constraint projects1_massage_prices_minutes_check
    check (minutes in (60, 90, 120)),
  constraint projects1_massage_prices_price_positive
    check (price_euro > 0)
);

create index if not exists projects1_massage_prices_config_idx
  on public.projects1_massage_prices (pricing_config_id);

comment on table public.projects1_massage_prices is
  'Fixed massage prices per duration for a pricing revision.';

-- -----------------------------------------------------------------------------
-- 4) Validation + immutability triggers + atomic activate
-- -----------------------------------------------------------------------------

create or replace function public.projects1_pricing_validate_draft_for_publish(p_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  cfg_status text;
  plan_rows integer;
  plan_distinct integer;
  plan_min integer;
  plan_max integer;
  massage_60 integer;
  massage_90 integer;
  massage_120 integer;
begin
  select c.status into cfg_status
  from public.projects1_pricing_config c
  where c.id = p_id;

  if cfg_status is null then
    raise exception 'pricing_config % not found', p_id;
  end if;
  if cfg_status <> 'draft' then
    raise exception 'Only draft revisions can be published (status=%)', cfg_status;
  end if;

  select
    count(*),
    count(distinct p.rooms),
    coalesce(min(p.rooms), 0),
    coalesce(max(p.rooms), 0)
  into plan_rows, plan_distinct, plan_min, plan_max
  from public.projects1_cleaning_room_plans p
  where p.pricing_config_id = p_id
    and p.hours > 0
    and p.workers >= 1;

  if plan_rows <> 6
     or plan_distinct <> 6
     or plan_min <> 1
     or plan_max <> 6 then
    raise exception
      'Draft must define valid plans for rooms 1–6 exactly once (rows=%, distinct=%, min=%, max=%)',
      plan_rows, plan_distinct, plan_min, plan_max;
  end if;

  select count(*) into massage_60
  from public.projects1_massage_prices m
  where m.pricing_config_id = p_id
    and m.is_active = true
    and m.minutes = 60
    and m.price_euro > 0;

  select count(*) into massage_90
  from public.projects1_massage_prices m
  where m.pricing_config_id = p_id
    and m.is_active = true
    and m.minutes = 90
    and m.price_euro > 0;

  select count(*) into massage_120
  from public.projects1_massage_prices m
  where m.pricing_config_id = p_id
    and m.is_active = true
    and m.minutes = 120
    and m.price_euro > 0;

  if massage_60 <> 1 or massage_90 <> 1 or massage_120 <> 1 then
    raise exception
      'Draft must define exactly one active massage price for 60/90/120 (got 60=%, 90=%, 120=%)',
      massage_60, massage_90, massage_120;
  end if;
end;
$$;

-- Child DML takes FOR SHARE on parent config row(s).
-- Activate holds FOR UPDATE on the same parent for the whole publish transaction,
-- so child INSERT/UPDATE/DELETE block until publish finishes (or vice versa).
-- Lock multiple parents in id order to avoid deadlocks on FK reassignment.
create or replace function public.projects1_pricing_assert_draft_parent()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  old_status text;
  new_status text;
begin
  if tg_op = 'DELETE' then
    select c.status into old_status
    from public.projects1_pricing_config c
    where c.id = old.pricing_config_id
    for share;

    if old_status is null then
      raise exception 'pricing_config % not found for child delete', old.pricing_config_id;
    end if;
    if old_status <> 'draft' then
      raise exception
        'Cannot delete cleaning/massage rows for non-draft pricing revision (status=%)',
        old_status;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    select c.status into new_status
    from public.projects1_pricing_config c
    where c.id = new.pricing_config_id
    for share;

    if new_status is null then
      raise exception 'pricing_config % not found for child insert', new.pricing_config_id;
    end if;
    if new_status <> 'draft' then
      raise exception
        'Cannot insert cleaning/massage rows for non-draft pricing revision (status=%)',
        new_status;
    end if;
    return new;
  end if;

  -- UPDATE: lock distinct parent ids in ascending order, then read statuses.
  perform 1
  from public.projects1_pricing_config c
  where c.id = old.pricing_config_id
     or c.id = new.pricing_config_id
  order by c.id
  for share;

  select c.status into old_status
  from public.projects1_pricing_config c
  where c.id = old.pricing_config_id;

  select c.status into new_status
  from public.projects1_pricing_config c
  where c.id = new.pricing_config_id;

  if old_status is null then
    raise exception 'pricing_config % not found for child update (old)', old.pricing_config_id;
  end if;
  if new_status is null then
    raise exception 'pricing_config % not found for child update (new)', new.pricing_config_id;
  end if;

  if old_status <> 'draft' then
    raise exception
      'Cannot modify cleaning/massage rows belonging to non-draft revision (old status=%)',
      old_status;
  end if;
  if new_status <> 'draft' then
    raise exception
      'Cannot assign cleaning/massage rows to non-draft revision (new status=%)',
      new_status;
  end if;

  return new;
end;
$$;

drop trigger if exists projects1_cleaning_room_plans_draft_only
  on public.projects1_cleaning_room_plans;
create trigger projects1_cleaning_room_plans_draft_only
  before insert or update or delete on public.projects1_cleaning_room_plans
  for each row
  execute procedure public.projects1_pricing_assert_draft_parent();

drop trigger if exists projects1_massage_prices_draft_only
  on public.projects1_massage_prices;
create trigger projects1_massage_prices_draft_only
  before insert or update or delete on public.projects1_massage_prices
  for each row
  execute procedure public.projects1_pricing_assert_draft_parent();

-- Controlled lifecycle transitions with triggers always enabled.
-- App-role write access to lifecycle columns is denied by column grants;
-- this guard is defense-in-depth for the table owner / SECURITY DEFINER path.
create or replace function public.projects1_pricing_config_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' then
      raise exception
        'New pricing revisions must be inserted as draft (got status=%); publish via projects1_activate_pricing_config()',
        new.status;
    end if;
    if new.activated_at is not null or new.archived_at is not null then
      raise exception 'New drafts cannot set activated_at/archived_at';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Cannot delete non-draft pricing revision (status=%)', old.status;
    end if;
    return old;
  end if;

  if old.status = 'archived' then
    raise exception 'Archived pricing revisions are immutable';
  end if;

  if old.status = 'active' then
    if new.status is distinct from 'archived' then
      raise exception
        'Invalid active transition to status=% (only archived is allowed; never draft)',
        new.status;
    end if;

    if new.id is distinct from old.id
       or new.version is distinct from old.version
       or new.cleaning_hourly_rate_euro is distinct from old.cleaning_hourly_rate_euro
       or new.note is distinct from old.note
       or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by
       or new.activated_at is distinct from old.activated_at then
      raise exception 'Cannot mutate fields of an active pricing revision during archive';
    end if;

    if new.archived_at is null then
      new.archived_at := now();
    end if;
    return new;
  end if;

  if old.status = 'draft' then
    if new.status = 'draft' then
      if new.activated_at is distinct from old.activated_at
         or new.archived_at is distinct from old.archived_at then
        raise exception 'Drafts cannot set activated_at/archived_at directly';
      end if;
      return new;
    end if;

    if new.status = 'active' then
      perform public.projects1_pricing_validate_draft_for_publish(old.id);

      if new.version is distinct from old.version
         or new.cleaning_hourly_rate_euro is distinct from old.cleaning_hourly_rate_euro
         or new.note is distinct from old.note
         or new.created_at is distinct from old.created_at
         or new.created_by is distinct from old.created_by
         or new.archived_at is distinct from old.archived_at then
        raise exception 'Cannot change draft fields while activating; activate as-is';
      end if;

      if new.activated_at is null then
        new.activated_at := now();
      end if;
      return new;
    end if;

    raise exception 'Invalid draft transition to status=%', new.status;
  end if;

  raise exception 'Unhandled pricing_config status=%', old.status;
end;
$$;

drop trigger if exists projects1_pricing_config_guard
  on public.projects1_pricing_config;
create trigger projects1_pricing_config_guard
  before insert or update or delete on public.projects1_pricing_config
  for each row
  execute procedure public.projects1_pricing_config_guard();

-- Atomic publish with triggers enabled. SECURITY DEFINER runs as function owner
-- (table owner) so lifecycle columns are writable despite service_role grants.
-- Does not use current_user for authorization; does not disable triggers.
--
-- Lock protocol with child DML:
--   activate: FOR UPDATE on draft (+ active) for the whole transaction
--   child triggers: FOR SHARE on the same parent row(s)
-- FOR UPDATE conflicts with FOR SHARE, so plans/massage cannot change while
-- a revision is being validated and activated (and activate waits if an edit
-- already holds FOR SHARE). No child FOR UPDATE here — avoids parent/child
-- lock-order deadlocks with BEFORE-row child triggers.
create or replace function public.projects1_activate_pricing_config(p_id uuid)
returns public.projects1_pricing_config
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.projects1_pricing_config;
begin
  -- Lock config rows in PK order (draft + current active) until end of txn.
  perform 1
  from public.projects1_pricing_config c
  where c.id = p_id
     or c.status = 'active'
  order by c.id
  for update;

  select * into target
  from public.projects1_pricing_config c
  where c.id = p_id;

  if not found then
    raise exception 'pricing_config % not found', p_id;
  end if;

  if target.status <> 'draft' then
    raise exception 'Only draft revisions can be activated (status=%)', target.status;
  end if;

  -- Validate while parent FOR UPDATE is held (blocks concurrent child FOR SHARE).
  -- Guard re-validates on draft→active.
  perform public.projects1_pricing_validate_draft_for_publish(p_id);

  update public.projects1_pricing_config c
  set status = 'archived',
      archived_at = coalesce(c.archived_at, now())
  where c.status = 'active';

  update public.projects1_pricing_config c
  set status = 'active',
      activated_at = now()
  where c.id = p_id
  returning * into target;

  if target.status is distinct from 'active' then
    raise exception 'Activation failed for pricing_config %', p_id;
  end if;

  return target;
end;
$$;

revoke all on function public.projects1_pricing_validate_draft_for_publish(uuid) from public;
revoke all on function public.projects1_pricing_validate_draft_for_publish(uuid) from anon;
revoke all on function public.projects1_pricing_validate_draft_for_publish(uuid) from authenticated;
grant execute on function public.projects1_pricing_validate_draft_for_publish(uuid) to service_role;

revoke all on function public.projects1_activate_pricing_config(uuid) from public;
revoke all on function public.projects1_activate_pricing_config(uuid) from anon;
revoke all on function public.projects1_activate_pricing_config(uuid) from authenticated;
grant execute on function public.projects1_activate_pricing_config(uuid) to service_role;

revoke all on function public.projects1_pricing_assert_draft_parent() from public;
revoke all on function public.projects1_pricing_assert_draft_parent() from anon;
revoke all on function public.projects1_pricing_assert_draft_parent() from authenticated;
grant execute on function public.projects1_pricing_assert_draft_parent() to service_role;

revoke all on function public.projects1_pricing_config_guard() from public;
revoke all on function public.projects1_pricing_config_guard() from anon;
revoke all on function public.projects1_pricing_config_guard() from authenticated;
grant execute on function public.projects1_pricing_config_guard() to service_role;

comment on function public.projects1_pricing_validate_draft_for_publish(uuid) is
  'Validates draft has rooms 1–6 plans and active massage 60/90/120 before publish.';
comment on function public.projects1_activate_pricing_config(uuid) is
  'SECURITY DEFINER publisher: locks config+children, validates, archives active, activates draft. Triggers stay enabled. EXECUTE = service_role only. Human auth belongs in Next.js admin API.';

drop function if exists public.projects1_pricing_is_publisher_role();

-- -----------------------------------------------------------------------------
-- 5) Seed revision v1 — idempotent, never replaces an existing active book
-- -----------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_status text;
  v_rate numeric(10, 2);
begin
  if exists (
    select 1 from public.projects1_pricing_config c where c.status = 'active'
  ) then
    raise notice 'Active pricing revision already present — seed skipped (no overwrite)';
    return;
  end if;

  select c.id, c.status, c.cleaning_hourly_rate_euro
  into v_id, v_status, v_rate
  from public.projects1_pricing_config c
  where c.version = 1;

  if v_id is not null and v_status = 'archived' then
    raise exception
      'projects1_pricing_config version=1 is archived but no active revision exists. Manual repair required — seed will not invent a replacement.';
  end if;

  if v_id is null then
    insert into public.projects1_pricing_config (
      id,
      version,
      status,
      cleaning_hourly_rate_euro,
      note,
      created_by
    ) values (
      gen_random_uuid(),
      1,
      'draft',
      20.00,
      'Phase 3B.1 seed: mirrors lib/booking-pricing.ts production constants',
      'phase_3b1_seed'
    )
    returning id into v_id;
  elsif v_status = 'draft' then
    update public.projects1_pricing_config c
    set cleaning_hourly_rate_euro = 20.00,
        note = coalesce(
          nullif(trim(c.note), ''),
          'Phase 3B.1 seed repair: incomplete draft v1'
        )
    where c.id = v_id;
    raise notice 'Repairing incomplete draft pricing version=1 id=% (previous rate=%)', v_id, v_rate;
  else
    raise exception 'Unexpected status=% for version=1 with no active revision', v_status;
  end if;

  insert into public.projects1_cleaning_room_plans (
    pricing_config_id, rooms, hours, workers
  ) values
    (v_id, 1, 2, 1),
    (v_id, 2, 3, 1),
    (v_id, 3, 4, 2),
    (v_id, 4, 5, 2),
    (v_id, 5, 6, 3),
    (v_id, 6, 6, 3)
  on conflict (pricing_config_id, rooms) do update
    set hours = excluded.hours,
        workers = excluded.workers;

  insert into public.projects1_massage_prices (
    pricing_config_id, minutes, price_euro, is_active
  ) values
    (v_id, 60, 45.00, true),
    (v_id, 90, 67.50, true),
    (v_id, 120, 90.00, true)
  on conflict (pricing_config_id, minutes) do update
    set price_euro = excluded.price_euro,
        is_active = excluded.is_active;

  perform public.projects1_activate_pricing_config(v_id);
end $$;

-- -----------------------------------------------------------------------------
-- 6) Order snapshot columns (nullable; unused until Phase 3B.2+)
-- -----------------------------------------------------------------------------
alter table public.projects1_orders
  add column if not exists pricing_config_id uuid;

alter table public.projects1_orders
  add column if not exists pricing_version integer;

alter table public.projects1_orders
  add column if not exists hourly_rate_snapshot numeric(10, 2);

alter table public.projects1_orders
  add column if not exists pricing_snapshot jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'projects1_orders_pricing_config_fk'
      and conrelid = 'public.projects1_orders'::regclass
  ) then
    alter table public.projects1_orders
      add constraint projects1_orders_pricing_config_fk
      foreign key (pricing_config_id)
      references public.projects1_pricing_config (id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'projects1_orders_pricing_version_positive'
      and conrelid = 'public.projects1_orders'::regclass
  ) then
    alter table public.projects1_orders
      add constraint projects1_orders_pricing_version_positive
      check (pricing_version is null or pricing_version >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'projects1_orders_hourly_rate_snapshot_positive'
      and conrelid = 'public.projects1_orders'::regclass
  ) then
    alter table public.projects1_orders
      add constraint projects1_orders_hourly_rate_snapshot_positive
      check (hourly_rate_snapshot is null or hourly_rate_snapshot > 0);
  end if;
end $$;

create index if not exists projects1_orders_pricing_config_id_idx
  on public.projects1_orders (pricing_config_id)
  where pricing_config_id is not null;

create index if not exists projects1_orders_pricing_version_idx
  on public.projects1_orders (pricing_version)
  where pricing_version is not null;

comment on column public.projects1_orders.pricing_config_id is
  'FK to pricing revision used at submit time (immutable snapshot reference). Null for pre-3B.2 orders.';
comment on column public.projects1_orders.pricing_version is
  'Copy of projects1_pricing_config.version at submit; used for audits and preview mismatch debugging.';
comment on column public.projects1_orders.hourly_rate_snapshot is
  'Cleaning hourly rate frozen at submit; null for non-cleaning / pre-3B.2.';
comment on column public.projects1_orders.pricing_snapshot is
  'JSON breakdown frozen at submit, e.g. {rooms,hours,workers,rate,massageMinutes,mode,priceEuro}.';

-- -----------------------------------------------------------------------------
-- 7) Privileges + RLS
--    Strip inherited/table-level UPDATE first, then grant only draft-safe columns.
--    Lifecycle columns status / activated_at / archived_at stay non-updatable
--    for service_role (publish only via SECURITY DEFINER activate).
-- -----------------------------------------------------------------------------
revoke all privileges on table public.projects1_pricing_config
  from service_role, anon, authenticated, public;
revoke all privileges on table public.projects1_cleaning_room_plans
  from service_role, anon, authenticated, public;
revoke all privileges on table public.projects1_massage_prices
  from service_role, anon, authenticated, public;

revoke select, insert, update, delete, truncate, references, trigger
  on table public.projects1_pricing_config
  from service_role, anon, authenticated, public;

revoke select, insert, update, delete, truncate, references, trigger
  on table public.projects1_cleaning_room_plans
  from service_role, anon, authenticated, public;

revoke select, insert, update, delete, truncate, references, trigger
  on table public.projects1_massage_prices
  from service_role, anon, authenticated, public;

grant select, insert, delete on table public.projects1_pricing_config to service_role;
grant update (
  cleaning_hourly_rate_euro,
  note,
  created_by,
  version
) on table public.projects1_pricing_config to service_role;

-- Explicit deny on lifecycle columns even if a broader UPDATE is re-granted later.
revoke update (status, activated_at, archived_at, id, created_at)
  on table public.projects1_pricing_config
  from service_role;

grant select, insert, update, delete on table public.projects1_cleaning_room_plans to service_role;
grant select, insert, update, delete on table public.projects1_massage_prices to service_role;

alter table public.projects1_pricing_config enable row level security;
alter table public.projects1_cleaning_room_plans enable row level security;
alter table public.projects1_massage_prices enable row level security;

drop policy if exists "projects1_pricing_config_restrict_anon"
  on public.projects1_pricing_config;
drop policy if exists "projects1_pricing_config_restrict_authenticated"
  on public.projects1_pricing_config;

create policy "projects1_pricing_config_restrict_anon"
  on public.projects1_pricing_config
  as restrictive
  for all
  to anon
  using (false)
  with check (false);

create policy "projects1_pricing_config_restrict_authenticated"
  on public.projects1_pricing_config
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "projects1_cleaning_room_plans_restrict_anon"
  on public.projects1_cleaning_room_plans;
drop policy if exists "projects1_cleaning_room_plans_restrict_authenticated"
  on public.projects1_cleaning_room_plans;

create policy "projects1_cleaning_room_plans_restrict_anon"
  on public.projects1_cleaning_room_plans
  as restrictive
  for all
  to anon
  using (false)
  with check (false);

create policy "projects1_cleaning_room_plans_restrict_authenticated"
  on public.projects1_cleaning_room_plans
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "projects1_massage_prices_restrict_anon"
  on public.projects1_massage_prices;
drop policy if exists "projects1_massage_prices_restrict_authenticated"
  on public.projects1_massage_prices;

create policy "projects1_massage_prices_restrict_anon"
  on public.projects1_massage_prices
  as restrictive
  for all
  to anon
  using (false)
  with check (false);

create policy "projects1_massage_prices_restrict_authenticated"
  on public.projects1_massage_prices
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

-- -----------------------------------------------------------------------------
-- 8) Verification (read-only) — after apply; requires real PostgreSQL
-- -----------------------------------------------------------------------------
-- select version, status, cleaning_hourly_rate_euro
-- from public.projects1_pricing_config where status = 'active';
-- Expected rate 20; cleaning totals 40/60/160/200/360/360; massage 45/67.50/90.
--
-- As service_role (must fail — no privilege on status):
--   update public.projects1_pricing_config set status = 'active' where status = 'draft';
--
-- Incomplete draft activate (must fail validation):
--   select public.projects1_activate_pricing_config('<incomplete-draft-uuid>');

commit;
