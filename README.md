# TETRIS

Cross-platform web Tetris built for phones, tablets, and laptops, powered by **Cloudflare Workers**, **Static Assets**, and **Durable Objects (SQLite)**.

- **Worker URL:** `https://tetrisweb.johansans999.workers.dev`

## Controls

| Action | Keyboard | Touch / Mouse |
| :--- | :--- | :--- |
| Move Left / Right | `A` / `D` | Drag horizontally |
| Rotate | `W` | Tap screen |
| Soft Drop | `S` | Drag down |
| Hard Drop (Slam) | `Space` | Fast swipe down |
| Hold Piece | `E` | Right-click / Tap Hold box |
| Pause / Resume | `Esc` / `P` | Top-left Pause button |

## Local Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dev:worker
```

For Vite hot reload alongside the local Worker API:

```bash
# Terminal 1
npm run dev:worker

# Terminal 2
npm run dev
```

## Deploy to Cloudflare Workers

### Option A — Cloudflare Workers Git Integration (GitHub)
Connect `https://github.com/GladstoneOG/tetrisweb` to your `tetrisweb` Worker in the Cloudflare Dashboard with:
- **Build command:** `npm run build`
- **Deploy command:** `npx wrangler deploy`

### Option B — CLI Deploy
```bash
npx wrangler login
npm run deploy
```

`wrangler.toml` provisions the `LEADERBOARD_DO` Durable Object (`LeaderboardDO`) using SQLite (`new_sqlite_classes = ["LeaderboardDO"]`) alongside `./dist` static assets.

## Asset Credits

Open-licensed audio tracks and sound effects are documented in [`public/assets/CREDITS.md`](public/assets/CREDITS.md).
