// Isolated-world bridge on shop.tiktok.com. Accumulates the LIVE dashboard's
// internal API responses into one compact snapshot (core stats + traffic
// sources + top products + GMV trend), keyed by the live owner's TikTok id
// (= the campaign's channel id), so the LLM advisor can reason over it.
const TAG = "__CGMXLIVE__";

function num(v) {
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function amt(o) {
  if (o == null) return 0;
  if (typeof o === "object") return num(o.amount);
  return num(o);
}
// Find the first gmv-ish amount inside an object (defensive for varied shapes).
function findAmount(obj, prefer) {
  if (!obj || typeof obj !== "object") return 0;
  for (const k of Object.keys(obj)) {
    const lk = k.toLowerCase();
    if (prefer.some((p) => lk.includes(p))) {
      const v = obj[k];
      const a = amt(v);
      if (a) return a;
    }
  }
  return 0;
}

function parseCore(data) {
  const s = (data && data.stats) || data || {};
  return {
    gmv: amt(s.gmv_local),
    sales: num(s.sales),
    viewers: num(s.watch_uv),
    currentViewers: num(s.current_visitor_cnt),
    gpm: amt(s.live_show_gpm_local),
    adsCost: amt(s.ads_cost_local),
    gmvPerHour: amt(s.gmv_local_per_hour),
    ctr: num(s.click_through_rate),
    avgViewDuration: num(s.avg_view_duration),
    followRate: num(s.live_follow_rate),
    enterRoomRate: num(s.enter_room_rate),
  };
}
function parseSources(data) {
  const arr = (data && data.stats && data.stats.all_traffic_distribution) || [];
  return arr
    .map((it) => {
      const m = it.main_source || it;
      return {
        source: m.source_name || m.name || "",
        watchPv: num(m.watch_pv),
        ctr: num(m.ctr),
        gmv: findAmount(m, ["gmv", "amount", "pay"]),
      };
    })
    .filter((x) => x.source)
    .slice(0, 6);
}
function parseProducts(data) {
  const segs = (data && data.segments) || [];
  const rows = [];
  for (const seg of segs) for (const p of seg.stats || []) rows.push(p);
  return rows
    .map((p) => ({ name: (p.name || "").slice(0, 40), gmv: findAmount(p, ["gmv", "pay", "amount"]) }))
    .filter((x) => x.name)
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, 5);
}
function parseTrend(data) {
  const series = (data && data.trend_data) || [];
  // Prefer the GMV series (stats_type 3 in samples); else the first with amounts.
  let pts = null;
  for (const s of series) {
    const d = (s.data || []).map((x) => amt(x.amount)).filter((v) => v >= 0);
    if (s.stats_type === 3 && d.length) { pts = d; break; }
    if (!pts && d.length) pts = d;
  }
  if (!pts || pts.length < 3) return { dir: "flat", recent: pts || [] };
  const last = pts.slice(-3);
  const dir = last[2] > last[0] * 1.1 ? "up" : last[2] < last[0] * 0.9 ? "down" : "flat";
  return { dir, recent: pts.slice(-6) };
}

window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const d = ev.data;
  if (!d || d.source !== TAG || !d.entry) return;
  const e = d.entry;
  let j;
  try {
    j = JSON.parse(e.body);
  } catch {
    return; // partial/non-JSON — skip (full body is parsed here, not truncated)
  }
  const data = (j && j.data) || j;
  if (!data || typeof data !== "object") return;
  const url = e.url || "";

  chrome.storage.local.get({ liveCurrent: {}, liveCaptures: [] }, (res) => {
    const cur = res.liveCurrent || {};
    if (url.includes("/room/info")) {
      cur.channelId = String(data.owner_tiktok_id || cur.channelId || "");
      cur.name = data.owner_name || cur.name || "";
      cur.roomId = String(data.room_id || cur.roomId || "");
      cur.title = data.room_title || cur.title || "";
      cur.isLive = (data.status && data.status.status) === 1;
    } else if (url.includes("/room/status")) {
      cur.isLive = data.status === 1 || (data.status && data.status.status) === 1;
    } else if (url.includes("/core/stats") && !url.includes("selection")) {
      Object.assign(cur, parseCore(data));
    } else if (url.includes("/source/new") || url.includes("/detail/source")) {
      cur.trafficSources = parseSources(data);
    } else if (url.includes("/product/list") && !url.includes("selection")) {
      cur.topProducts = parseProducts(data);
    } else if (url.includes("/trend/chart") && !url.includes("selection")) {
      cur.trend = parseTrend(data);
    } else {
      return; // not a snapshot-relevant endpoint
    }
    cur.ts = Date.now();

    // Keep a small debug trail of which endpoints we've seen.
    const caps = res.liveCaptures || [];
    const key = url.split("?")[0];
    const idx = caps.findIndex((c) => c.url.split("?")[0] === key);
    const rec = { url, body: String(e.body).slice(0, 8000), ts: e.ts };
    if (idx >= 0) caps[idx] = rec;
    else caps.unshift(rec);

    const patch = { liveCurrent: cur, liveCaptures: caps.slice(0, 30), liveTs: cur.ts };
    if (cur.channelId) patch.liveStats = { [cur.channelId]: cur };
    chrome.storage.local.set(patch);
  });
});
