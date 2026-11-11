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
- **Booking security hardening (код, до Production deploy):**
  - Upstash Redis rate limit: order **10 / 10 мин / IP**, photos **30 / 10 мин / IP**, draft **30 / 10 мин / IP**
  - Cloudflare Turnstile на `/api/order` и `/api/order/photos` (+ виджет в wizard)
  - HMAC draft: `POST /api/order/draft` → `draftToken`; фото привязаны к draft (max **5**, magic bytes)
  - `Idempotency-Key` на submit (Redis NX, 24ч)
  - Cron: `GET/POST /api/cron/cleanup-repair-photos` daily `0 3 * * *` (`vercel.json`, Hobby) + lazy cleanup при draft/upload/order
  - Env: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `BOOKING_DRAFT_SECRET`, `CRON_SECRET`

## Работает

- Лендинг + пошаговое бронирование (локально после `npm run dev`).
- Заказы в Supabase через `service_role`.
- Telegram notify (после обновления токена на Vercel).
- Home Repairs: после save заказа админу уходит текст + до 5 фото из private `repair-order-photos` через Bot API (`sendMediaGroup`, без публичных URL).

## Пока только локально (wizard + security)

- Booking wizard / security API — **нужен commit + deploy одним релизом**, иначе Production на старом `/api/order`.
- Не пушить без явного решения.

## Ключи перед Preview/Production

| Переменная | Где |
|---|---|
| `UPSTASH_REDIS_REST_URL` / `TOKEN` | уже на Vercel |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile widget |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile server |
| `BOOKING_DRAFT_SECRET` | ≥32 random bytes |
| `CRON_SECRET` | Bearer для cron; Vercel подставит `Authorization` автоматически |

Local без Turnstile/BOOKING_DRAFT_SECRET: тестовые always-pass ключи CF + local draft secret.  
Local без Upstash: in-memory fallback для draft photos / idempotency (только off-Vercel).  
На `VERCEL=1` без Redis/Turnstile/secret — fail-closed.

## Production Supabase

- Миграция применена: `pricing_mode`, `order_ref`, адрес, слоты, Storage bucket.
- Деплой wizard+security API делать **одним** релизом.

## Следующие шаги

1. Задать Turnstile + `BOOKING_DRAFT_SECRET` + `CRON_SECRET` в Vercel Preview/Production.
2. Commit безопасных файлов (без `.env*`).
3. Preview smoke, затем Production deploy (после подтверждения).
4. Один Production smoke-заказ (не спамить).

## Запреты без согласования

- Не push/deploy/SQL без «ок».
- Не коммитить `.env*` и бэкапы с ПДн.
