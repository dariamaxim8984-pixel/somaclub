-- СОМА УТРО — бот: токены доступа и учёт участников Telegram.
-- Запусти ОДИН РАЗ в Supabase → SQL Editor (после utro_setup.sql).

-- 1) Персональный токен для диплинка в бота (кладётся в ссылку из письма и страницы «спасибо»).
alter table orders add column if not exists tg_token text;
create index if not exists orders_tg_token_idx on orders (tg_token);

-- 2) Участники клуба СОМА УТРО в Telegram.
create table if not exists utro_members (
  telegram_user_id  bigint primary key,
  telegram_username text,
  user_id           uuid,
  email             text,
  active            boolean not null default true,
  invited_at        timestamptz not null default now(),
  removed_at        timestamptz,
  reminded_until    timestamptz,          -- на какой paid_until уже отправлено напоминание
  updated_at        timestamptz not null default now()
);

-- Таблица служебная: с ней работают только бот и крон через service_role,
-- который обходит RLS. Включаем RLS без политик → для anon/authenticated закрыто.
alter table utro_members enable row level security;
