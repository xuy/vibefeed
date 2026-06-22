// Generic RSS / Atom — point it at any feed URL (blogs, your subscriptions, etc.).
// Tiny dependency-free parser: good enough for skimmable demo content.
import { fetchText, makeId, stripHtml, truncate } from "./util.js";

export const meta = { id: "rss", label: "RSS", kind: "article", needsConfig: true };

// Sensible defaults so the source does something out of the box. Override via FEED_RSS env
// (comma-separated URLs) or the /feed/sources API.
export const DEFAULT_FEEDS = [
  "https://hnrss.org/frontpage",
  "https://www.theverge.com/rss/index.xml",
];

export async function fetch_(count = 6, feeds = DEFAULT_FEEDS) {
  const lists = await Promise.all(
    feeds.map((f) => fetchText(f).then((x) => parseFeed(x, f)).catch(() => []))
  );
  const merged = lists.flat();
  // Interleave newest-ish first, then cap.
  return merged.slice(0, count);
}

function parseFeed(xml, feedUrl) {
  const feedTitle = first(tag(xml, "title")) || hostOf(feedUrl);
  const blocks = blocksOf(xml, "item").concat(blocksOf(xml, "entry")); // RSS + Atom
  const out = [];
  for (const b of blocks) {
    const title = stripHtml(first(tag(b, "title")) || "");
    if (!title) continue;
    const link = linkOf(b);
    const desc = first(tag(b, "description")) || first(tag(b, "summary")) || first(tag(b, "content")) || "";
    const date = first(tag(b, "pubDate")) || first(tag(b, "updated")) || first(tag(b, "published")) || "";
    out.push({
      id: makeId("rss", link || title),
      source: "rss",
      sourceLabel: feedTitle.length > 28 ? hostOf(feedUrl) : feedTitle,
      kind: "article",
      title,
      body: truncate(stripHtml(desc), 240),
      imageUrl: imgOf(b),
      url: link || feedUrl,
      author: stripHtml(first(tag(b, "creator")) || first(tag(b, "author")) || "") || null,
      ts: date ? safeDate(date) : new Date().toISOString(),
    });
  }
  return out;
}

// --- minimal XML helpers ---
function blocksOf(xml, name) {
  const re = new RegExp(`<${name}[\\s>][\\s\\S]*?</${name}>`, "gi");
  return xml.match(re) || [];
}
function tag(xml, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi");
  const res = [];
  let m;
  while ((m = re.exec(xml))) res.push(decodeCdata(m[1]));
  return res;
}
function first(arr) { return arr && arr.length ? arr[0].trim() : ""; }
function decodeCdata(s) { return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"); }
function linkOf(b) {
  // Atom: <link href="..."/> ; RSS: <link>...</link>
  const href = b.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (href) return href[1];
  const t = first(tag(b, "link"));
  return t || "";
}
function imgOf(b) {
  const enc = b.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']image/i);
  if (enc) return enc[1];
  const media = b.match(/<media:(?:content|thumbnail)[^>]*url=["']([^"']+)["']/i);
  if (media) return media[1];
  const img = b.match(/<img[^>]*src=["']([^"']+)["']/i);
  return img ? img[1] : null;
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "RSS"; } }
function safeDate(s) { const d = new Date(s); return isNaN(d) ? new Date().toISOString() : d.toISOString(); }
