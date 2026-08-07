// Isolated-world bridge on shop.tiktok.com. Stores captured live-dashboard API
// responses and makes a best-effort parse of live stats (GMV, orders, viewers)
// until the exact fields are confirmed from a debug export.
const TAG = "__CGMXLIVE__";
const MAX = 30;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Find an object that looks like a live-stats summary (has gmv/order-ish keys).
function findStats(node, depth) {
  if (!node || depth > 7) return null;
  if (Array.isArray(node)) {
    for (const it of node) {
      const r = findStats(it, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof node === "object") {
    const keys = Object.keys(node).map((k) => k.toLowerCase());
    const hasGmv = keys.some((k) => k.includes("gmv") || k.includes("gpm") || (k.includes("total") && k.includes("amount")) || k.includes("pay_amount"));
    const hasOrder = keys.some((k) => k.includes("order") || k.includes("sku") || k.includes("sold"));
    if (hasGmv && hasOrder) return node;
    for (const k of Object.keys(node)) {
      const r = findStats(node[k], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function pick(obj, needles) {
  for (const k of Object.keys(obj || {})) {
    const lk = k.toLowerCase();
    if (needles.some((n) => lk.includes(n)) && (typeof obj[k] === "number" || typeof obj[k] === "string")) {
      const v = num(obj[k]);
      if (v) return v;
    }
  }
  return 0;
}

function parseLive(body, url) {
  try {
    const json = JSON.parse(body);
    const s = findStats(json, 0);
    if (!s) return null;
    const roomMatch = String(url).match(/room_id=(\d+)/);
    return {
      gmv: pick(s, ["gmv", "pay_amount", "total_amount", "revenue", "sales"]),
      orders: pick(s, ["order", "sold", "sku"]),
      viewers: pick(s, ["pcu", "viewer", "watch", "audience", "online"]),
      roomId: roomMatch ? roomMatch[1] : "",
      raw: s,
      ts: Date.now(),
    };
  } catch {
    return null;
  }
}

window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const d = ev.data;
  if (!d || d.source !== TAG || !d.entry) return;
  const e = d.entry;

  chrome.storage.local.get({ liveCaptures: [], liveStats: null }, (res) => {
    const list = res.liveCaptures || [];
    const key = e.url.split("?")[0];
    const idx = list.findIndex((c) => c.url.split("?")[0] === key);
    const rec = { url: e.url, body: String(e.body).slice(0, 6000), ts: e.ts };
    if (idx >= 0) list[idx] = rec;
    else list.unshift(rec);

    const parsed = parseLive(e.body, e.url);
    const patch = { liveCaptures: list.slice(0, MAX), liveTs: Date.now() };
    if (parsed && (parsed.gmv || parsed.orders)) patch.liveStats = parsed;
    chrome.storage.local.set(patch);
  });
});
