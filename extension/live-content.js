// Isolated-world bridge on shop.tiktok.com. Stores captured live-dashboard API
// responses and parses them into per-channel live stats, keyed by the live
// owner's TikTok id (which equals the campaign's channel id), so the autopilot
// can use real live signals (GMV, orders, viewers, GPM, live on/off).
const TAG = "__CGMXLIVE__";
const MAX = 40;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function amt(o) {
  return o && o.amount != null ? num(o.amount) : 0;
}
function roomIdFromUrl(url) {
  const m = String(url).match(/room_id=(\d+)/);
  return m ? m[1] : "";
}

// Rebuild the per-channel live stats from all stored captures.
function buildLiveStats(caps) {
  const rooms = {}; // roomId -> {ownerId, name, isLive, title, ts}
  const metrics = {}; // roomId -> {gmv, sales, viewers, ...}
  for (const c of caps || []) {
    let j;
    try {
      j = JSON.parse(c.body);
    } catch {
      continue;
    }
    const data = (j && j.data) || j;
    if (!data || typeof data !== "object") continue;
    const url = c.url || "";
    const rid = data.room_id || roomIdFromUrl(url);

    if (url.includes("/room/info")) {
      rooms[data.room_id || rid] = {
        ownerId: String(data.owner_tiktok_id || ""),
        name: data.owner_name || "",
        handle: data.owner_handle || "",
        isLive: (data.status && data.status.status) === 1,
        title: data.room_title || "",
        startedAt: num(data.started_at),
        ts: c.ts,
      };
    } else if (url.includes("/room/status") && rid) {
      rooms[rid] = rooms[rid] || {};
      rooms[rid].isLive = data.status === 1 || (data.status && data.status.status) === 1;
      if (!rooms[rid].ts) rooms[rid].ts = c.ts;
    } else if (url.includes("/core/stats") && !url.includes("selection") && rid) {
      const s = (data && data.stats) || data;
      if (s) {
        metrics[rid] = {
          gmv: amt(s.gmv_local),
          sales: num(s.sales),
          viewers: num(s.watch_uv),
          currentViewers: num(s.current_visitor_cnt),
          gpm: amt(s.live_show_gpm_local),
          adsCost: amt(s.ads_cost_local),
          gmvPerHour: amt(s.gmv_local_per_hour),
          ctr: num(s.click_through_rate),
          ts: c.ts,
        };
      }
    }
  }

  // Merge room info + metrics, keyed by the owner's TikTok id (= channel id).
  const byChannel = {};
  for (const [rid, r] of Object.entries(rooms)) {
    if (!r.ownerId) continue;
    byChannel[r.ownerId] = {
      channelId: r.ownerId,
      name: r.name,
      roomId: rid,
      isLive: !!r.isLive,
      title: r.title,
      ...(metrics[rid] || {}),
      ts: Math.max(r.ts || 0, (metrics[rid] && metrics[rid].ts) || 0),
    };
  }
  return byChannel;
}

window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const d = ev.data;
  if (!d || d.source !== TAG || !d.entry) return;
  const e = d.entry;

  chrome.storage.local.get({ liveCaptures: [] }, (res) => {
    const list = res.liveCaptures || [];
    const key = e.url.split("?")[0];
    const idx = list.findIndex((c) => c.url.split("?")[0] === key);
    const rec = { url: e.url, body: String(e.body).slice(0, 12000), ts: e.ts };
    if (idx >= 0) list[idx] = rec;
    else list.unshift(rec);
    const caps = list.slice(0, MAX);
    chrome.storage.local.set({
      liveCaptures: caps,
      liveStats: buildLiveStats(caps),
      liveTs: Date.now(),
    });
  });
});
