// Reddit — top posts of the day from a few subreddits via the public .json endpoints.
// No auth, best-effort: Reddit now 403s the public .json from many IPs/datacenters
// regardless of User-Agent, so this is OFF by default and fails gracefully to []. When it
// does work (residential IPs usually do), it adds nice "discussion" items. For a reliable
// alternative, add a subreddit's RSS feed (https://www.reddit.com/r/<sub>/.rss) to the rss source.
import { fetchJson, makeId, truncate } from "./util.js";

export const meta = { id: "reddit", label: "Reddit", kind: "discussion", needsConfig: true };

export const DEFAULT_SUBS = ["todayilearned", "science", "technology"];

export async function fetch_(count = 6, subs = DEFAULT_SUBS) {
  const per = Math.max(2, Math.ceil(count / subs.length));
  const lists = await Promise.all(
    subs.map((s) =>
      fetchJson(`https://www.reddit.com/r/${encodeURIComponent(s)}/top.json?t=day&limit=${per}`)
        .then((d) => (d?.data?.children || []).map((c) => normalize(c.data)))
        .catch(() => [])
    )
  );
  return lists.flat().filter(Boolean).slice(0, count);
}

function normalize(p) {
  if (!p || p.over_18 || p.stickied || !p.title) return null;
  const img = pickImage(p);
  return {
    id: makeId("reddit", p.id),
    source: "reddit",
    sourceLabel: "r/" + p.subreddit,
    kind: "discussion",
    title: p.title,
    body: truncate(`${p.ups || 0} upvotes · ${p.num_comments || 0} comments`, 120),
    imageUrl: img,
    url: "https://www.reddit.com" + p.permalink,
    author: p.author ? "u/" + p.author : null,
    ts: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : new Date().toISOString(),
  };
}

function pickImage(p) {
  const prev = p.preview?.images?.[0]?.source?.url;
  if (prev) return prev.replace(/&amp;/g, "&");
  if (p.thumbnail && /^https?:\/\//.test(p.thumbnail)) return p.thumbnail;
  return null;
}
