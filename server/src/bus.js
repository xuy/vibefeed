// The bus: channels, item push (with delivery semantics), subscriptions, and the delivery
// engine that decides the single best card to show a consumer right now. No external content
// is fetched here — items only ever arrive by being PUSHED to a channel. The default content
// you see exists because we own those channels and run reference pushers against this same API.
import crypto from "node:crypto";
import {
  db, save, load, deliveryKey, getSubs, pushItemRecord, findByDedupe, addHistory,
} from "./store.js";

// Display/delivery timings handed to the consumer client (not the per-item semantics).
export const CONFIG = { cooldownMs: 20000, minVisibleMs: 1500, displayMs: 11000 };

const KINDS = new Set(["article", "discussion", "calendar", "email", "note", "event"]);
const CLASSES = new Set(["ambient", "must_see"]);

// --- keys / auth -----------------------------------------------------------
export function hashKey(key) {
  return crypto.createHash("sha256").update(String(key)).digest("hex");
}
export function ownerForKey(key) {
  if (!key) return null;
  const rec = db.keys[hashKey(key)];
  return rec ? rec.ownerId : null;
}
export function ensureOwner(ownerId, label) {
  if (!db.owners[ownerId]) { db.owners[ownerId] = { id: ownerId, label: label || ownerId }; save(); }
  return db.owners[ownerId];
}
export function registerKey(key, ownerId, label) {
  db.keys[hashKey(key)] = { id: "key_" + crypto.randomUUID().slice(0, 8), ownerId, label: label || "", createdAt: new Date().toISOString() };
  save();
}
export function mintKey(ownerId, label) {
  const key = "vf_pk_" + crypto.randomBytes(18).toString("hex");
  registerKey(key, ownerId, label);
  return key; // plaintext returned once; only the hash is persisted
}

// --- channels --------------------------------------------------------------
export function createChannel(spec, ownerId) {
  const id = slugify(spec.id || spec.slug || spec.title);
  if (!id) throw httpErr(400, "channel needs a title or slug");
  const existing = db.channels[id];
  if (existing) {
    if (existing.ownerId !== ownerId) throw httpErr(409, "channel id taken by another owner");
    Object.assign(existing, pick(spec, ["title", "description", "icon", "accent", "kind", "visibility"]));
    save();
    return existing;
  }
  const ch = {
    id,
    title: str(spec.title || id, 80),
    description: str(spec.description || "", 280),
    icon: str(spec.icon || "", 8),
    accent: /^#[0-9a-fA-F]{6}$/.test(spec.accent || "") ? spec.accent : "#3a86ff",
    kind: KINDS.has(spec.kind) ? spec.kind : "note",
    ownerId,
    visibility: ["private", "unlisted", "public"].includes(spec.visibility) ? spec.visibility : "private",
    createdAt: new Date().toISOString(),
  };
  db.channels[id] = ch;
  save();
  return ch;
}

export function getChannel(id) { return db.channels[id] || null; }

// Channels visible to a user: public ones, plus any they own or are subscribed to.
export function listChannels(userId) {
  const subs = getSubs(userId);
  return Object.values(db.channels)
    .filter((c) => c.visibility === "public" || c.ownerId === userId || subs[c.id])
    .map((c) => ({
      id: c.id, title: c.title, description: c.description, icon: c.icon, accent: c.accent,
      kind: c.kind, visibility: c.visibility, owned: c.ownerId === userId,
      subscribed: !!subs[c.id], muted: !!(subs[c.id] && subs[c.id].muted),
    }));
}

// --- items / push ----------------------------------------------------------
export function pushItem(channelId, raw, ownerId) {
  const ch = db.channels[channelId];
  if (!ch) throw httpErr(404, "no such channel");
  if (ch.ownerId !== ownerId) throw httpErr(403, "you do not own this channel");
  const item = normalizeItem(raw, ch);

  const dup = findByDedupe(channelId, item.dedupeKey);
  if (dup) {
    // Upsert: refresh content in place, keep id/createdAt and existing delivery state so a
    // re-push of something already seen doesn't nag the consumer again.
    Object.assign(dup, pick(item, ["title", "body", "url", "imageUrl", "kind", "priority", "class", "expiresAt", "repeat"]));
    save();
    return { item: dup, deduped: true };
  }
  pushItemRecord(item);
  return { item, deduped: false };
}

function normalizeItem(raw, ch) {
  if (!raw || typeof raw !== "object" || !str(raw.title, 1)) throw httpErr(400, "item needs a title");
  const d = raw.delivery || {};
  return {
    id: "itm_" + crypto.randomUUID(),
    channelId: ch.id,
    title: str(raw.title, 300),
    body: str(raw.body || "", 1000),
    url: safeUrl(raw.url),
    imageUrl: safeUrl(raw.image_url || raw.imageUrl),
    kind: KINDS.has(raw.kind) ? raw.kind : ch.kind,
    dedupeKey: raw.dedupe_key || raw.dedupeKey || null,
    priority: clamp(num(d.priority, 50), 0, 100),
    class: CLASSES.has(d.class) ? d.class : "ambient",
    expiresAt: safeDate(d.expires_at || d.expiresAt),
    repeat: normalizeRepeat(d.repeat),
    createdAt: new Date().toISOString(),
  };
}
function normalizeRepeat(r) {
  if (!r || r.mode !== "recurring") return { mode: "once" };
  return { mode: "recurring", cooldownS: Math.max(0, num(r.cooldown_s ?? r.cooldownS, 86400)), max: r.max != null ? Math.max(1, num(r.max, 1)) : null };
}

