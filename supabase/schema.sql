-- Черновик схемы под текущую модель агента.
-- Не подключать в рантайм, пока не начата интеграция Supabase (см. ROADMAP.md → Дальше).

create table if not exists agent_config (
  id smallint primary key default 1 check (id = 1),
  prompt text not null,
  model text not null,
  updated_at timestamptz not null default now()
);

create table if not exists chat_histories (
  chat_id text primary key,
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint chat_histories_id_format check (
    chat_id ~ '^-?[0-9]+$'
    or chat_id ~* '^web-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
);

comment on table agent_config is 'Единственная строка: системный промпт и модель';
comment on table chat_histories is 'История диалога; в messages хранится массив {role, content}, в приложении обрезается до 20';
