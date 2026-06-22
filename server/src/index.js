// vibefeed backend — serves ambient feed items to the browser extension.
//
// Auth: optional. Set FEED_TOKEN to require `Authorization: Bearer <token>` (or ?key=) on the
// feed endpoints — handy once this is on the public internet. Left unset for local play.
import express from "express";
import * as feed from "./feed.js";

const app = express();
app.use(express.json({ limit: "256kb" }));

const PORT = process.env.PORT || 4000;
const TOKEN = process.env.FEED_TOKEN || null;

// Permissive CORS: the extension popup (an extension-origin page) and any dashboard can call
// this directly. Content scripts go through the service worker, but this keeps everything simple.
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function auth(req, res, next) {
  if (!TOKEN) return next();
  const hdr = req.get("Authorization") || "";
  const bearer = /^Bearer (.+)$/.exec(hdr);
  const key = (bearer && bearer[1]) || req.query.key;
  if (key === TOKEN) return next();
  return res.status(401).json({ error: "unauthorized" });
}

app.get("/health", (_req, res) => res.json({ ok: true, ...feed.stats() }));

// Runtime config the extension fetches and caches (delivery timings).
app.get("/feed/config", auth, (_req, res) => res.json(feed.CONFIG));

// The core endpoint: next item to surface, or 204 when the queue is momentarily empty.
app.get("/feed/next", auth, async (_req, res) => {
  try {
    const item = await feed.next();
    if (!item) return res.status(204).end();
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// Mark an item as seen → moves it into history and stops it re-appearing.
app.post("/feed/seen", auth, (req, res) => {
  feed.markSeen(req.body || {});
  res.json({ ok: true });
});

app.get("/feed/history", auth, (req, res) => {
  res.json({ items: feed.history(Number(req.query.limit) || 50) });
});

// Source management (personalization).
app.get("/feed/sources", auth, (_req, res) => res.json({ sources: feed.sources() }));
app.post("/feed/sources", auth, (req, res) => res.json({ sources: feed.setSources(req.body || {}) }));

// Update RSS feed URLs / subreddits.
app.post("/feed/config", auth, (req, res) => res.json(feed.setConfig(req.body || {})));

// Force a refill (useful while testing).
app.post("/feed/refill", auth, async (_req, res) => {
  await feed.refill();
  res.json(feed.stats());
});

feed.start();
app.listen(PORT, () => {
  console.log(`[vibefeed] backend on http://localhost:${PORT}  (auth: ${TOKEN ? "on" : "off"})`);
});
