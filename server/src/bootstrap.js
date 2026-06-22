// First-boot seeding. Creates a default publisher owner + key and the default channels we
// "own", then auto-subscribes the local consumer so the feed isn't empty on first run. The
// reference pushers (clients/) use the returned key to push real content over the public API.
import { db } from "./store.js";
import * as bus from "./bus.js";

export const LOCAL_USER = "local";
const OWNER_ID = "owner_default";

// The channels we ship pushers for. They're just regular channels owned by us.
export const DEFAULT_CHANNELS = [
  { id: "wikipedia", title: "Wikipedia", accent: "#3a86ff", kind: "article", visibility: "public", description: "A random article to skim." },
  { id: "hackernews", title: "Hacker News", accent: "#ff8c42", kind: "discussion", visibility: "public", description: "Top stories." },
  { id: "rss", title: "RSS", accent: "#3a86ff", kind: "article", visibility: "public", description: "Articles from configured feeds." },
  { id: "personal", title: "Personal", accent: "#7c6cff", kind: "note", visibility: "private", description: "Your private lane — calendar, mail, reminders (mock for now)." },
];

export function bootstrap() {
  bus.ensureOwner(OWNER_ID, "vibefeed defaults");

  // Publisher key: prefer env (stable across restarts, usable by external pushers); else mint
  // one for this process so in-process pushers work out of the box.
  let key = process.env.VIBEFEED_KEY;
  if (key) {
    if (!bus.ownerForKey(key)) bus.registerKey(key, OWNER_ID, "env key");
  } else {
    key = bus.mintKey(OWNER_ID, "auto (set VIBEFEED_KEY to persist)");
  }

  for (const spec of DEFAULT_CHANNELS) {
    bus.createChannel(spec, OWNER_ID);
    // Auto-subscribe the local consumer so there's something to see immediately.
    if (!(db.subs[LOCAL_USER] && db.subs[LOCAL_USER][spec.id])) bus.subscribe(LOCAL_USER, spec.id);
  }
  return { ownerId: OWNER_ID, key };
}