// --- users -----------------------------------------------------------------
// First time we see a consumer id, give them their own subscription set seeded with the PUBLIC
// channels so their feed isn't empty. Private channels are never auto-added. Idempotent: once a
// user has a subscription record (even after unsubscribing from everything), we leave it alone.
export function ensureUser(userId) {
  if (db.subs[userId]) return;
  db.subs[userId] = {};
  for (const c of Object.values(db.channels)) {
    if (c.visibility === "public") db.subs[userId][c.id] = { muted: false, createdAt: new Date().toISOString() };
  }
  save();
}

// --- subscriptions ---------------------------------------------------------
export function subscribe(userId, channelId, opts = {}) {
  const ch = db.channels[channelId];
  if (!ch) throw httpErr(404, "no such channel");
  // You may subscribe to public/unlisted channels, or private ones you own. `force` is for
  // internal seeding (bootstrap) only — the HTTP route never sets it, so a stranger can't join
  // someone else's private channel.
  if (!opts.force && ch.visibility === "private" && ch.ownerId !== userId) {
    throw httpErr(403, "cannot subscribe to a private channel");
  }
  const subs = getSubs(userId);
  if (!subs[channelId]) subs[channelId] = { muted: false, createdAt: new Date().toISOString() };
  save();
  return listChannels(userId);
}
export function unsubscribe(userId, channelId) {
  delete getSubs(userId)[channelId];
  save();
  return listChannels(userId);
}
export function setMuted(userId, channelId, muted) {
  const subs = getSubs(userId);
  if (subs[channelId]) { subs[channelId].muted = !!muted; save(); }
  return listChannels(userId);
}

// --- delivery engine -------------------------------------------------------
// Pick the single best eligible card for this user right now.
export function next(userId) {
  const subs = getSubs(userId);
  const now = Date.now();
  const eligible = [];
  for (const [channelId, sub] of Object.entries(subs)) {
    if (sub.muted) continue;
    const list = db.itemsByChannel[channelId] || [];
    for (const id of list) {
      const it = db.items[id];
      if (!it) continue;
      if (it.expiresAt && new Date(it.expiresAt).getTime() < now) continue; // expired → drop
      const st = db.delivery[deliveryKey(userId, id)];
      if (!isEligible(it, st, now)) continue;
      eligible.push(it);
    }
  }
  if (!eligible.length) return null;

  // Rank: must_see first, then priority, then newest.
  eligible.sort((a, b) =>
    (b.class === "must_see") - (a.class === "must_see") ||
    b.priority - a.priority ||
    new Date(b.createdAt) - new Date(a.createdAt));

  // Round-robin fairness: avoid serving the same channel twice in a row when alternatives exist.
  const cur = db.cursor[userId] || (db.cursor[userId] = {});
  let chosen = eligible.find((it) => it.channelId !== cur.lastChannelId) || eligible[0];

  const dk = deliveryKey(userId, chosen.id);
  const st = db.delivery[dk] || (db.delivery[dk] = { deliveredCount: 0, lastDeliveredAt: null, seenAt: null });
  st.deliveredCount++;
  st.lastDeliveredAt = new Date().toISOString();
  cur.lastChannelId = chosen.channelId;
  save();
  return decorate(chosen);
}

function isEligible(it, st, now) {
  if (!st || st.deliveredCount === 0) return true; // never delivered
  if (it.repeat.mode === "recurring") {
    // recurring: respect max + cooldown, regardless of seen state
    if (it.repeat.max != null && st.deliveredCount >= it.repeat.max) return false;
    const last = st.lastDeliveredAt ? new Date(st.lastDeliveredAt).getTime() : 0;
    return now - last >= it.repeat.cooldownS * 1000;
  }
  // once: ambient shows a single time; must_see keeps surfacing until acknowledged (seen) —
  // "important" without being an interruptive notification.
  if (it.class === "must_see" && !st.seenAt) return true;
  return false;
}

export function markSeen(userId, itemId) {
  const it = db.items[itemId];
  const dk = deliveryKey(userId, itemId);
  const st = db.delivery[dk] || (db.delivery[dk] = { deliveredCount: 1, lastDeliveredAt: new Date().toISOString(), seenAt: null });
  if (!st.seenAt) {
    st.seenAt = new Date().toISOString();
    if (it) addHistory(userId, decorate(it));
  }
  save();
  return { ok: true };
}

export function history(userId, limit = 50) {
  return (db.history[userId] || []).slice(0, limit);
}

// Attach channel display info (label/accent) so the client doesn't need a second lookup.
function decorate(it) {
  const ch = db.channels[it.channelId] || {};
  return {
    id: it.id, channelId: it.channelId,
    sourceLabel: ch.title || it.channelId, accent: ch.accent || "#3a86ff",
    kind: it.kind, title: it.title, body: it.body, url: it.url, imageUrl: it.imageUrl,
    class: it.class, ts: it.createdAt,
  };
}

export function stats(userId) {
  const subs = getSubs(userId);
  return {
    channels: Object.keys(db.channels).length,
    items: Object.keys(db.items).length,
    subscriptions: Object.keys(subs).length,
    history: (db.history[userId] || []).length,
  };
}

export function init() { load(); }

// --- tiny utils ------------------------------------------------------------
function slugify(s) { return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48); }
function str(s, max) { s = s == null ? "" : String(s); return max === 1 ? (s.trim() ? s : "") : s.slice(0, max); }
function num(v, dflt) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function safeUrl(u) { return typeof u === "string" && /^https?:\/\//i.test(u) ? u.slice(0, 2000) : null; }
function safeDate(s) { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d.toISOString(); }
function pick(o, keys) { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; }
function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }
