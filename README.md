# Kultroom

Совместный просмотр фильмов: React + TypeScript на клиенте, NestJS + Socket.IO на сервере.

## Запуск

```bash
npm ci
npm run dev
```

- сайт: http://127.0.0.1:5173
- API и WebSocket: http://127.0.0.1:8787

Production-режим собирает клиент и отдаёт сайт, API и WebSocket одним Nest-процессом на порту `8787`:

```bash
npm run build
npm start
```

Если домашний npm-кэш принадлежит root, запустите установку так:

```bash
npm_config_cache=/tmp/kultroom-npm-cache npm ci
```

До подключения Supabase фильмы сохраняются в `apps/api/data/movies.local.json`. Комнаты живут в памяти процесса и исчезают после перезапуска сервера. HLS-сегменты временно кэшируются в `apps/api/cache/media` и не коммитятся.

## Переменные окружения

- `PORT` — порт API, по умолчанию `8787`.
- `WEB_ORIGIN` — разрешённый origin сайта, по умолчанию `http://127.0.0.1:5173`.
- `MEDIA_CACHE_MAX_BYTES` — лимит временного кэша, по умолчанию 1.5 ГБ.
- `MEDIA_CACHE_TTL_MS` — срок хранения сегмента, по умолчанию 2 часа.
