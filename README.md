# World Chess

A lightweight browser chess platform for public, no-login play.

## Features

- Complete chess rule enforcement: legal moves, check, checkmate, stalemate, castling, en passant, and promotion.
- Friend-link multiplayer with server-side move validation.
- Stockfish-powered AI opponent with easy, medium, and hard difficulty levels.
- 5 minute, 10 minute, 30 minute, and unlimited formats.
- White, black, or random side selection.
- Board themes, legal-move highlighting, and responsive touch-friendly controls.
- Local game restore for AI games.

## Run Locally

If `npm` is installed:

```powershell
npm start
```

If Windows says `npm` is not recognized, run the included launcher:

```cmd
start.bat
```

Or run Node directly:

```cmd
node server.js
```

Open:

```text
http://localhost:3000
```

## Hosting

This project has no external dependencies. Any host that can run a small Node server can host it. Free-friendly options include Render, Railway, Fly.io, and a low-traffic VPS. The friend-link mode needs the Node server because rooms and moves are validated through `/api/rooms`.

For a public launch, point a domain at the hosted server and submit the site to search engines. No account system or paid service is required by the code.

### Vercel Multiplayer Persistence

If deploying to Vercel serverless functions, use a durable KV store so friend rooms survive across invocations and regions.

Set these environment variables in Vercel:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

If your Vercel KV/Upstash project exposes the older names, these are also supported:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Optional tuning variables:

- `ROOM_TTL_SECONDS` (default `172800`, 2 days)
- `ROOM_LOCK_TTL_MS` (default `4000`)
- `ROOM_LOCK_WAIT_MS` (default `2500`)

## AI Engine

The browser loads Stockfish from the free cdnjs CDN and asks it for UCI best moves. Every Stockfish move is still validated by the local legal-move engine before it is applied. If Stockfish cannot load, the game falls back to the smaller built-in AI so play can continue.

Stockfish is GPL-3.0 licensed, so this project metadata uses GPL-3.0 as well.
