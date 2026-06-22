# vibefeed

**While the AI thinks, skim one useful thing.** vibefeed is an open-source Chrome extension +
tiny backend that shows a small card in the corner of ChatGPT / Claude / Perplexity / Gemini /
etc. *the moment you send a prompt* — surfacing an item from **your** feed instead of an ad.

![license](https://img.shields.io/badge/license-Apache--2.0-blue)
![backend](https://img.shields.io/badge/backend-Node%2020-3a86ff)
![extension](https://img.shields.io/badge/extension-MV3-7c6cff)

- 📰 an RSS article you subscribed to
- 🟧 a Hacker News story
- 📖 a random Wikipedia article to skim
- 📅 a calendar invite · ✉️ an unread-email summary · 🔔 a reminder *(mock connectors today — the seam for real ones)*
- 🔶 customizable subreddits *(best-effort — Reddit 403s many IPs)*

Missing a card is fine by design — it's a glanceable feed, not a notification you must act on.

## 🔒 Privacy first (this is the whole point)

vibefeed **never reads your prompt, the AI's answer, page text, links, or citations.** The
content script only detects *that a generation started* — a form submit, Enter, a send-button
click, or the AI's own "stop" button appearing — and then asks **your** backend for the next feed
item. Nothing about the page ever leaves your browser. There are no ads, no trackers, and no
account required.

## Local-first by design

You run the backend; the extension points at it. The popup's **Backend** field lets you choose
where to connect:

- **Your local server** — `http://localhost:4000` (the default in this repo)
- **Any server you host** — paste a URL (your VPS, Fly, Railway, Render, a Raspberry Pi…)
- *(later)* a hosted **vibefeed** service, for people who'd rather not run anything

Everything in this repo is the **free, open-source, self-hosted** version. No hosted service is
required and none is assumed.

```
vibefeed/
├── server/         Node + Express backend (the feed queue + content sources)
│   └── src/sources/  wikipedia · hackernews · rss · reddit · mock(personal)
├── extension/      MV3 Chrome extension (content script · service-worker proxy · popup)
└── LICENSE         Apache-2.0
```

## Quick start

### 1. Run the backend

```bash
cd server
cp .env.example .env       # optional — defaults work as-is
npm install
npm start                  # → http://localhost:4000   (npm run dev for --watch)
```

Sanity check: `curl localhost:4000/health` should show a warmed `queue`.

### 2. Load the extension

1. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `extension/`.
2. Click the vibefeed icon. The popup shows backend status, source toggles, a **live card
   preview**, recent history, and a **Show on this tab** test button. The **Backend** field is
   where you point it at your own server.
3. Open ChatGPT/Claude/etc., **reload the tab once** (so the content script injects), then send a
   prompt → a card appears bottom-right while it generates.

Prefer not to install anything? Open `extension/demo.html?base=http://localhost:4000` in any
browser to see the cards rendered live against your backend.

## Configuration

All env vars are optional (see `server/.env.example`):

| var | meaning |
|-----|---------|
| `PORT` | listen port (default 4000) |
| `FEED_TOKEN` | if set, `/feed/*` requires `Authorization: Bearer <token>` |
| `FEED_RSS` | comma-separated RSS feed URLs |
| `FEED_SUBREDDITS` | comma-separated subreddits |
| `FEED_STATE` | path for the persisted seen/history JSON |

Sources can also be toggled live from the popup or via the API.

### API

| method | path | purpose |
|--------|------|---------|
| GET | `/health` | status + queue stats |
| GET | `/feed/config` | delivery timings (cached by the extension) |
| GET | `/feed/next` | next item, or `204` if the queue is momentarily empty |
| POST | `/feed/seen` | mark an item seen → history, won't repeat |
| GET | `/feed/history?limit=` | recently delivered |
| GET/POST | `/feed/sources` | list / toggle sources |
| POST | `/feed/config` | set `feeds` (RSS) / `subs` (reddit) |
| POST | `/feed/refill` | force a pull (handy while testing) |

## Host it somewhere (optional)

Self-hosting is just Node — run it anywhere. A `Dockerfile` and `fly.toml` are included for
Fly.io (scales to zero when idle, so it's effectively free):

```bash
cd server
fly launch --no-deploy                                   # pick an app name; match it in fly.toml
fly volumes create vibefeed_data --size 1 --region iad   # 1GB, just for the state JSON
fly deploy
```

Then paste your `https://<app>.fly.dev` into the popup's **Backend** field. (`docker-compose`
and one-click deploy buttons are on the roadmap.)

## Adding real connectors

The mock source (`server/src/sources/mock.js`) is the seam for the real product. Drop in a
Google Calendar / Gmail connector that returns the same normalized item shape and everything
downstream — queue, dedup, delivery, UI — works unchanged:

```js
{ id, source, sourceLabel, kind, title, body, imageUrl, url, author, ts }
// kind ∈ 'article' | 'discussion' | 'calendar' | 'email' | 'note'
```

## Contributing

PRs welcome — new sources are the easiest place to start. Each source is a single file in
`server/src/sources/` exporting `meta` and `fetch_()`, returning the normalized shape above.
Add it to the registry in `server/src/feed.js` and it's live. Please run `node --check` on
changed files; keep the privacy stance intact (no reading of page content, ever).

## License

[Apache-2.0](./LICENSE) © vibefeed contributors.
