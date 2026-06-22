// Feed engine: pulls from enabled sources into an in-memory queue, serves one item at a
// time, remembers what's been seen, and keeps a short history. State is persisted to a JSON
// file so a restart doesn't replay everything you already skimmed.
import fs from "node:fs";
import path from "node:path";

import * as wikipedia from "./sources/wikipedia.js";
import * as hackernews from "./sources/hackernews.js";
import * as rss from "./sources/rss.js";
import * as reddit from "./sources/reddit.js";
import * as mock from "./sources/mock.js";

const MODULES = { wikipedia, hackernews, rss, reddit, mock };

// Which sources are on by default. reddit is off (rate-limit flaky from cloud IPs); flip it
// on from the popup or POST /feed/sources when running locally.
const DEFAULT_ENABLED = { wikipedia: true, hackernews: true, rss: true, reddit: false, mock: true };

const STATE_FILE = process.env.FEED_STATE || path.join(process.cwd(), ".vibefeed-state.json");
const LOW_WATERMARK = 6; // refill when the queue drops below this
const REFILL_MS = 10 * 60 * 1000; // background refill cadence
const MAX_HISTORY = 200;
const MAX_SEEN = 2000; // cap the dedup memory so it can't grow unbounded

// Runtime config handed to the extension (tweak delivery feel without reshipping the ext).
export const CONFIG = {
  cooldownMs: 20000, // min gap between two cards on a page
  minVisibleMs: 1500, // mark "seen" only after the card has been up this long
  displayMs: 11000, // auto-dismiss after this
  maxPerSession: 0, // 0 = unlimited
};

const state = {
  enabled: { ...DEFAULT_ENABLED },
  feeds: parseList(process.env.FEED_RSS) || rss.DEFAULT_FEEDS,
  subs: parseList(process.env.FEED_SUBREDDITS) || reddit.DEFAULT_SUBS,
  queue: [],
  seen: new Set(),
  history: [],
  refilling: false,
  lastRefill: 0,
};

function parseList(s) {
  if (!s) return null;
  const a = s.split(",").map((x) => x.trim()).filter(Boolean);
  return a.length ? a : null;
}

// --- persistence -----------------------------------------------------------
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (raw.enabled) state.enabled = { ...DEFAULT_ENABLED, ...raw.enabled };
    if (Array.isArray(raw.seen)) state.seen = new Set(raw.seen.slice(-MAX_SEEN));
    if (Array.isArray(raw.history)) state.history = raw.history.slice(0, MAX_HISTORY);
    if (Array.isArray(raw.feeds) && raw.feeds.length) state.feeds = raw.feeds;
    if (Array.isArray(raw.subs) && raw.subs.length) state.subs = raw.subs;
  } catch {
    /* first run / no file yet */
  }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(
        STATE_FILE,
        JSON.stringify({
          enabled: state.enabled,
          feeds: state.feeds,
          subs: state.subs,
          seen: [...state.seen].slice(-MAX_SEEN),
          history: state.history.slice(0, MAX_HISTORY),
        })
      );
    } catch (e) {
      console.warn("[vibefeed] could not persist state:", e.message);
    }
  }, 400);
}

// --- refill ----------------------------------------------------------------
async function pullSource(id) {
  const mod = MODULES[id];
  if (!mod) return [];
  try {
    if (id === "rss") return await mod.fetch_(6, state.feeds);
    if (id === "reddit") return await mod.fetch_(6, state.subs);
    return await mod.fetch_();
  } catch (e) {
    console.warn(`[vibefeed] source ${id} failed:`, e.message);
    return [];
  }
}

export async function refill() {
  if (state.refilling) return;
  state.refilling = true;
  try {
    const ids = Object.keys(state.enabled).filter((k) => state.enabled[k]);
    const lists = await Promise.all(ids.map((id) => pullSource(id)));
    const queuedIds = new Set(state.queue.map((i) => i.id));
    const fresh = interleave(lists).filter(
      (it) => it && it.id && !state.seen.has(it.id) && !queuedIds.has(it.id)
    );
    state.queue.push(...fresh);
    state.lastRefill = Date.now();
    console.log(
      `[vibefeed] refill: +${fresh.length} items from [${ids.join(", ")}] (queue=${state.queue.length})`
    );
  } finally {
    state.refilling = false;
  }
}

// Round-robin across sources so the queue mixes personal + content rather than batching.
function interleave(lists) {
  const out = [];
  const copies = lists.map((l) => [...l]);
  let added = true;
  while (added) {
    added = false;
    for (const c of copies) {
      if (c.length) {
        out.push(c.shift());
        added = true;
      }
    }
  }
  return out;
}

// --- public API ------------------------------------------------------------
export async function next() {
  if (state.queue.length < LOW_WATERMARK) {
    if (state.queue.length === 0) await refill();
    else refill(); // top up in the background, don't block this request
  }
  while (state.queue.length) {
    const it = state.queue.shift();
    if (state.seen.has(it.id)) continue;
    return it;
  }
  return null;
}

export function markSeen(item) {
  if (!item || !item.id) return;
  if (state.seen.has(item.id)) return;
  state.seen.add(item.id);
  if (state.seen.size > MAX_SEEN) {
    // drop oldest insertions (Set preserves insertion order)
    const trimmed = [...state.seen].slice(-MAX_SEEN);
    state.seen = new Set(trimmed);
  }
  state.history.unshift({ ...item, seenAt: new Date().toISOString() });
  state.history = state.history.slice(0, MAX_HISTORY);
  save();
}

export function history(limit = 50) {
  return state.history.slice(0, limit);
}

export function sources() {
  return Object.entries(MODULES).map(([id, mod]) => ({
    id,
    label: mod.meta.label,
    kind: mod.meta.kind,
    enabled: !!state.enabled[id],
    needsConfig: !!mod.meta.needsConfig,
  }));
}

export function setSources(patch) {
  if (patch && typeof patch === "object") {
    for (const [k, v] of Object.entries(patch)) {
      if (k in state.enabled) state.enabled[k] = !!v;
    }
  }
  save();
  return sources();
}

export function setConfig(patch) {
  if (patch && typeof patch === "object") {
    for (const k of ["feeds", "subs"]) {
      if (Array.isArray(patch[k]) && patch[k].length) state[k] = patch[k];
    }
  }
  save();
  return { feeds: state.feeds, subs: state.subs };
}

export function stats() {
  return {
    queue: state.queue.length,
    seen: state.seen.size,
    history: state.history.length,
    lastRefill: state.lastRefill ? new Date(state.lastRefill).toISOString() : null,
    enabled: state.enabled,
  };
}

export function start() {
  load();
  refill(); // warm the queue on boot
  setInterval(() => {
    if (Date.now() - state.lastRefill > REFILL_MS) refill();
  }, REFILL_MS).unref?.();
}
