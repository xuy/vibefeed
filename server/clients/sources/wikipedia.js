// Wikipedia — a random article summary. Zero config, very reliable, family-friendly
// enough for a demo, and a nice "skim something new" item.
import { fetchJson, makeId, truncate } from "./util.js";

export const meta = { id: "wikipedia", label: "Wikipedia", kind: "article", needsConfig: false };

export async function fetch_(count = 4) {
  const out = [];
  // The REST random endpoint returns one summary per call, so we fan out a few.
  const calls = Array.from({ length: count }, () =>
    fetchJson("https://en.wikipedia.org/api/rest_v1/page/random/summary").catch(() => null)
  );
  const results = await Promise.all(calls);
  for (const d of results) {
    if (!d || !d.title || d.type === "disambiguation") continue;
    const url = d.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(d.title)}`;
    out.push({
      id: makeId("wikipedia", d.pageid || d.title),
      source: "wikipedia",
      sourceLabel: "Wikipedia",
      kind: "article",
      title: d.title,
      body: truncate(d.extract || d.description || "", 260),
      imageUrl: d.thumbnail?.source || null,
      url,
      author: null,
      ts: new Date().toISOString(),
    });
  }
  return out;
}
