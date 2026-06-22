// vibefeed admin console — a thin client over the /v1 API. No framework, no build.
const $ = (id) => document.getElementById(id);
const ACCENT = { calendar: "#7c6cff", email: "#7c6cff", note: "#7c6cff", article: "#3a86ff", discussion: "#ff8c42", event: "#7c6cff" };

function makeUser() {
  let u = localStorage.getItem("vf_user");
  if (!u) { u = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : "u-" + Date.now() + "-" + Math.random().toString(36).slice(2); localStorage.setItem("vf_user", u); }
  return u;
}
const cfg = {
  base: localStorage.getItem("vf_base") || location.origin || "http://localhost:4000",
  key: localStorage.getItem("vf_key") || "",
  user: makeUser(), // this browser's consumer identity → its own feed/subscriptions
};

function url(p) { return cfg.base.replace(/\/$/, "") + p; }
function pubHeaders() { const h = { "Content-Type": "application/json", "X-Vibefeed-User": cfg.user }; if (cfg.key) h.Authorization = "Bearer " + cfg.key; return h; }
async function get(p) { const r = await fetch(url(p), { headers: { "X-Vibefeed-User": cfg.user } }); if (r.status === 204) return null; if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }
async function post(p, body, auth) {
  const r = await fetch(url(p), { method: "POST", headers: auth ? pubHeaders() : { "Content-Type": "application/json", "X-Vibefeed-User": cfg.user }, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  return d;
}
function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
function timeAgo(ts) { if (!ts) return ""; const s = Math.max(0, (Date.now() - new Date(ts)) / 1000); if (s < 90) return "just now"; const m = s / 60; if (m < 60) return Math.round(m) + "m ago"; const h = m / 60; if (h < 24) return Math.round(h) + "h ago"; return Math.round(h / 24) + "d ago"; }
let toastT;
function toast(msg, bad) { const t = $("toast"); t.textContent = msg; t.style.background = bad ? "#ec5b5b" : "#17162e"; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }

function cardHTML(item) {
  if (!item) return '<span class="muted">—</span>';
  const a = item.accent || ACCENT[item.kind] || "#3a86ff";
  const img = item.imageUrl ? `<img src="${esc(item.imageUrl)}" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
  return `<div class="pcard"><div class="pbar"><span><span class="pdot" style="background:${a}"></span>${esc(item.sourceLabel || item.channelId || "channel")}</span><span style="color:#c3c1d0">×</span></div>${img}
    <div class="pb"><div class="pt">${esc(item.title || "(untitled)")}</div>${item.body ? `<div class="pd">${esc(item.body)}</div>` : ""}</div>
    <div class="pf"><span>${esc(item.class || "")}</span><span>vibefeed</span></div></div>`;
}

// ---- nav (deep-linkable via #tab) ----
function activateTab(tab) {
  document.querySelectorAll("#nav button").forEach((x) => x.classList.toggle("on", x.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("on", p.dataset.panel === tab));
  if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
  if (tab === "overview") loadOverview();
  if (tab === "channels") loadChannels();
  if (tab === "push") loadChannelOptions();
  if (tab === "history") loadHistory();
}
$("nav").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]"); if (!b) return;
  activateTab(b.dataset.tab);
});

// ---- status / overview ----
async function refreshStatus() {
  try { const h = await get("/health"); $("dot").className = "dot ok"; $("statusText").textContent = "connected"; return h; }
  catch { $("dot").className = "dot bad"; $("statusText").textContent = "offline"; return null; }
}
async function loadOverview() {
  const h = await refreshStatus();
  if (h) { $("s_channels").textContent = h.channels; $("s_items").textContent = h.items; $("s_subs").textContent = h.subscriptions; $("s_hist").textContent = h.history; }
  $("ov_key").value = cfg.key || "(none — set in Settings)";
}
$("copyKey").addEventListener("click", () => { navigator.clipboard.writeText(cfg.key || "").then(() => toast("key copied")); });

// ---- channels ----
async function loadChannels() {
  try {
    const { channels } = await get("/v1/channels");
    const visClass = { public: "pub", private: "priv", unlisted: "unl" };
    $("chRows").innerHTML = channels.map((c) => `
      <tr><td><b>${esc(c.title)}</b><div class="muted" style="font-size:11.5px">${esc(c.id)}${c.owned ? " · owned" : ""}</div></td>
      <td><span class="chip">${esc(c.kind)}</span></td>
      <td><span class="chip ${visClass[c.visibility] || ""}">${esc(c.visibility)}</span></td>
      <td>${c.subscribed ? (c.muted ? '<span class="chip" style="color:#ec5b5b">muted</span>' : '<span class="chip pub">subscribed</span>') : '<span class="muted">—</span>'}</td>
      <td class="right">
        <button class="btn subtle sm" data-act="${c.subscribed ? "unsubscribe" : "subscribe"}" data-ch="${esc(c.id)}">${c.subscribed ? "Unsubscribe" : "Subscribe"}</button>
        ${c.subscribed ? `<button class="btn subtle sm" data-act="${c.muted ? "unmute" : "mute"}" data-ch="${esc(c.id)}">${c.muted ? "Unmute" : "Mute"}</button>` : ""}
      </td></tr>`).join("") || '<tr><td colspan="5" class="muted" style="padding:16px">no channels</td></tr>';
  } catch { $("chRows").innerHTML = '<tr><td colspan="5" class="muted" style="padding:16px">backend offline</td></tr>'; }
}
$("chRows").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  try { await post("/v1/subscriptions", { channelId: b.dataset.ch, action: b.dataset.act }); loadChannels(); } catch (err) { toast(err.message, true); }
});
$("nc_create").addEventListener("click", async () => {
  const body = { id: $("nc_id").value.trim(), title: $("nc_title").value.trim(), description: $("nc_desc").value.trim(), accent: $("nc_accent").value, kind: $("nc_kind").value, visibility: $("nc_vis").value };
  if (!body.id && !body.title) return toast("need a slug or title", true);
  try { const r = await post("/v1/channels", body, true); toast("channel created: " + r.channel.id); $("nc_id").value = $("nc_title").value = $("nc_desc").value = ""; loadChannels(); } catch (e) { toast(e.message, true); }
});

// ---- push ----
async function loadChannelOptions() {
  try {
    const { channels } = await get("/v1/channels");
    const owned = channels.filter((c) => c.owned);
    const list = owned.length ? owned : channels;
    $("p_channel").innerHTML = list.map((c) => `<option value="${esc(c.id)}">${esc(c.title)} (${esc(c.id)})</option>`).join("");
    pushPreview();
  } catch {}
}
function pushPayload() {
  const repeat = $("p_repeat").value === "recurring"
    ? { mode: "recurring", cooldown_s: Number($("p_cooldown").value) || 0, max: $("p_max").value ? Number($("p_max").value) : undefined }
    : { mode: "once" };
  const exp = $("p_expires").value ? new Date($("p_expires").value).toISOString() : undefined;
  return {
    title: $("p_title").value, body: $("p_body").value, url: $("p_url").value || undefined, image_url: $("p_img").value || undefined,
    kind: $("p_kind").value, dedupe_key: $("p_dedupe").value || undefined,
    delivery: { class: $("p_class").value, priority: Number($("p_prio").value), expires_at: exp, repeat },
  };
}
function pushPreview() {
  const p = pushPayload();
  const ch = $("p_channel").value;
  $("p_preview").innerHTML = cardHTML({ title: p.title || "Your title…", body: p.body, imageUrl: p.image_url, kind: p.kind, class: p.delivery.class, sourceLabel: ch });
}
["p_title", "p_body", "p_img", "p_kind", "p_class", "p_channel"].forEach((id) => $(id).addEventListener("input", pushPreview));
$("p_prio").addEventListener("input", () => { $("p_prioVal").textContent = $("p_prio").value; });
$("p_send").addEventListener("click", async () => {
  const p = pushPayload();
  if (!p.title.trim()) return toast("title is required", true);
  if (!cfg.key) return toast("set a publisher key in Settings", true);
  try { const r = await post(`/v1/channels/${$("p_channel").value}/items`, p, true); $("p_result").textContent = `pushed ${r.id}${r.deduped ? " (deduped/upsert)" : ""}`; toast("pushed ✓"); }
  catch (e) { toast(e.message, true); }
});

// ---- live feed ----
let current = null, playT = null;
async function pullNext() {
  try {
    const item = await get("/v1/feed/next");
    current = item;
    $("f_card").innerHTML = item ? cardHTML(item) : '<span class="muted">204 — nothing eligible right now</span>';
    $("f_json").textContent = item ? JSON.stringify(item, null, 2) : "// 204 No Content";
    $("f_meta").textContent = item ? "" : "queue empty";
  } catch (e) { toast(e.message, true); }
}
$("f_next").addEventListener("click", pullNext);
$("f_play").addEventListener("click", () => {
  if (playT) { clearInterval(playT); playT = null; $("f_play").textContent = "▶ Auto-play"; return; }
  $("f_play").textContent = "⏸ Stop"; pullNext(); playT = setInterval(pullNext, 4000);
});
$("f_seen").addEventListener("click", async () => { if (!current) return; try { await post("/v1/feed/seen", { id: current.id }); toast("marked seen"); } catch (e) { toast(e.message, true); } });
$("f_open").addEventListener("click", () => { if (current && current.url) window.open(current.url, "_blank"); else toast("no link"); });

// ---- history ----
async function loadHistory() {
  try {
    const { items } = await get("/v1/feed/history?limit=50");
    $("histRows").innerHTML = items.map((i) => `<tr><td><span class="chip">${esc(i.sourceLabel || i.channelId)}</span></td><td>${esc(i.title)}</td><td class="right muted">${esc(timeAgo(i.seenAt))}</td></tr>`).join("") || '<tr><td colspan="3" class="muted" style="padding:16px">nothing yet</td></tr>';
  } catch { $("histRows").innerHTML = '<tr><td colspan="3" class="muted" style="padding:16px">backend offline</td></tr>'; }
}

// ---- settings ----
$("set_save").addEventListener("click", () => {
  cfg.base = $("set_base").value.trim() || cfg.base;
  cfg.key = $("set_key").value.trim();
  localStorage.setItem("vf_base", cfg.base); localStorage.setItem("vf_key", cfg.key);
  $("baseLabel").textContent = cfg.base; toast("saved"); loadOverview();
});

// ---- boot ----
(async function init() {
  // Try the loopback convenience endpoint to auto-fill base + key locally.
  try {
    const r = await fetch(url("/v1/admin/hello"));
    if (r.ok) { const d = await r.json(); if (!cfg.key && d.key) cfg.key = d.key; if (d.base && !localStorage.getItem("vf_base")) cfg.base = d.base; }
  } catch {}
  $("set_base").value = cfg.base; $("set_key").value = cfg.key; $("baseLabel").textContent = cfg.base;
  const start = (location.hash || "#overview").slice(1);
  activateTab(document.querySelector(`#nav button[data-tab="${start}"]`) ? start : "overview");
})();
