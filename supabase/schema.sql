-- Таблицы агента с префиксом projects1_
-- Применять в SQL Editor Supabase или через DATABASE_URL.

create table if not exists projects1_agent_config (
  id smallint primary key default 1 check (id = 1),
  prompt text not null,
  model text not null,
  updated_at timestamptz not null default now()
);

create table if not exists projects1_chat_histories (
  chat_id text primary key,
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint projects1_chat_histories_id_format check (
    chat_id ~ '^-?[0-9]+$'
    or chat_id ~* '^web-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
);

create table if not exists projects1_services (
  id smallint primary key,
  slug text not null unique,
  title text not null,
  description text not null,
  price_note text not null default 'стоимость уточняется при расчёте',
  is_active boolean not null default true,
  sort_order smallint not null default 0,
  updated_at timestamptz not null default now()
);

comment on table projects1_agent_config is 'Единственная строка: системный промпт и модель';
comment on table projects1_chat_histories is 'История диалога; в messages хранится массив {role, content}, в приложении обрезается до 20';
comment on table projects1_services is 'Каталог услуг: клининг, мелкий ремонт, массаж';

create table if not exists projects1_bot_ui (
  chat_id text primary key,
  menu_message_id bigint,
  ephemeral_ids jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint projects1_bot_ui_chat_id_format check (
    chat_id ~ '^-?[0-9]+$'
  )
);

comment on table projects1_bot_ui is 'Telegram: id редактируемого меню и временных сообщений под ним';

grant select, insert, update, delete on table projects1_agent_config to service_role;
grant select, insert, update, delete on table projects1_chat_histories to service_role;
grant select, insert, update, delete on table projects1_services to service_role;
grant select, insert, update, delete on table projects1_bot_ui to service_role;
