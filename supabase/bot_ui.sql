-- Состояние Telegram-меню. Запустить в SQL Editor один раз.

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

grant select, insert, update, delete on table projects1_bot_ui to service_role;
