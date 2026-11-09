<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Правила проекта

Локальный ИИ-агент: веб-чат и Telegram говорят с одной моделью и одним хранилищем. Интерфейс и тексты для пользователя — на русском.

## Стек

- Next.js 16 (App Router), React 19, TypeScript `strict`, алиас `@/*` → корень репозитория.
- Веб: лендинг HAVENLY — `app/page.tsx` + `app/havenly.css`; чат агента — `/chat`. Стили чата/админки — `app/globals.css`.
- Telegram: обработчики в `bot/telegram.ts`, редактируемое меню в `bot/menu.ts`. После `/start` одно меню обновляется по inline-кнопкам; ответы агента — временные сообщения и удаляются при клике по меню. Локально polling стартует из `instrumentation.ts`. На Vercel — webhook `POST /api/telegram`. Заказы с лендинга: `POST /api/order` → уведомление админу (`TELEGRAM_ADMIN_CHAT_ID`, токен `TOKEN_TELEGRAM`).
- Модель: `lib/openai-agent.ts`, Chat Completions, ключ `API_GPT`.
- Состояние: `lib/agent-store/` (интерфейс + бэкенды Supabase / Redis / file). При наличии `NEXT_PUBLIC_SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` используется Supabase (`projects1_agent_config`, `projects1_chat_histories`, `projects1_services`). Иначе Redis, иначе файлы `data/`. Каталог услуг подмешивается в system-промпт. Серверный клиент — `lib/supabase/server.ts`.
- Перед незнакомым API Next.js читай `node_modules/next/dist/docs/` и предупреждения об устаревших методах. Блок `nextjs-agent-rules` выше не удаляй.

Команды: `npm run dev` (веб и локальный polling бота), `npm run web`, `npm run bot`, `npm run lint`, `npm run build` (серверный билд для Vercel), `npm run build:static` (папка `out` без API).

## Как устроен ответ

Бот и `app/api/chat/route.ts` делают одно и то же: читают конфиг и историю, вызывают `askAgent`, дописывают реплики пользователя и ассистента, сохраняют историю. Новый канал подключай через эти функции, а не копией хранилища или запроса к OpenAI.

Конфиг из админки (`/admin` → `POST /api/agent`) действует со следующего сообщения. Рестарт бота для смены промпта или модели не нужен.

Модель — только значение из `MODELS`. Промпт обрезается до 8000 символов. Текст сообщения — до 4000. Ответ в Telegram уходит частями по 4000 символов.

Идентификатор чата — целое число Telegram или `web-<uuid>`. Веб-сессия лежит в `localStorage` под ключом `web-agent-session`.

JSON пиши через временный файл и `rename`. Ошибку пользователю отдавай короткой русской фразой, без стека, ключей и тела ответа провайдера.

## Пролонгирование

Диалог продолжается, пока пользователь сам его не закрыл.

- В системном промпте (`data/agent.json`) после полезного ответа остаётся один конкретный следующий шаг или один уточняющий вопрос: расчёт, адрес, тип уборки, дата, слот или продление действующего договора. Пачку вопросов не задаём. Фразу «если что, пишите» не используем.
- Если пользователь прощается или просит только один факт, отвечай по сути и останавливайся.
- Код пролонгирование не хардкодит. Правила диалога живут в промпте. Сохранённый `data/agent.json` не затирай дефолтом из `DEFAULT_CONFIG`.
- Контекст для модели: текущий system-промпт и последние 20 реплик. Обрезка истории — только `slice(-20)` в `lib/agent-store.ts`, одинаково для веба и Telegram.
- Сброс истории — команда `/reset` в боте и «Новый диалог» в вебе (`DELETE /api/chat`). Сам по себе новый запрос историю не чистит.

## Обязательное

- `API_GPT` и `TOKEN_TELEGRAM` только в `.env.local`. На клиент, в логи и в git они не попадают. В репозитории не храни `.env*` и `data/chats`.
- Локально бот: `deleteWebhook({ drop_pending_updates: false })`, затем long polling внутри процесса Next.js. На Vercel тот же бот принимает webhook на `/api/telegram`.
- Интерактивные экраны — клиентские компоненты. Секреты и файлы `data/` остаются на сервере.
- После правки UI проверь в браузере сценарий целиком: главная (загрузка истории, отправка, ошибка, новый диалог) и `/admin` (загрузка и сохранение). Общее состояние должно совпадать: промпт и модель из админки видны и боту, и вебу.
- Правь существующие модули точечно. Комментарии добавляй только там, где без них неочевиден инвариант (лимит истории, атомарная запись, polling).
