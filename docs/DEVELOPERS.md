# whileaway for developers

Your agent **pushes** cards to a **lane**; whileaway **delivers** the single best card per moment to
whatever surface is reading. Your feed is an API, not an app — every surface is a thin client of one
endpoint, `GET /v1/feed/next` (full contract: [`FEED-CLIENTS.md`](FEED-CLIENTS.md)).

## Self-host

It's just Node; your feed lives entirely on your machine.

```bash
cd server
npm install
npm start            # seeds starter lanes, prints your key, runs reference pushers
curl localhost:4000/health
```

Load the extension at `chrome://extensions` → Developer mode → Load unpacked → `extension/`, point
its backend at `http://localhost:4000`, and send a prompt in an AI chat. No install? Open
`extension/demo.html?base=http://localhost:4000`. Full hosted deploy (Fly, SQLite, custom domain,
email): [`DEPLOY.md`](DEPLOY.md).

## Connect an agent (MCP)

`whileaway-mcp` (npm) is a stdio MCP server exposing `push_card` / `push_deck` / `create_lane` /
`list_lanes` / `get_history` / `get_feed_status`.

```bash
claude mcp add whileaway \
  -e WHILEAWAY_URL=http://localhost:4000 \
  -e WHILEAWAY_TOKEN=<your-key> \
  -- npx -y whileaway-mcp
```

Tool descriptions carry the delivery semantics, so a one-sentence recipe becomes the right
`push_deck` call with no scheduling on your side.

## Model

- **Lane** — a named division of your feed you own (`private` / `unlisted` / `public`).
- **Card** — pushed to a lane, with delivery semantics: `priority`, `expires_at`, `repeat`
  (`once` | `recurring` + cooldown/max), `dedupe_key` (re-push upserts in place), and `class`
  (`ambient` shows once; `must_see` re-surfaces until seen).
- **Delivery engine** — drops expired, honors repeat/cooldown, dedupes, ranks by
  class + priority + recency, and round-robins across lanes so none floods you.
- **Starter lanes** (Wikipedia, Hacker News, RSS) — optional public lanes, auto-subscribed so a new
  feed is alive immediately, filled by reference pushers in [`../server/clients/`](../server/clients).

## API

Consumer (identity via bearer token, or `X-Whileaway-User` header when self-hosting):

| method | path | purpose |
|--------|------|---------|
| GET | `/v1/feed/next` | deliver the next card, or `204` |
| GET | `/v1/feed/peek` | preview the next card (non-consuming) |
| POST | `/v1/feed/seen` | `{ id }` → mark seen |
| GET | `/v1/feed/history?limit=` | recently seen cards |
| GET | `/v1/lanes` | lanes you can see, with subscribe/mute state |
| POST | `/v1/subscriptions` | `{ laneId, action }` — subscribe / unsubscribe / mute / unmute |
| GET | `/v1/lanes/:id/feed.xml` | a lane as an RSS/Atom feed |

Producer (`Authorization: Bearer <token>`, scoped to lanes you own):

| method | path | purpose |
|--------|------|---------|
| POST | `/v1/lanes` | create/update a lane |
| POST | `/v1/lanes/:id/cards` | push a card |
| POST | `/v1/tokens` | (session) mint a bearer token; `/v1/keys` mints another for the same owner |

```bash
curl -X POST localhost:4000/v1/lanes/personal/cards \
  -H "Authorization: Bearer $WHILEAWAY_KEY" -H "Content-Type: application/json" \
  -d '{"title":"Standup in 10 min","body":"Daily · Google Meet","kind":"calendar",
       "delivery":{"class":"must_see","priority":90}}'
```

## Architecture

```
                       hosted: whileaway.honestapp.org        self-host: localhost:4000
┌─────────────┐  MCP (stdio)  ┌──────────────────────────────────────────┐
│ Claude/agent│──────────────▶│  whileaway-mcp  ──HTTP──▶  server (Express)│
└─────────────┘   push_card   └──────────────────────────────────────────┘
                                     ▲                        │
┌─────────────┐  GET /v1/feed/next   │        SQLite (hosted) │ JSON file (self-host)
│ any surface │──────────────────────┘
└─────────────┘  overlay · new-tab · dashboard · RSS · your own
```

`server/` (delivery engine + HTTP API) · `mcp/` (the MCP server) · `extension/` (MV3: overlay +
new-tab + popup) · `server/public/` (landing + connect page).

## Contributing

A new reference pusher is the easiest start — one file in `server/clients/sources/`. Keep the
privacy invariant intact: the server never fetches page content, and only the owner can publish to
a feed.

## License

[Apache-2.0](../LICENSE) © whileaway contributors.
