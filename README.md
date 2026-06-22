# vibefeed

While the AI thinks, skim **one useful thing**. vibefeed is a Chrome extension + backend that
shows a small card in the corner of ChatGPT / Claude / Perplexity / Gemini / etc. *the moment you
send a prompt* — surfacing an item from **your** feed instead of an ad:

- 📅 a calendar invite, ✉️ an unread-email summary, 🔔 a reminder *(mock connectors today)*
- 📰 an RSS article you subscribed to
- 🟧 a Hacker News story
- 📖 a random Wikipedia article to skim
- 🔶 customizable subreddits *(best-effort — Reddit 403s many IPs)*

It's the "you wait → here's something for you" pattern, rebuilt around ambient personal info.
Missing a card is fine by design — it's a glanceable feed, not a notification you must act on.

### What it deliberately does **not** do
No reading of your prompt, the AI's answer, page text, links, or citations. The content script
only detects *that a generation started* (form submit / Enter / send-button click / the AI's own
"stop" button appearing) and then asks the backend for the next feed item. Nothing about the page
leaves your browser.

```
vibefeed/
├── server/         Node + Express backend (the feed queue + content sources)
│   └── src/sources/  wikipedia · hackernews · rss · reddit · mock(personal)
└── extension/      MV3 Chrome extension (content script · service-worker proxy · popup)
```

## 1. Run the backend (local)

```bash
cd server
npm install
npm start          # → http://localhost:4000   (npm run dev for --watch)
```

Check it: `curl localhost:4000/health` — you should see a warmed `queue`.

Config via env (all optional):
| var | meaning |
|-----|---------|
| `PORT` | listen port (default 4000) |
| `FEED_TOKEN` | if set, feed endpoints require `Authorization: Bearer <token>` |
| `FEED_RSS` | comma-separated RSS feed URLs |
| `FEED_SUBREDDITS` | comma-separated subreddits |
| `FEED_STATE` | path for the persisted seen/history JSON |

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

## 2. Load the extension

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `extension/`.
2. Click the vibefeed icon. The popup shows backend status, source toggles, a **live card
   preview**, recent history, and a **Show on this tab** test button.
3. Open ChatGPT/Claude/etc., send a prompt → a card appears bottom-right while it generates.
   (Reload the AI tab once after first install so the content script is injected.)

`extension/src/config.js` sets the backend URL (`dev` = localhost, `prod` = your Fly URL).
You can also override the base URL live from the popup's **Backend** field.

## 3. Deploy the backend (Fly.io, cheap/free-tier friendly)

```bash
cd server
fly launch --no-deploy                 # pick an app name; edit fly.toml's `app` to match
fly volumes create vibefeed_data --size 1 --region iad   # 1GB, just for state JSON
# optional auth:
fly secrets set FEED_TOKEN=$(openssl rand -hex 16)
fly deploy
```

Then set `prod.api` in `extension/src/config.js` (and `VF_ENV="prod"`) to your `https://<app>.fly.dev`,
or just paste the URL into the popup's Backend field. If you set `FEED_TOKEN`, paste it into the
popup's Token field too. With `auto_stop_machines`, an idle machine scales to zero — effectively free.

## Extending toward real connectors
The mock source (`server/src/sources/mock.js`) is the seam for the real product: replace it with
Google Calendar / Gmail connectors that return the same normalized item shape
(`{ id, source, sourceLabel, kind, title, body, imageUrl, url, author, ts }`) and everything
downstream — queue, dedup, delivery, UI — works unchanged. Per-user auth + subscription billing
would live alongside the existing optional `FEED_TOKEN`.
