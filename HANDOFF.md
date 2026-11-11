# HAVENLY — HANDOFF

Дата: 2026-11-11

## Сделано

- Premium redesign + massage catalog (локальные commits).
- SQL-миграция Premium Booking Wizard **применена** в Production Supabase.
- Backup: `C:\backups\havenly\supabase-full-20261111-192627.sql` (1 заказ на момент снятия).
- Telegram: новый `TOKEN_TELEGRAM` проверен через `getMe`; Vercel Production redeploy Ready.
- **Premium Booking Wizard (код):**
  - `lib/booking-pricing.ts` — общие цены/слоты
  - `POST /api/order` — серверные цены, `order_ref`, адрес, время, quote для repair
  - `POST /api/order/photos` — private upload в `repair-order-photos`
  - UI: `components/booking-wizard.tsx` (шаги configure → schedule → address → contact → review)

## Работает

- Лендинг + пошаговое бронирование (локально после `npm run dev`).
- Заказы в Supabase через `service_role`.
- Telegram notify (после обновления токена на Vercel).

## Пока только локально (код wizard)

- Booking wizard / серверные цены / photos API — **нужен commit + deploy**, иначе Production Vercel ещё на старом `/api/order`.
- Не пушить без явного решения.

## Production Supabase

- Миграция применена: `pricing_mode`, `order_ref`, адрес, слоты, Storage bucket.
- Production Vercel пока может быть на старом коде заказа. Деплой wizard+API делать **одним** релизом (UI и `/api/order` вместе).

## Следующие шаги

1. Локальный smoke: Cleaning / Massage / Repair quote (+ фото).
2. Commit безопасных файлов (без `.env*`).
3. Deploy Vercel (после подтверждения).
4. Один Production smoke-заказ.

## Запреты без согласования

- Не push/deploy/SQL без «ок».
- Не коммитить `.env*` и бэкапы с ПДн.
