# Дорожная карта

Планирование развития веб-чата, Telegram-бота и агента.

## Сейчас

- Уточнить зоны выезда в `projects1_services` (по необходимости)
- Миграция существующих `data/chats` в `projects1_chat_histories` (по необходимости)

## Дальше

- Auth / защита админки через Supabase (вместо текущего cookie-логина)
- Аналитика диалогов и статусы заявок на уборку / ремонт / массаж (`projects1_orders`)
- Мультитенантность или несколько ботов на одном проекте

## Заказы (калькулятор → Supabase)

1. В SQL Editor выполнить `supabase/orders.sql` (таблица `projects1_orders`).
2. Env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (+ Telegram для уведомлений).
3. API `POST /api/order` пишет в Supabase, затем шлёт уведомление админу. Нужен серверный деплой (Vercel / Netlify Next runtime), не static Drop.

## Позже

- _(пока пусто)_

## Готово

- Веб-чат и Telegram с общей моделью и историей
- Админка промпта/модели (`/admin`)
- Файловое хранилище + опциональный Redis (Upstash)
- Пролонгирование диалога через системный промпт
- Интерфейс `AgentStoreBackend` и бэкенды Supabase / Redis / file
- SQL-схема `projects1_*`, клиент `@supabase/supabase-js`
- Каталог услуг `projects1_services` (клининг, мелкий ремонт, массаж) в промпте агента
- Telegram: редактируемое меню после `/start`, ephemeral-ответы под меню
