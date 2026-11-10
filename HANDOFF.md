# HAVENLY — HANDOFF (продолжение завтра)

Дата чекпоинта: 2026-11-10  
Локальный commit: `checkpoint: HAVENLY premium redesign and booking migration preparation`  
Ветка: `main` (только локально впереди origin; **push не делался**)

## Что сделано сегодня

- Premium-редизайн лендинга HAVENLY (типографика, hero, атмосфера, стили `havenly.css` / layout).
- Каталог Massage без силуэта/hotspots: `lib/massage-catalog.ts`, `components/massage-catalog-view.tsx`, фото `public/images/massage-*.jpg`.
- Обновлены service images / hero; правки hotspot gallery и service detail под новый UX.
- Подготовлена **финальная** SQL-миграция Premium Booking Wizard:  
  `supabase/safe_booking_wizard_migration.sql`  
  (одна транзакция `BEGIN`…`COMMIT`, точная проверка legacy `projects1_orders_price_check`, quote/fixed pricing, RLS, private Storage bucket).

## Что уже работает (локально / текущий код)

- Лендинг, калькулятор/заказ через существующий `POST /api/order`.
- Каталог Massage и навигация по услугам в UI.
- Telegram-уведомления админу и агент/чат — без изменений контракта на сегодняшнем чекпоинте.
- TypeScript (`tsc --noEmit`) и `npm run build` — успешно на момент чекпоинта.

## Что пока только локально (не на remote / не в Production)

- Весь сегодняшний UI + миграционный SQL-файл — в локальных commits, **не запушены**.
- Deploy на Vercel **не выполнялся**.
- Production Supabase **не менялась**.

## Что ещё не применено в Supabase

- `supabase/safe_booking_wizard_migration.sql` — **не запускалась**.
- Новые колонки wizard (`order_ref`, адрес, `preferred_time`, `pricing_mode`, quote, Storage policies и т.д.) в Production ещё нет.
- Пользователь отдельно экспортировал `projects1_orders` (CSV/SQL); полный `pg_dump` БД — по инструкции, если ещё не снят.

## Что не опубликовано на Vercel

- Premium redesign / massage catalog / любые связанные фронтовые правки.
- Любые будущие API-изменения под wizard (их ещё нет в коде заказа).

## Секреты и бэкапы (не в git)

- `.env.local`, токены, ключи Supabase/Telegram — в `.gitignore`, в commit не входили.
- Истории чатов `data/chats`, `.vercel`, `node_modules` — игнорируются.
- Резервные копии БД держать вне репозитория (например `C:\backups\havenly\`), не коммитить.

## Следующие шаги (завтра)

1. **Backup** — полный `pg_dump` через Session pooler (если ещё нет), плюс уже сделанный экспорт `projects1_orders`.
2. **SQL migration** — вручную в Supabase SQL Editor: `safe_booking_wizard_migration.sql`, затем read-only проверки.
3. **API** — расширить `POST /api/order` / `lib/orders.ts` под wizard-поля, server-side цены, quote для Repair, `order_ref`, загрузку фото в private bucket.
4. **Booking wizard** — UI шагов (слоты 09–19 / 30 мин, адрес, massage category, repair description/photos).
5. **Testing** — локально + smoke Production после миграции; только потом push/deploy по отдельному решению.

## Запреты на старте завтрашнего дня (пока не согласовано)

- Не push / не deploy / не SQL на Production без явного «ок».
- Не затирать `data/agent.json` дефолтом.
- Не коммитить `.env*` и бэкапы с ПДн клиентов.
