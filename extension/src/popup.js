// vibefeed popup — status, live preview, source toggles, settings, history.
const api = (typeof browser !== "undefined" && browser.runtime) ? browser : chrome;
const DEFAULT_BASE = typeof VF_API_BASE !== "undefined" ? VF_API_BASE : "http://localhost:4000";
const $ = (id) => document.getElementById(id);

const ACCENT = { calendar: "#7c6cff", email: "#7c6cff", note: "#7c6cff", article: "#3a86ff", discussion: "#ff8c42" };

let state = { base: DEFAULT_BASE, token: null };

async function loadSettings() {
  const s = await api.storage.local.get(["vf_api_base", "vf_token"]);
  state.base = s.vf_api_base || DEFAULT_BASE;
  state.token = s.vf_token || null;
  $("apiBase").value = state.base;
  $("token").value = state.token || "";
}

function url(path) { return state.base.replace(/\/$/, "") + path; }
function headers() {
  const h = { "Content-Type": "application/json" };
  if (state.token) h.Authorization = "Bearer " + state.token;
  return h;
}
async function get(path) {
  const r = await fetch(url(path), { headers: headers() });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
async function post(path, body) {
  const r = await fetch(url(path), { method: "POST", headers: headers(), body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 90) return "just now";
  const m = s / 60; if (m < 60) return Math.round(m) + "m ago";
  const h = m / 60; if (h < 24) return Math.round(h) + "h ago";
  return Math.round(h / 24) + "d ago";
}

async function refreshStatus() {
  try {
    const h = await get("/health");
    $("pill").className = "pill ok";
    $("statusText").textContent = `connected · ${h.queue} queued`;
  } catch (_) {
    $("pill").className = "pill bad";
    $("statusText").textContent = "offline";
  }
}

async function loadSources() {
  const box = $("sources");
  try {
    const d = await get("/feed/sources");
    box.textContent = "";
    for (const s of d.sources) {
      const row = document.createElement("div");
      row.className = "src";
      const lbl = document.createElement("div");
      lbl.className = "lbl";
      lbl.innerHTML = `${s.label} <span class="kind">${s.kind}${s.needsConfig ? " · configurable" : ""}</span>`;
      const sw = document.createElement("label");
      sw.className = "switch";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = s.enabled;
      const sl = document.createElement("span");
      sl.className = "slider";
      cb.addEventListener("change", async () => {
        try { await post("/feed/sources", { [s.id]: cb.checked }); refreshStatus(); }
        catch (_) { cb.checked = !cb.checked; }
      });
      sw.appendChild(cb); sw.appendChild(sl);
      row.appendChild(lbl); row.appendChild(sw);
      box.appendChild(row);
    }
  } catch (_) {
    box.innerHTML = '<div class="muted">backend offline</div>';
  }
}

function renderPreview(item) {
  const box = $("preview");
  box.style.display = "block";
  if (!item) { box.innerHTML = '<div class="muted">queue is empty — try a refill</div>'; return; }
  const accent = ACCENT[item.kind] || "#3a86ff";
  const img = item.imageUrl ? `<img src="${item.imageUrl}" referrerpolicy="no-referrer" onerror="this.remove()"/>` : "";
  box.innerHTML = `
    <div class="pcard">
      <div class="pbar"><span class="pdot" style="background:${accent}"></span>${escape_(item.sourceLabel || item.source)}</div>
      ${img}
      <div class="pbody">
        <div class="ptitle">${escape_(item.title || "")}</div>
        ${item.body ? `<div class="pdesc">${escape_(item.body)}</div>` : ""}
      </div>
    </div>`;
}
function escape_(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

async function loadHistory() {
  const box = $("history");
  try {
    const d = await get("/feed/history?limit=20");
    if (!d.items.length) { box.innerHTML = '<div class="muted">nothing yet</div>'; return; }
    box.textContent = "";
    for (const it of d.items) {
      const row = document.createElement("div");
      row.className = "hitem";
      row.innerHTML = `<span class="hsrc">${escape_(it.sourceLabel || it.source)}</span> ${escape_(it.title || "")} <span class="hwhen">· ${timeAgo(it.seenAt)}</span>`;
      box.appendChild(row);
    }
  } catch (_) {
    box.innerHTML = '<div class="muted">backend offline</div>';
  }
}

// --- wires ---
$("saveBase").addEventListener("click", async () => {
  state.base = $("apiBase").value.trim() || DEFAULT_BASE;
  await api.storage.local.set({ vf_api_base: state.base });
  await api.storage.local.remove("vf_cfg"); // drop cached config so the new backend's config is fetched
  refreshStatus(); loadSources(); loadHistory();
});
$("saveToken").addEventListener("click", async () => {
  state.token = $("token").value.trim() || null;
  if (state.token) await api.storage.local.set({ vf_token: state.token });
  else await api.storage.local.remove("vf_token");
  refreshStatus();
});

$("previewBtn").addEventListener("click", async () => {
  try { renderPreview(await get("/feed/next")); loadHistory(); }
  catch (_) { renderPreview(null); }
});

$("showBtn").addEventListener("click", async () => {
  const hint = $("showHint");
  hint.style.display = "block";
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab) { hint.textContent = "no active tab"; return; }
    const supported = /chatgpt\.com|chat\.openai\.com|claude\.ai|perplexity\.ai|gemini\.google\.com|mistral\.ai|copilot\.microsoft\.com|deepseek\.com|grok\.com/.test(tab.url || "");
    if (!supported) { hint.textContent = "Open a supported AI tab (ChatGPT, Claude, …) to see it in context."; return; }
    await api.tabs.sendMessage(tab.id, { type: "vf_show_now" });
    hint.textContent = "Card sent to the page ↘";
  } catch (_) {
    hint.textContent = "Couldn't reach the page — reload the AI tab after installing.";
  }
});

(async function init() {
  await loadSettings();
  refreshStatus();
  loadSources();
  loadHistory();
})();
