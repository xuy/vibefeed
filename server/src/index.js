// vibefeed bus — HTTP API. Two surfaces:
//   • Producer (auth via publisher key): create channels, push items.
//   • Consumer (a user identity; open by default for local self-host): pull the feed, manage
//     subscriptions, browse the channel directory.
import express from "express";
import * as bus from "./bus.js";
import { bootstrap, LOCAL_USER } from "./bootstrap.js";
import { startPushers } from "../clients/runner.js";

const app = express();
app.use(express.json({ limit: "256kb" }));

const PORT = process.env.PORT || 4000;

app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Vibefeed-User");
  res.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Consumer identity. Local-first: defaults to the single "local" user. A hosted deployment
// would resolve a real user from a session/token here instead.
function user(req) { return req.get("X-Vibefeed-User") || req.query.user || LOCAL_USER; }

// Producer auth: a valid publisher key resolves to its owner; routes check channel ownership.
function publisher(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.get("Authorization") || "");
  const ownerId = bus.ownerForKey(m && m[1]);
  if (!ownerId) return res.status(401).json({ error: "invalid or missing publisher key" });
  req.ownerId = ownerId;
  next();
}

function wrap(fn) {
  return (req, res) => {
    try { const out = fn(req, res); if (out !== undefined) res.json(out); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  };
}

// ---- health + client display config --------------------------------------
app.get("/health", (req, res) => res.json({ ok: true, ...bus.stats(user(req)) }));
app.get("/v1/feed/config", (_req, res) => res.json(bus.CONFIG));

// ---- consumer: feed ------------------------------------------------------
app.get("/v1/feed/next", wrap((req, res) => {
  const item = bus.next(user(req));
  if (!item) return void res.status(204).end();
  res.json(item);
}));
app.post("/v1/feed/seen", wrap((req) => bus.markSeen(user(req), (req.body || {}).id || (req.body || {}).itemId)));
app.get("/v1/feed/history", wrap((req) => ({ items: bus.history(user(req), Number(req.query.limit) || 50) })));

// ---- consumer: channels + subscriptions (directory) ----------------------
app.get("/v1/channels", wrap((req) => ({ channels: bus.listChannels(user(req)) })));
app.post("/v1/subscriptions", wrap((req) => {
  const u = user(req); const { channelId, action } = req.body || {};
  if (action === "unsubscribe") return { channels: bus.unsubscribe(u, channelId) };
  if (action === "mute") return { channels: bus.setMuted(u, channelId, true) };
  if (action === "unmute") return { channels: bus.setMuted(u, channelId, false) };
  return { channels: bus.subscribe(u, channelId) };
}));

// ---- producer: channels + item push --------------------------------------
app.post("/v1/channels", publisher, wrap((req) => ({ channel: bus.createChannel(req.body || {}, req.ownerId) })));
app.get("/v1/channels/:id", wrap((req) => {
  const c = bus.getChannel(req.params.id);
  if (!c) { const e = new Error("not found"); e.status = 404; throw e; }
  return { channel: { id: c.id, title: c.title, description: c.description, accent: c.accent, kind: c.kind, visibility: c.visibility } };
}));
app.post("/v1/channels/:id/items", publisher, wrap((req) => {
  const { item, deduped } = bus.pushItem(req.params.id, req.body || {}, req.ownerId);
  return { id: item.id, deduped };
}));
// Convenience: mint an additional publisher key for the authenticated owner.
app.post("/v1/keys", publisher, wrap((req) => ({ key: bus.mintKey(req.ownerId, (req.body || {}).label || "") })));

// ---- boot ----------------------------------------------------------------
bus.init();
const { key } = bootstrap();
app.listen(PORT, () => {
  console.log(`[vibefeed] bus on http://localhost:${PORT}`);
  console.log(`[vibefeed] default publisher key: ${key}${process.env.VIBEFEED_KEY ? "" : "  (ephemeral — set VIBEFEED_KEY to persist)"}`);
  if (process.env.RUN_DEFAULT_PUSHERS !== "0") {
    startPushers(`http://localhost:${PORT}`, key).catch((e) => console.warn("[vibefeed] pushers:", e.message));
  }
});
