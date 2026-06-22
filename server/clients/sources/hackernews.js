// Hacker News — top stories via the public Firebase API. No key, no config.
import { fetchJson, makeId, truncate } from "./util.js";

export const meta = { id: "hackernews", label: "Hacker News", kind: "discussion", needsConfig: false };

export async function fetch_(count = 6) {
  const ids = await fetchJson("https://hacker-news.firebaseio.com/v0/topstories.json");
  const pick = ids.slice(0, Math.min(count, ids.length));
  const items = await Promise.all(
    pick.map((id) =>
      fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)
    )
  );
  const out = [];
  for (const it of items) {
    if (!it || it.dead || it.deleted || !it.title) continue;
    const hnUrl = `https://news.ycombinator.com/item?id=${it.id}`;
    out.push({
      id: makeId("hackernews", it.id),
      source: "hackernews",
      sourceLabel: "Hacker News",
      kind: "discussion",
      title: it.title,
      body: truncate(`${it.score || 0} points · ${it.descendants || 0} comments` + (it.url ? ` · ${hostOf(it.url)}` : ""), 120),
      imageUrl: null,
      url: it.url || hnUrl,
      author: it.by || null,
      ts: it.time ? new Date(it.time * 1000).toISOString() : new Date().toISOString(),
    });
  }
  return out;
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}
