// Service worker: scheduling, the automation engine, and Telegram.

if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

const KEYS = {
  enabled: false,
  channels: [],
  telegramToken: "",
  telegramChatId: "",
  campaigns: [],
  pauseRecipe: null,
  lastRun: 0,
  actedIds: {}, // campaignId -> ts (avoid repeat actions within a window)
  createdTs: {}, // channelId -> ts of last auto-create (rate-limit new campaigns)
  scaledTs: {}, // campaignId -> ts of last budget scale-up
  roiTs: {}, // campaignId -> ts of last ROI-target adjust
  history: {}, // campaignId -> [{ts, roi, cost, gmv}] rolling performance
  channelMemory: {}, // channelId -> { 'YYYY-MM-DD': {gmv,cost,roi,profit,mode,liveGpm} }
  liveStats: {}, // channelId -> live-dashboard stats (from shop.tiktok.com)
  openaiKey: "",
  openaiModel: "gpt-4o-mini",
  aiAnalysis: {}, // channelId -> {analysis, decisions, ts}
  aiTs: {}, // channelId -> ts of last LLM call (rate limit / cost control)
  logs: [],
  pauseDiag: {}, // campaignId/ch -> last "why not paused" note (dedupe log spam)
  lastScan: [], // per-campaign readout from the latest cycle (numbers + decision)
  lastScanTs: 0,
};

// Current date in Bangkok (UTC+7) as "YYYY-MM-DD" — the key for daily memory
// buckets. (Was referenced but never defined, which threw every cycle.)
function bangkokDateStr(ts) {
  const bkk = new Date((ts || Date.now()) + 7 * 3600 * 1000); // shift to BKK wall clock
  const y = bkk.getUTCFullYear();
  const m = String(bkk.getUTCMonth() + 1).padStart(2, "0");
  const d = String(bkk.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Which mode is managing a channel right now (for the memory tag).
function channelMode(st, enabled) {
  if (!enabled) return "manual";
  const ap = st && st.autopilot;
  if (ap && ap.enabled) return ap.mode === "ai" ? "ai" : "auto";
  return "rules";
}

// Append a performance snapshot per campaign (for trend/learning), tagged with
// the management mode (manual/ai/auto/rules) so we can compare what works. This
// runs every cycle — INCLUDING when the program is off and you manage by hand —
// so the memory covers manual periods too. Keeps the last ~60 points each.
function recordHistory(history, campaigns, channels, enabled, now) {
  const out = {};
  for (const c of campaigns) {
    if (!c.id) continue;
    if ((c.cost || 0) <= 0 && (c.gmv || 0) <= 0) { if (history[c.id]) out[c.id] = history[c.id]; continue; }
    const ch = (channels || []).find((x) => channelMatch(c, x));
    const mode = channelMode(ch && ch.settings, enabled);
    const prev = history[c.id] || [];
    out[c.id] = [...prev, { ts: now, roi: c.roi || 0, cost: c.cost || 0, gmv: c.gmv || 0, budget: c.budget || 0, mode }].slice(-60);
  }
  return out;
}

// Long-term per-channel memory: roll up each channel's TODAY totals into a
// daily bucket (overwritten each cycle with the latest cumulative), tagged with
// the management mode, kept for ~30 days. This survives campaign churn (new
// campaign ids) and is the real cross-live learning record.
function updateChannelMemory(mem, channels, campaigns, liveStats, enabled, now) {
  const date = bangkokDateStr();
  const out = { ...(mem || {}) };
  for (const ch of channels || []) {
    const worked = (campaigns || []).filter((c) => channelMatch(c, ch) && ((c.cost || 0) > 0 || (c.gmv || 0) > 0));
    if (!worked.length) continue;
    const gmv = worked.reduce((a, c) => a + (c.gmv || 0), 0);
    const cost = worked.reduce((a, c) => a + (c.cost || 0), 0);
    const orders = worked.reduce((a, c) => a + (c.orders || 0), 0);
    const live = (liveStats || {})[ch.id] || (liveStats || {})[ch.identityId];
    const days = { ...(out[ch.id] || {}) };
    days[date] = {
      date,
      gmv: Math.round(gmv),
      cost: Math.round(cost),
      orders,
      roi: cost > 0 ? Number((gmv / cost).toFixed(2)) : 0,
      profit: Math.round(gmv - cost),
      mode: channelMode(ch.settings, enabled),
      liveGpm: live ? Math.round(live.gpm || 0) : 0,
      ts: now,
    };
    const keys = Object.keys(days).sort();
    while (keys.length > 30) delete days[keys.shift()];
    out[ch.id] = days;
  }
  return out;
}

// Summarize memory into avg ROI per management mode across a set of campaigns —
// lets the AI (and you) see whether AI/auto actually beats manual.
function summarizeMemory(history, campaignIds) {
  const acc = {};
  for (const id of campaignIds) {
    for (const p of history[id] || []) {
      const m = p.mode || "manual";
      acc[m] = acc[m] || { sumRoi: 0, n: 0, gmv: 0, cost: 0 };
      acc[m].sumRoi += p.roi || 0;
      acc[m].n += 1;
      acc[m].gmv += p.gmv || 0;
      acc[m].cost += p.cost || 0;
    }
  }
  const out = {};
  for (const m of Object.keys(acc)) {
    out[m] = { avgRoi: Number((acc[m].sumRoi / acc[m].n).toFixed(2)), samples: acc[m].n };
  }
  return out;
}
// Rough ROI trend: (latest ROI - ROI a few points ago) / older, so >0 improving,
// <0 declining. Returns 0 when there isn't enough history yet.
function roiTrend(points) {
  if (!points || points.length < 3) return 0;
  const recent = points[points.length - 1].roi;
  const older = points[Math.max(0, points.length - 4)].roi;
  if (older <= 0) return 0;
  return (recent - older) / older;
}

// Minimum spacing between auto-creates on the same channel (safety brake so a
// bad new campaign can't spawn replacements in a tight loop).
const CREATE_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_LOGS = 300;

// Append entries to the persistent activity log (newest first).
async function addLogs(entries) {
  if (!entries || !entries.length) return;
  const { logs = [] } = await chrome.storage.local.get({ logs: [] });
  const stamped = entries.map((e) => ({ ts: Date.now(), ...e }));
  await chrome.storage.local.set({ logs: [...stamped, ...logs].slice(0, MAX_LOGS) });
}

chrome.runtime.onInstalled.addListener(() => { reschedule(); scheduleMidnight(); scheduleDailySummary(); });
chrome.runtime.onStartup.addListener(() => { reschedule(); scheduleMidnight(); scheduleDailySummary(); });

// Schedule the next 00:00 Bangkok (UTC+7) reset.
function scheduleMidnight() {
  const now = Date.now();
  const bkk = new Date(now + 7 * 3600 * 1000); // Bangkok wall-clock via UTC fields
  const nextUtc =
    Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate() + 1, 0, 0, 0) -
    7 * 3600 * 1000;
  chrome.alarms.create("cgmx_midnight", { when: nextUtc });
}

function reschedule() {
  chrome.storage.local.get(KEYS, (s) => {
    const mins = (s.channels || [])
      .map((c) => c.settings?.checkIntervalMin || 5)
      .filter(Boolean);
    const period = Math.max(1, mins.length ? Math.min(...mins) : 5);
    chrome.alarms.clear("cgmx_loop", () =>
      chrome.alarms.create("cgmx_loop", { periodInMinutes: period })
    );
  });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "cgmx_loop") runRules();
  if (a.name === "cgmx_midnight") midnightReset().finally(scheduleMidnight);
  if (a.name === "cgmx_dailysummary") sendDailySummary().finally(scheduleDailySummary);
});

// --- Startup bootstrap ---------------------------------------------------
// MV3 service workers are ephemeral and get torn down when idle; onInstalled /
// onStartup do NOT fire when the worker is merely revived by an event, so the
// loop alarm could be missing (or, right after a reload, its first tick is a
// full period away). This runs on every worker startup: (re)create the alarm
// if it's gone, and kick one immediate run so pausing happens now instead of
// waiting — and so lastRun reflects reality. Guarded so we don't double-run if
// a cycle just happened.
(function bootstrap() {
  chrome.alarms.get("cgmx_loop", (a) => {
    if (!a) reschedule();
  });
  scheduleMidnight();
  scheduleDailySummary();
  chrome.storage.local.get({ lastRun: 0 }, ({ lastRun }) => {
    if (Date.now() - (lastRun || 0) > 45 * 1000) {
      setTimeout(() => {
        runRules().catch((e) => console.error("cgmx bootstrap runRules", e));
      }, 1500);
    }
  });
})();

// Reset each running campaign's budget back to the configured base at midnight.
async function midnightReset() {
  await tabSync();
  const s = await chrome.storage.local.get(KEYS);
  const scaledTs = s.scaledTs || {};
  const done = [];
  for (const ch of s.channels || []) {
    const mr = ch.settings?.midnightReset;
    if (!mr?.enabled || !mr.budget) continue;
    const camps = (s.campaigns || []).filter((c) => channelMatch(c, ch) && statusRunning(c));
    for (const c of camps) {
      if (Math.round(c.budget || 0) === Math.round(mr.budget)) continue;
      const r = await execBudget(c.id, c.name, mr.budget);
      if (r && r.ok) delete scaledTs[c.id]; // let scaling start fresh today
      done.push({ ok: r && r.ok, name: c.name, to: mr.budget });
    }
  }
  await chrome.storage.local.set({ scaledTs });
  if (done.length) {
    await addLogs(done.map((d) => ({ ok: d.ok, text: `🌙 รีเซตงบเที่ยงคืน ${d.name} → ${d.to}฿` })));
    if (s.telegramToken && s.telegramChatId) {
      const okN = done.filter((d) => d.ok).length;
      const text =
        `🌙 รีเซตงบเที่ยงคืน ${okN}/${done.length} แคมเปญ\n` +
        done.map((d) => `${d.ok ? "✅" : "⚠️"} ${d.name} → ${d.to}฿`).join("\n");
      sendTelegram(s.telegramToken, s.telegramChatId, text);
    }
  }
}

// Build a totals summary across all running campaigns and send it to Telegram.
async function sendDailySummary() {
  await tabSync();
  const s = await chrome.storage.local.get(KEYS);
  if (!s.telegramToken || !s.telegramChatId) return;
  const running = (s.campaigns || []).filter((c) => statusRunning(c));
  const sales = running.reduce((a, c) => a + (c.gmv || 0), 0);
  const cost = running.reduce((a, c) => a + (c.cost || 0), 0);
  const orders = running.reduce((a, c) => a + (c.orders || 0), 0);
  const roi = cost > 0 ? sales / cost : 0;
  const text =
    `📊 สรุปยอดวันนี้ (${new Date().toLocaleDateString("th-TH")})\n` +
    `ยอดขาย: ${Math.round(sales).toLocaleString()} ฿\n` +
    `ค่าโฆษณา: ${Math.round(cost).toLocaleString()} ฿\n` +
    `ROI รวม: ${roi.toFixed(2)}\n` +
    `ออร์เดอร์: ${orders}\n` +
    `กำไรคร่าวๆ: ${Math.round(sales - cost).toLocaleString()} ฿\n` +
    `แคมเปญที่รัน: ${running.length}`;
  await sendTelegram(s.telegramToken, s.telegramChatId, text);
}

// Schedule the next daily-summary send at the configured Bangkok hour.
function scheduleDailySummary() {
  chrome.storage.local.get({ dailySummary: { enabled: false, hour: 20 } }, ({ dailySummary }) => {
    if (!dailySummary || !dailySummary.enabled) {
      chrome.alarms.clear("cgmx_dailysummary");
      return;
    }
    const hour = Number(dailySummary.hour) || 20;
    const now = Date.now();
    const bkk = new Date(now + 7 * 3600 * 1000);
    let nextUtc =
      Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate(), hour, 0, 0) - 7 * 3600 * 1000;
    if (nextUtc <= now) nextUtc += 24 * 3600 * 1000;
    chrome.alarms.create("cgmx_dailysummary", { when: nextUtc });
  });
}

// A campaign is "running/on" per its opt-status flag (set in mapCampaigns);
// fall back to the status string for older cached data.
function statusRunning(c) {
  if (c && typeof c.on === "boolean") return c.on;
  const t = String(c && c.status).toUpperCase();
  return t === "1" || t.includes("ENABLE");
}

// A campaign belongs to a channel if its identity id matches the channel id or
// the channel's identity id, or (last resort) the channel name matches.
function channelMatch(c, ch) {
  const cid = String(c.channelId || "");
  if (cid && (cid === String(ch.id) || cid === String(ch.identityId || ""))) return true;
  if (c.channelName && ch.name && c.channelName === ch.name) return true;
  return false;
}

// Marginal ROI over the last `windowMin` minutes: the ROI of the money spent
// recently, from the per-campaign history snapshots. The cumulative ROI
// (gmv/cost over the whole session) lags badly — early good sales prop it up,
// so it can stay above the threshold long after recent spend has gone bad. This
// looks only at the delta since ~windowMin ago, so the rule reacts fast.
// Returns null when there isn't a snapshot old enough or too little recent
// spend to judge (also naturally handles the midnight reset -> negative delta).
function windowRoi(points, now, windowMin, curCost, curGmv) {
  if (!points || points.length < 2 || !(windowMin > 0)) return null;
  const cutoff = now - windowMin * 60 * 1000;
  let base = null;
  for (const p of points) {
    if (p.ts <= cutoff) base = p; // latest snapshot at/older than cutoff
    else break; // snapshots are chronological
  }
  if (!base) return null; // campaign younger than the window — fall back to cumulative
  const dCost = curCost - (base.cost || 0);
  const dGmv = curGmv - (base.gmv || 0);
  if (dCost < 5) return null; // <5฿ spent in the window — not enough signal
  return { roi: dCost > 0 ? dGmv / dCost : 0, dCost: Math.round(dCost), dGmv: Math.round(dGmv), mins: windowMin };
}

// Evaluate the manual pause rules for one running campaign. `points` is this
// campaign's history (for recent-window ROI). Returns:
//   { hit }  — a reason string when a pause trigger fires (else null)
//   { diag } — a short, stable Thai note explaining the decision either way,
//              so the activity log can show WHY a campaign wasn't paused.
function evalPause(c, st, points, now) {
  const T = st.triggers || {};
  const minB = st.minBudgetBeforeCheck || 0;
  const cpo = c.orders > 0 ? c.cost / c.orders : c.cost;
  if (c.cost < minB)
    return { hit: null, diag: `รอเก็บข้อมูล: ใช้งบยังไม่ถึงขั้นต่ำ ${minB}฿` };
  if (!(T.roi?.on || T.cost?.on || T.spentNoOrder?.on))
    return { hit: null, diag: "ยังไม่ได้เปิดกฎปิดแอดสักข้อ" };
  // ROI rule: react to RECENT (marginal) ROI first, then the cumulative one.
  // We gate on spend, not roi>0, so a burning campaign with zero GMV is caught.
  const win = st.roiWindowMin ?? 0; // 0 = cumulative (on-screen) ROI only, as expected
  if (T.roi?.on && c.cost > 0) {
    const w = windowRoi(points, now || Date.now(), win, c.cost, c.gmv);
    if (w && w.roi < T.roi.value)
      return { hit: `ROI ${w.mins}น.ล่าสุด ${w.roi.toFixed(1)} < ${T.roi.value} (ใช้ ${w.dCost}฿ ได้ ${w.dGmv}฿)`, diag: "" };
    if (c.roi < T.roi.value)
      return { hit: `ROI สะสม ${c.roi.toFixed(2)} < ${T.roi.value}`, diag: "" };
  }
  if (T.cost?.on && cpo > T.cost.value)
    return { hit: `ต้นทุน/ซื้อ ${cpo.toFixed(0)} > ${T.cost.value}`, diag: "" };
  if (T.spentNoOrder?.on && c.orders === 0 && c.cost > T.spentNoOrder.value)
    return { hit: `ใช้งบ ${c.cost.toFixed(0)} แต่ไม่มีออร์เดอร์`, diag: "" };
  // Nothing fired — describe how close each active rule is (rounded, so the
  // note stays stable across cycles and doesn't spam the log).
  const w = T.roi?.on ? windowRoi(points, now || Date.now(), win, c.cost, c.gmv) : null;
  const parts = [];
  if (T.roi?.on)
    parts.push(w ? `ROI ${w.mins}น. ${w.roi.toFixed(0)} (ปิด <${T.roi.value})` : `ROI สะสม ${c.roi.toFixed(0)} (ปิด <${T.roi.value})`);
  if (T.cost?.on) parts.push(`ต้นทุน/ซื้อ ${Math.round(cpo / 10) * 10} (ปิด >${T.cost.value})`);
  if (T.spentNoOrder?.on) parts.push(`${c.orders} ออร์เดอร์`);
  return { hit: null, diag: `ยังไม่เข้าเงื่อนไขปิด: ${parts.join(", ")}` };
}

// Send a message to the TikTok tab's content script. If the content script is
// missing/orphaned (e.g. after an extension reload — "message port closed"),
// re-inject content.js and retry once. This keeps automation working without
// the user having to manually refresh the TikTok tab.
function sendTab(msg) {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: "https://ads.tiktok.com/*" }, (tabs) => {
      if (!tabs.length) return resolve({ ok: false, error: "no tiktok tab" });
      const tabId = tabs[0].id;
      chrome.tabs.sendMessage(tabId, msg, (r) => {
        if (!chrome.runtime.lastError) return resolve(r);
        // Orphaned/absent content script — inject a fresh copy and retry.
        chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }, () => {
          if (chrome.runtime.lastError)
            return resolve({ ok: false, error: "inject: " + chrome.runtime.lastError.message });
          chrome.tabs.sendMessage(tabId, msg, (r2) =>
            resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r2)
          );
        });
      });
    });
  });
}

/* ---------------- Direct TikTok API (runs in the service worker) ----------------
   Actions (pause / budget / ROI / create) call TikTok's internal endpoints
   straight from the background using the site cookies + CSRF token, so they no
   longer depend on messaging a content script (which broke with "port closed"
   after extension reloads). */
const API = {
  DETAIL: "/api/oec_shopping/v1/creation/all_ad_data/detail",
  CREATE: "/api/oec_shopping/v1/creation/all_ad_data/create",
  UPDATE: "/api/oec_shopping/v1/creation/all_ad_data/update",
  STATUS: "/api/oec_shopping/v1/creation/campaign/update_status",
};
function apiCtxParams(ctx) {
  return { locale: "th", language: "th", oec_seller_id: ctx.oec_seller_id, aadvid: ctx.aadvid, bc_id: ctx.bc_id };
}
function apiBuildUrl(path, params) {
  const u = new URL("https://ads.tiktok.com" + path);
  for (const [k, v] of Object.entries(params || {}))
    if (v !== null && v !== undefined && v !== "") u.searchParams.set(k, v);
  u.searchParams.set("_t", Date.now());
  return u.toString();
}
function apiCsrf() {
  return new Promise((res) => {
    try {
      chrome.cookies.get({ url: "https://ads.tiktok.com", name: "csrftoken" }, (c) => res((c && c.value) || ""));
    } catch {
      res("");
    }
  });
}
async function apiFetch(url, opts = {}) {
  const csrf = await apiCsrf();
  const headers = { "Content-Type": "application/json", "X-Csrftoken": csrf, ...(opts.headers || {}) };
  const r = await fetch(url, { credentials: "include", ...opts, headers });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return { __nonjson: true, status: r.status, body: t.slice(0, 300) };
  }
}
async function apiCtx() {
  return (await chrome.storage.local.get({ ctx: null })).ctx;
}
function apiRiskInfo() {
  return {
    cookie_enabled: true, screen_width: 1920, screen_height: 1080,
    browser_language: "th-TH", browser_platform: (self.navigator && navigator.platform) || "Win32",
    browser_name: "Mozilla", browser_version: (self.navigator && navigator.userAgent) || "Mozilla/5.0",
    browser_online: true, timezone_name: "Asia/Bangkok",
  };
}
async function apiGetDetail(ctx, campaignId) {
  const j = await apiFetch(apiBuildUrl(API.DETAIL, { ...apiCtxParams(ctx), campaign_id: campaignId }), { method: "GET" });
  return j && j.data ? j.data : null;
}
async function apiUpdate(ctx, campaignId, opts) {
  const detail = opts.detail || (await apiGetDetail(ctx, campaignId));
  if (!detail || !detail.ad_info) return { ok: false, error: "อ่านรายละเอียดแคมเปญไม่ได้" };
  const ad = detail.ad_info;
  // budget must be a NUMBER (TikTok rejects the "100.00" string form).
  const bud = opts.budget != null ? Math.round(Number(opts.budget)) : Math.round(Number(ad.budget) || 0);
  const roasBid = opts.roi != null ? parseFloat(Number(opts.roi).toFixed(1)) : ad.roas_bid;
  const pds = ad.promotion_days_setting || {};
  const mult = pds.budget_multiplier || 150;
  const payload = {
    campaign_info: {
      campaign_id: campaignId,
      campaign_name: (detail.campaign_info && detail.campaign_info.campaign_name) || ad.campaign_name || "",
      budget_mode: -1, budget: bud, shop_automation_type: 2, shop_image_aigc_mode: 0, gmv_roi_mode: 0,
    },
    ad_info: {
      ...ad,
      campaign_id: campaignId, ad_id: ad.ad_id || "", budget_mode: 0, budget: bud, roas_bid: roasBid,
      product_platform_id: ad.product_platform_id ?? "0",
      shop_id: ctx.oec_seller_id, shop_authorized_bc: ad.shop_authorized_bc || ctx.bc_id,
      audience: ad.audience || { brand_safety: 1 },
      promotion_days_setting: { ...pds, adjusted_budget: ((bud * mult) / 100).toFixed(2) },
      // keep the campaign's own gmax_budget_adjust_setting (incl. effective_budget) as-is.
    },
    risk_info: apiRiskInfo(),
  };
  const j = await apiPostRetry(apiBuildUrl(API.UPDATE, apiCtxParams(ctx)), { method: "POST", body: JSON.stringify(payload) });
  return { ok: j && j.code === 0, code: j && j.code, msg: j && j.msg, resp: j };
}
function apiParseMinBudget(resp) {
  const s = String((resp && (resp.msg || (resp.extra && resp.extra.system_msg) || resp.message)) || "");
  // TikTok TH writes the amount as "100.00฿" (number first); others as "฿100".
  const m = s.match(/([\d,]+(?:\.\d+)?)\s*฿/) || s.match(/฿\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ""));
  return isNaN(v) ? null : v;
}
// Lower a campaign's budget as far as TikTok allows. TikTok rejects a too-low
// budget with the required amount in the message (the daily minimum, e.g. 100฿,
// or the amount already spent, e.g. 186฿ — you can't set below what's spent).
// Keep retrying at whatever amount it asks for until accepted.
async function apiReduceToMin(ctx, campaignId, campaignName) {
  // Fetch the campaign detail once, then reuse it for each retry (fast).
  const detail = await apiGetDetail(ctx, campaignId);
  if (!detail || !detail.ad_info) return { ok: false, error: "อ่านรายละเอียดแคมเปญไม่ได้" };
  let target = 100; // start at the known daily floor; bump up only if TikTok asks
  let last = null;
  for (let i = 0; i < 5; i++) {
    const r = await apiUpdate(ctx, campaignId, { budget: target, campaignName, detail });
    if (r.ok) return { ok: true, budget: target, retried: i };
    last = r;
    const need = apiParseMinBudget(r.resp);
    if (need == null || Math.ceil(need) <= target)
      return { ok: false, error: r.msg || r.error || "ตั้งงบต่ำสุดไม่ได้", resp: r.resp };
    target = Math.ceil(need);
  }
  return { ok: false, error: (last && (last.msg || last.error)) || "ลองหลายครั้งแล้วยังไม่ได้", resp: last && last.resp };
}
async function apiSetStatus(ctx, campaignId, operation) {
  const j = await apiPostRetry(apiBuildUrl(API.STATUS, apiCtxParams(ctx)), {
    method: "POST", body: JSON.stringify({ campaign_list: [String(campaignId)], operation }),
  });
  return { ok: j && j.code === 0, code: j && j.code, msg: j && j.msg, resp: j };
}
function apiPad2(n) { return String(n).padStart(2, "0"); }
function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }
// POST that retries TikTok's "optimistic locking" rejection (code 6 — "don't
// use simultaneous requests / decrease your request frequency"), which happens
// when pause/reduce/create hit the same campaign in quick succession. Back off
// and retry a few times before giving up.
async function apiPostRetry(url, opts, tries = 3) {
  let j = await apiFetch(url, opts);
  let i = 0;
  while (j && j.code === 6 && i < tries) {
    await sleep(800 * (i + 1));
    j = await apiFetch(url, opts);
    i++;
  }
  return j;
}
function apiBuildCreate(detail, ctx, roi, budget, accountName) {
  const ad = (detail && detail.ad_info) || {};
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2), MM = apiPad2(now.getMonth() + 1), dd = apiPad2(now.getDate());
  const hh = apiPad2(now.getHours()), mm = apiPad2(now.getMinutes()), ss = apiPad2(now.getSeconds());
  const bud = Number(budget);
  const identityList = ad.identity_list && ad.identity_list.length
    ? ad.identity_list : [{ tt_uid: ad.template_ad_identity_id || "", identity_type: 8 }];
  return {
    campaign_info: {
      campaign_id: "", campaign_name: `${yy}/${MM}/${dd} - ${accountName || "ช่อง"} - ${hh}${mm}${ss}`,
      budget_mode: 0, budget: bud, shop_automation_type: 2, shop_image_aigc_mode: 0,
    },
    ad_info: {
      name: `adgroup_${now.getFullYear()}${MM}${dd}_${hh}${mm}${ss}`, campaign_id: "", ad_id: "",
      inventory_flow_type: ad.inventory_flow_type || 1, inventory_flow: ad.inventory_flow || [3000],
      shopping_inventory_type: ad.shopping_inventory_type || 1, external_type: ad.external_type ?? 0,
      is_comment_disable: 0, schedule_type: 1,
      start_time: `${now.getFullYear()}-${MM}-${dd} ${hh}:${mm}:${ss}`,
      flow_control_mode: ad.flow_control_mode || 0, budget_mode: 0, budget: bud,
      product_video_selection_type: 1, pricing: ad.pricing || 9, cpa_skip_first_phrase: ad.cpa_skip_first_phrase || 0,
      optimize_goal: ad.optimize_goal || 111, external_action: ad.external_action ?? 0, deep_bid_type: ad.deep_bid_type || 108,
      roas_bid: parseFloat(Number(roi).toFixed(1)), product_platform_id: "", country: "TH",
      shop_id: ctx.oec_seller_id, ...(ad.shop_type ? { shop_type: ad.shop_type } : {}),
      shop_authorized_bc: ad.shop_authorized_bc || ctx.bc_id, promotion_flow_type: 2,
      product_source: ad.product_source ?? 0, product_bid_type: ad.product_bid_type ?? 0,
      custom_tz_id: ad.custom_tz_id || "7473426712694374408", custom_tz_type: ad.custom_tz_type ?? 2,
      promotion_days_setting: {
        is_enable: false, automode_enable: true, custom_schedules: [], roas_bid_multiplier: 90, budget_multiplier: 150,
        adjusted_roas_bid: (Number(roi) * 0.9).toFixed(1), adjusted_budget: (bud * 1.5).toFixed(2), benchmark_roas_bid: Number(roi),
      },
      compensation_activity_type: ad.compensation_activity_type ?? 3,
      gmax_budget_adjust_setting: {
        strategy: ad.gmax_budget_adjust_setting?.strategy || 2,
        auto_budget_switch: ad.gmax_budget_adjust_setting?.auto_budget_switch ?? false,
        auto_budget_adjust_config: ad.gmax_budget_adjust_setting?.auto_budget_adjust_config || { adjust_ratio: 0.5, max_daily_adjust_times: 10 },
        promotion_day_adjust_config: ad.gmax_budget_adjust_setting?.promotion_day_adjust_config || { adjust_ratio: 0.5, max_daily_adjust_times: 10 },
      },
      identity_list: identityList, enable_shop_video_exclusion_filter: true, shop_video_filters: [],
      pre_item_list: [], shop_live_video_identity_list: [], key_live_days: [],
    },
    risk_info: apiRiskInfo(),
  };
}
async function apiCreate(ctx, templateCampaignId, roi, budget, accountName) {
  const detail = await apiGetDetail(ctx, templateCampaignId);
  if (!detail || !detail.ad_info) return { ok: false, error: "อ่านรายละเอียดแคมเปญต้นแบบไม่ได้" };
  // Create can fail intermittently right after a pause: the channel may still
  // be held by the just-paused campaign (GMV Max = one campaign per channel),
  // or the request collides. Retry a few times with backoff so it succeeds once
  // the channel frees up, instead of giving up and leaving the channel empty.
  // apiBuildCreate stamps a fresh HHMMSS name each attempt, so names stay unique.
  let last = null;
  for (let i = 0; i < 3; i++) {
    if (i > 0) await sleep(1500 * i);
    const j = await apiPostRetry(apiBuildUrl(API.CREATE, apiCtxParams(ctx)), {
      method: "POST", body: JSON.stringify(apiBuildCreate(detail, ctx, roi, budget, accountName)),
    });
    last = j;
    if (j && j.code === 0) return { ok: true, code: 0, msg: j.msg, resp: j, tries: i + 1 };
  }
  return { ok: false, code: last && last.code, msg: last && last.msg, resp: last };
}
function execOnTikTok(req) {
  return sendTab({ type: "CGMX_EXEC", req });
}
// Ask the content script to refresh channels + campaigns from TikTok.
function tabSync() {
  return sendTab({ type: "CGMX_SYNC" });
}
// Change a campaign's budget (direct fetch from the service worker).
async function execBudget(campaignId, campaignName, budget) {
  const ctx = await apiCtx();
  if (!ctx || !ctx.aadvid) return { ok: false, error: "ยังไม่มี context — เปิดหน้า GMV Max ให้โหลดก่อน" };
  return apiUpdate(ctx, campaignId, { budget, campaignName });
}
// Drop a campaign's budget to the minimum (before pausing).
async function execMinBudget(campaignId, campaignName) {
  const ctx = await apiCtx();
  if (!ctx || !ctx.aadvid) return { ok: false, error: "ยังไม่มี context — เปิดหน้า GMV Max ให้โหลดก่อน" };
  return apiReduceToMin(ctx, campaignId, campaignName);
}
// Change a campaign's ROI target (roas_bid).
async function execRoi(campaignId, campaignName, roi) {
  const ctx = await apiCtx();
  if (!ctx || !ctx.aadvid) return { ok: false, error: "ยังไม่มี context — เปิดหน้า GMV Max ให้โหลดก่อน" };
  return apiUpdate(ctx, campaignId, { roi, campaignName });
}

// Create a new campaign by cloning a template campaign, with a new ROI + budget.
async function execCreate(templateCampaignId, channelId, roi, budget) {
  const ctx = await apiCtx();
  if (!ctx || !ctx.aadvid) return { ok: false, error: "ยังไม่มี context — เปิดหน้า GMV Max ให้โหลดก่อน" };
  const s = await chrome.storage.local.get({ campaigns: [] });
  const camps = s.campaigns || [];
  let tid = templateCampaignId, accountName = "";
  if (tid) {
    const found = camps.find((c) => String(c.id) === String(tid));
    if (found) accountName = found.channelName;
  } else {
    const match = camps.find((c) => String(c.channelId) === String(channelId)) || camps[0];
    if (match) { tid = match.id; accountName = match.channelName; }
  }
  if (!tid) return { ok: false, error: "ไม่มีแคมเปญต้นแบบให้โคลน — กด Sync ให้เจอแคมเปญก่อน" };
  return apiCreate(ctx, tid, roi, budget, accountName);
}

// Pause (operation 2) / enable (operation 1) a campaign — direct fetch.
async function execStatus(campaignId, operation) {
  const ctx = await apiCtx();
  if (!ctx || !ctx.aadvid) return { ok: false, error: "ยังไม่มี context — เปิดหน้า GMV Max ให้โหลดก่อน" };
  return apiSetStatus(ctx, campaignId, operation);
}

/* ------------------------- LLM advisor (OpenAI / ChatGPT) ------------------------- */

// Build a compact snapshot of a channel for the model: the goal, the ads
// campaigns, and the rich live-dashboard signals.
function buildAISnapshot(ch, st, campaigns, liveInfo, history, memoryDays, scaledTs, now) {
  const chCampaigns = campaigns.filter((c) => channelMatch(c, ch));
  const scaleCdMin = Number(st.autopilot?.scaleCooldownMin) || 15;
  const nowTs = now || Date.now();
  const camps = chCampaigns
    .map((c) => {
      const last = (scaledTs || {})[c.id];
      const minsSinceScale = last ? Math.round((nowTs - last) / 60000) : null;
      return {
        id: c.id,
        name: (c.name || "").slice(0, 40),
        delivering: !!c.delivering,
        budget: Math.round(c.budget || 0),
        spent: Math.round(c.cost || 0),
        gmv: Math.round(c.gmv || 0),
        roi: Number((c.roi || 0).toFixed(2)),
        orders: c.orders || 0,
        roiTarget: c.targetRoi || 0,
        // How long since this campaign's budget was last scaled up, and whether
        // it's still inside the cooldown window (so the model holds instead of
        // stacking scale-ups).
        minsSinceScale,
        canScaleNow: minsSinceScale == null || minsSinceScale >= scaleCdMin,
      };
    });
  const dailySpent = Math.round(camps.reduce((a, c) => a + c.spent, 0));
  return {
    goal: {
      targetRoi: Number(st.autopilot?.targetRoi) || 20,
      maxDailySpend: Number(st.autopilot?.maxDailySpend) || 0,
      dailySpent,
      minBudget: 100,
      scaleCooldownMin: scaleCdMin,
    },
    channel: ch.name,
    campaigns: camps,
    live: liveInfo
      ? {
          isLive: !!liveInfo.isLive,
          gmv: Math.round(liveInfo.gmv || 0),
          sales: liveInfo.sales || 0,
          currentViewers: liveInfo.currentViewers || 0,
          totalViewers: liveInfo.viewers || 0,
          gpm: Math.round(liveInfo.gpm || 0),
          adsCost: Math.round(liveInfo.adsCost || 0),
          ctr: liveInfo.ctr || 0,
          avgViewDuration: liveInfo.avgViewDuration || 0,
          trend: liveInfo.trend?.dir || "unknown",
          trafficSources: liveInfo.trafficSources || [],
          topProducts: liveInfo.topProducts || [],
        }
      : null,
    // Learned memory: average ROI seen under each management mode (manual vs
    // ai vs auto), so the model can judge whether AI management is helping.
    memory: summarizeMemory(history || {}, chCampaigns.map((c) => c.id)),
    // Long-term per-channel daily history (last ~10 days) for cross-live learning.
    recentDays: Object.values(memoryDays || {})
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 10)
      .map((dd) => ({ date: dd.date, roi: dd.roi, profit: dd.profit, mode: dd.mode, gpm: dd.liveGpm })),
  };
}

const AI_SYSTEM_PROMPT =
  "You are an expert TikTok LIVE GMV Max ads optimizer. You are given a JSON snapshot: a goal (target ROI, max daily spend, current daily spend), the ad campaigns, and rich live-stream signals (GMV, GPM, viewers, CTR, view duration, GMV trend, traffic sources, top products). Decide actions to MAXIMIZE profit while keeping ROI at/above the target and NEVER letting the channel's daily spend exceed maxDailySpend. " +
  "Only act on campaigns where delivering=true. Allowed actions: 'scale_up' (raise budget; provide new budget, must be > current and keep dailySpent under maxDailySpend), 'pause' (turn off a losing/failing campaign), 'set_roi' (change the ROI bid, 1-10), 'hold' (do nothing). Budget must be >= 100. Prefer scaling winners when the live is hot (rising trend, strong GPM, ad-driven traffic converting) and pausing losers (ROI<1, spend with no orders, or cooling live). " +
  "IMPORTANT: while the live is active (live.isLive=true), when you 'pause' a delivering campaign the system automatically creates a fresh replacement campaign, so the live keeps selling — pause losers freely to reset a bad campaign. The 'memory' field shows average ROI historically achieved under each management mode (manual/ai/auto); use it to sanity-check your strategy. " +
  "PACING: do NOT scale the same campaign repeatedly in a short window. Each campaign carries 'minsSinceScale' (minutes since its budget was last raised) and 'canScaleNow'; goal.scaleCooldownMin is the minimum spacing between scale-ups. If canScaleNow is false, do NOT 'scale_up' that campaign — 'hold' instead and let the new budget prove itself first. When you do scale a winner, take one meaningful step, not many tiny ones. " +
  'Reply with ONLY valid JSON, no markdown: {"analysis":"<2-3 sentences in Thai>","decisions":[{"campaignId":"<id>","action":"scale_up|pause|set_roi|hold","budget":<number optional>,"roi":<number optional>,"reason":"<short Thai>"}]}';

async function callLLM(apiKey, model, snapshot) {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: AI_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(snapshot) },
        ],
      }),
    });
    const j = await res.json();
    if (!res.ok) return { error: (j.error && j.error.message) || "HTTP " + res.status };
    const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!content) return { error: "ไม่มีคำตอบจาก AI" };
    try {
      const parsed = JSON.parse(content);
      return { analysis: parsed.analysis || "", decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [] };
    } catch {
      return { error: "แปลงคำตอบ AI ไม่ได้", raw: content.slice(0, 300) };
    }
  } catch (e) {
    return { error: String(e) };
  }
}

// Apply the model's decisions, clamped by the guardrails (never exceed the cap,
// never below the minimum, ROI bounded), acting only on delivering campaigns.
async function applyAIDecisions(ch, st, decisions, campaigns, trackers, now, liveInfo) {
  const { acted, scaledTs, roiTs, createdTs } = trackers;
  const target = Number(st.autopilot?.targetRoi) || 20;
  const cap = Number(st.autopilot?.maxDailySpend) || 0;
  const chCamps = campaigns.filter((c) => channelMatch(c, ch));
  const dailySpent = chCamps.reduce((a, c) => a + (c.cost || 0), 0);
  const out = [];
  for (const d of decisions || []) {
    const c = chCamps.find((x) => String(x.id) === String(d.campaignId));
    if (!c || !statusRunning(c)) continue;
    const budget = c.budget || 0;
    if (d.action === "scale_up") {
      // Space out scale-ups: honour the same cooldown as the rules engine so
      // the model can't ramp budget every cycle when ROI looks good.
      const scaleCdMs = (st.autopilot?.scaleCooldownMin || 15) * 60 * 1000;
      if (scaledTs[c.id] && now - scaledTs[c.id] < scaleCdMs) {
        const waitMin = Math.ceil((scaleCdMs - (now - scaledTs[c.id])) / 60000);
        out.push({ ok: true, name: `🧠 AI คงงบ ${c.name}`, reason: `เพิ่งสเกลไป รออีก ${waitMin} นาที` });
        continue;
      }
      let next = Math.round(Number(d.budget) || budget * 1.25);
      if (cap > 0) next = Math.min(next, budget + Math.max(0, Math.round(cap - dailySpent)));
      next = Math.max(next, 100);
      if (next > budget) {
        const r = await execBudget(c.id, c.name, next);
        if (r && r.ok) scaledTs[c.id] = now;
        out.push({ ok: r && r.ok, name: `🧠 AI ดันงบ ${c.name}`, reason: `${budget}→${next}฿ · ${d.reason || ""}` });
      }
    } else if (d.action === "pause") {
      if (acted[c.id] && now - acted[c.id] < 30 * 60 * 1000) continue;
      const res = await execStatus(c.id, 2);
      acted[c.id] = now;
      if (res && res.ok) await execMinBudget(c.id, c.name);
      out.push({ ok: res && res.ok, name: `🧠 AI ปิด ${c.name}`, reason: d.reason || "" });
      // Keep the live selling: if the room is still live, create a fresh
      // replacement (respecting the create cooldown) instead of leaving it dead.
      const liveOn = !liveInfo || liveInfo.isLive !== false;
      if (res && res.ok && st.actions?.createNew && liveOn && createdTs &&
          !(createdTs[ch.id] && now - createdTs[ch.id] < CREATE_COOLDOWN_MS)) {
        const cr = await execCreate(c.id, ch.id, st.actions.createRoi || target, st.actions.createBudget || 300);
        if (cr && cr.ok) createdTs[ch.id] = now;
        out.push({
          ok: cr && cr.ok,
          name: `↳ AI สร้างใหม่ ${ch.name}`,
          reason: cr && cr.ok ? `ROI ${st.actions.createRoi || target}, งบ ${st.actions.createBudget || 300}฿` : `ไม่สำเร็จ: ${(cr && (cr.error || cr.msg)) || "?"}`,
        });
      }
    } else if (d.action === "set_roi") {
      const roi = Math.max(1, Math.min(10, Number(d.roi) || target));
      const r = await execRoi(c.id, c.name, roi);
      if (r && r.ok) roiTs[c.id] = now;
      out.push({ ok: r && r.ok, name: `🧠 AI ปรับ ROI ${c.name}`, reason: `→${roi} · ${d.reason || ""}` });
    }
  }
  return out;
}

async function runRules() {
  // Always refresh data from TikTok first — this keeps the panel's numbers and
  // "last synced" time current every interval, regardless of the master toggle.
  await tabSync();
  const s = await chrome.storage.local.get(KEYS);
  const nowTs = Date.now();
  // Record memory EVERY cycle — including when the program is off and you manage
  // by hand — so the AI can later learn manual vs AI outcomes. Memory-keeping is
  // best-effort: it must NEVER throw and block the money-critical pause/act path
  // below (a missing helper here once stalled the whole engine).
  let history = s.history || {};
  let channelMemory = s.channelMemory || {};
  try {
    history = recordHistory(s.history || {}, s.campaigns || [], s.channels || [], s.enabled, nowTs);
    channelMemory = updateChannelMemory(s.channelMemory || {}, s.channels || [], s.campaigns || [], s.liveStats || {}, s.enabled, nowTs);
  } catch (e) {
    console.error("cgmx memory update failed (continuing):", e);
  }
  if (!s.enabled) {
    // Program is off — no pause/create will run. Note it once (deduped) so the
    // "ทำไมแอดไม่ปิด" answer is visible in the log instead of silent.
    const pd = s.pauseDiag || {};
    if (pd.__master !== "off") {
      await addLogs([{ ok: false, text: "⛔ โปรแกรมปิดอยู่ (สวิตช์หลัก) จึงไม่ควบคุม/ปิดแอดให้ — เปิดสวิตช์ก่อน" }]);
    }
    await chrome.storage.local.set({ history, channelMemory, lastRun: nowTs, pauseDiag: { __master: "off" } });
    return; // only ACT (pause/create) when the program is on
  }
  const acted = s.actedIds || {};
  const createdTs = s.createdTs || {};
  const scaledTs = s.scaledTs || {};
  const roiTs = s.roiTs || {};
  const now = Date.now();
  const actions = [];
  // "Why not paused" diagnostics: written to the log (not Telegram) and only
  // when the note changes, so you can always see what the manual rules decided.
  const prevDiag = s.pauseDiag || {};
  const nextDiag = {};
  const diags = [];
  const note = (key, msg, ok) => {
    nextDiag[key] = msg;
    if (prevDiag[key] !== msg) diags.push({ ok: ok !== false, text: msg });
  };
  // Live per-campaign readout, rebuilt every cycle (overwritten, not appended),
  // so the panel can show EXACTLY what was read and decided this minute.
  const scan = [];
  const scanRow = (chn, c, st, decision) => {
    const T = st.triggers || {};
    scan.push({
      ch: chn.name, name: c.name, id: c.id,
      roi: Number((c.roi || 0).toFixed(2)),
      gmv: Math.round(c.gmv || 0), cost: Math.round(c.cost || 0),
      orders: c.orders || 0, budget: Math.round(c.budget || 0),
      cpo: Math.round(c.cpo || (c.orders > 0 ? c.cost / c.orders : c.cost) || 0),
      roiThr: T.roi?.on ? T.roi.value : null,
      costThr: T.cost?.on ? T.cost.value : null,
      noOrderThr: T.spentNoOrder?.on ? T.spentNoOrder.value : null,
      decision, ts: now,
    });
  };

  for (const ch of s.channels || []) {
    const st = ch.settings || {};
    if (st.autopilot?.enabled) {
      // autopilot handles this channel — still show it in the scan so the
      // readout isn't mysteriously empty.
      for (const c of (s.campaigns || []).filter((x) => channelMatch(x, ch) && statusRunning(x)))
        scanRow(ch, c, st, "🤖 ออโต้ไพลอตดูแลช่องนี้");
      continue;
    }
    const camps = (s.campaigns || []).filter((c) => channelMatch(c, ch));
    const running = camps.filter((c) => statusRunning(c));
    if (!st.actions?.pause) {
      // Pausing is off for this channel — surface it so "ไม่ปิดให้" isn't a mystery.
      if (running.length) note(`ch:${ch.id}`, `⚪ ${ch.name}: ยังไม่ได้เปิด "ปิดแอดอัตโนมัติ" จึงไม่ปิดให้`, false);
      for (const c of running) scanRow(ch, c, st, '⚪ ยังไม่เปิด "ปิดแอดอัตโนมัติ"');
      continue;
    }
    for (const c of running) {
      if (acted[c.id] && now - acted[c.id] < 30 * 60 * 1000) {
        const mins = Math.ceil((30 * 60 * 1000 - (now - acted[c.id])) / 60000);
        nextDiag[c.id] = `cooldown`; // recently acted — stay quiet this window
        scanRow(ch, c, st, `💤 เพิ่งจัดการไป รออีก ${mins} นาที`);
        continue;
      }
      const { hit, diag } = evalPause(c, st, history[c.id], now);
      if (!hit) {
        note(c.id, `🔎 ${c.name} — ${diag}`);
        scanRow(ch, c, st, `⏳ ${diag}`);
        continue;
      }
      const reason = hit;
      scanRow(ch, c, st, `🔴 เข้าเงื่อนไขปิด: ${hit}`);
      const res = await execStatus(c.id, 2); // 2 = pause FIRST
      acted[c.id] = now;
      actions.push({ ok: res && res.ok, name: c.name, reason });
      // Then drop the budget to the minimum — TikTok only allows lowering the
      // budget once the campaign is paused. This stops a high (scaled-up)
      // budget from continuing to spend after the pause. Small gap first so the
      // pause is committed before we modify the same campaign (avoids the
      // "optimistic locking" concurrent-modification rejection).
      if (res && res.ok && st.actions?.reduceBudgetBeforePause !== false) {
        await sleep(700);
        const mb = await execMinBudget(c.id, c.name);
        actions.push({
          ok: mb && mb.ok,
          name: `↓ ลดงบหลังปิด ${c.name}`,
          reason: mb && mb.ok ? `เหลือ ${mb.budget}฿` : `ไม่สำเร็จ: ${(mb && (mb.error || mb.msg)) || "?"}`,
        });
      }

      // Optionally create a fresh campaign to replace the paused one, cloning
      // the campaign we just paused as the template. This keeps the loop going
      // (pause → create → monitor → repeat) while a rate limit prevents runaway
      // spawning if a brand-new campaign immediately underperforms.
      if (res && res.ok && st.actions?.createNew) {
        if (createdTs[ch.id] && now - createdTs[ch.id] < CREATE_COOLDOWN_MS) {
          actions.push({ ok: true, name: "↳ ข้ามการสร้างใหม่", reason: "เพิ่งสร้างไปเมื่อครู่ (กันสร้างรัว)" });
        } else {
          await sleep(700); // let the pause/reduce settle before creating (avoids lock/mutex clash)
          const cr = await execCreate(c.id, ch.id, st.actions.createRoi, st.actions.createBudget);
          if (cr && cr.ok) createdTs[ch.id] = now;
          actions.push({
            ok: cr && cr.ok,
            name: `↳ สร้างใหม่ (ROI ${st.actions.createRoi}, งบ ${st.actions.createBudget}฿)`,
            reason: cr && cr.ok
              ? `สำเร็จ${cr.tries > 1 ? ` (ลอง ${cr.tries} ครั้ง)` : ""}`
              : `ไม่สำเร็จ [code ${(cr && cr.code) ?? "?"}]: ${(cr && (cr.msg || cr.error)) || "?"}`,
          });
        }
      }
    }
  }

  // --- Budget scaling: grow the budget of running (healthy) campaigns. ---
  for (const ch of s.channels || []) {
    const st = ch.settings || {};
    if (st.autopilot?.enabled) continue; // autopilot handles this channel
    const sc = st.scaling || {};
    if (!sc.enabled) continue;
    const camps = (s.campaigns || []).filter((c) => channelMatch(c, ch) && statusRunning(c));
    for (const c of camps) {
      const budget = c.budget || 0;
      if (budget <= 0) continue;
      const intervalMs = (sc.intervalMin || 15) * 60 * 1000;
      if (scaledTs[c.id] && now - scaledTs[c.id] < intervalMs) continue;
      const usedPct = (c.cost / budget) * 100;
      // "time" mode scales every interval; otherwise scale once the used-budget
      // threshold is reached.
      const shouldScale = sc.mode === "time" ? true : usedPct >= (sc.whenUsedPercent || 50);
      if (!shouldScale) continue;
      let next = sc.scaleType === "percent" ? budget * (1 + (sc.amount || 0) / 100) : budget + (sc.amount || 0);
      next = Math.round(next);
      if (sc.cap && sc.cap > 0) next = Math.min(next, sc.cap);
      if (next <= budget) continue; // already at/over the cap
      const r = await execBudget(c.id, c.name, next);
      if (r && r.ok) scaledTs[c.id] = now;
      actions.push({
        ok: r && r.ok,
        name: `↗ เพิ่มงบ ${c.name}`,
        reason: r && r.ok ? `${budget} → ${next} ฿` : `ไม่สำเร็จ: ${(r && (r.error || r.msg)) || "?"}`,
      });
    }
  }

  // --- Auto ROI target: nudge roas_bid toward performance. ---
  for (const ch of s.channels || []) {
    const st = ch.settings || {};
    if (st.autopilot?.enabled) continue; // autopilot handles this channel
    const ra = st.roiAuto || {};
    if (!ra.enabled) continue;
    const camps = (s.campaigns || []).filter((c) => channelMatch(c, ch) && statusRunning(c));
    for (const c of camps) {
      if (c.cost < (st.minBudgetBeforeCheck || 0)) continue; // need real data first
      const target = c.targetRoi || 0;
      if (target <= 0 || c.roi <= 0) continue;
      const intervalMs = (ra.intervalMin || 30) * 60 * 1000;
      if (roiTs[c.id] && now - roiTs[c.id] < intervalMs) continue;
      const step = ra.step || 0.1;
      let next = null;
      if (c.roi >= target + (ra.margin || 1)) next = Math.min(target + step, ra.max || 5);
      else if (c.roi <= target - (ra.margin || 1)) next = Math.max(target - step, ra.min || 1);
      if (next == null || Math.abs(next - target) < 0.05) continue;
      const r = await execRoi(c.id, c.name, next);
      if (r && r.ok) roiTs[c.id] = now;
      actions.push({
        ok: r && r.ok,
        type: "roi",
        name: `🎯 ปรับ ROI เป้า ${c.name}`,
        reason: r && r.ok ? `${target.toFixed(1)} → ${next.toFixed(1)} (จริง ${c.roi.toFixed(1)})` : `ไม่สำเร็จ: ${(r && (r.error || r.msg)) || "?"}`,
      });
    }
  }

  // --- Autopilot: one target-ROI + daily-cap controller per channel. ---
  // You set a target ROI + max daily spend; it grows winners, cuts losers,
  // nudges the ROI bid, and stops the channel when the day's cap is hit.
  // (memory `history` was recorded at the top of runRules)
  for (const ch of s.channels || []) {
    const st = ch.settings || {};
    const ap = st.autopilot;
    if (!ap || !ap.enabled) continue;
    const target = Number(ap.targetRoi) || 20;
    const cap = Number(ap.maxDailySpend) || 0;
    const stepPct = ap.aggressiveness === "high" ? 0.4 : ap.aggressiveness === "low" ? 0.15 : 0.25;
    const minData = st.minBudgetBeforeCheck || 50;
    const chCamps = (s.campaigns || []).filter((c) => channelMatch(c, ch));
    const dailySpent = chCamps.reduce((a, c) => a + (c.cost || 0), 0);
    const live = chCamps.filter((c) => statusRunning(c));
    // Live-dashboard signal for this channel (from shop.tiktok.com), if captured.
    const liveInfo = (s.liveStats || {})[ch.id] || (s.liveStats || {})[ch.identityId] || null;

    // AI (LLM/ChatGPT) mode: hand the snapshot to the model and apply its plan.
    if (ap.mode === "ai" && s.openaiKey) {
      const aiTs = s.aiTs || {};
      const everyMs = (ap.aiIntervalMin || 10) * 60 * 1000;
      // Still enforce the hard daily-cap guard locally, regardless of the model.
      if (cap > 0 && dailySpent >= cap) {
        for (const c of live) {
          if (acted[c.id] && now - acted[c.id] < 30 * 60 * 1000) continue;
          const res = await execStatus(c.id, 2);
          acted[c.id] = now;
          if (res && res.ok) await execMinBudget(c.id, c.name);
          actions.push({ ok: res && res.ok, name: `🛑 ถึงเพดานงบวัน ปิด ${c.name}`, reason: `ใช้ ${Math.round(dailySpent)}/${cap}฿` });
        }
        continue;
      }
      if (aiTs[ch.id] && now - aiTs[ch.id] < everyMs) continue; // rate limit
      if (!live.length) continue; // nothing delivering to manage
      aiTs[ch.id] = now;
      s.aiTs = aiTs;
      const snapshot = buildAISnapshot(ch, st, s.campaigns || [], liveInfo, history, channelMemory[ch.id], scaledTs, now);
      const ai = await callLLM(s.openaiKey, s.openaiModel, snapshot);
      const aiAnalysis = s.aiAnalysis || {};
      if (ai.error) {
        aiAnalysis[ch.id] = { analysis: "⚠️ AI: " + ai.error, decisions: [], ts: now };
        actions.push({ ok: false, name: `🧠 AI (${ch.name})`, reason: ai.error });
      } else {
        let applied = [];
        if (ap.aiAutoApply !== false) {
          applied = await applyAIDecisions(ch, st, ai.decisions, s.campaigns || [], { acted, scaledTs, roiTs, createdTs }, now, liveInfo);
          for (const a of applied) actions.push(a);
        }
        aiAnalysis[ch.id] = { analysis: ai.analysis, decisions: ai.decisions, applied: applied.length, autoApply: ap.aiAutoApply !== false, ts: now };
        actions.push({ ok: true, name: `🧠 AI วิเคราะห์ ${ch.name}`, reason: (ai.analysis || "").slice(0, 120) });
      }
      s.aiAnalysis = aiAnalysis;
      continue; // AI handled this channel
    }

    // Daily loss guard: hit the spend cap -> pause everything live on the channel.
    if (cap > 0 && dailySpent >= cap) {
      for (const c of live) {
        if (acted[c.id] && now - acted[c.id] < 30 * 60 * 1000) continue;
        const res = await execStatus(c.id, 2);
        acted[c.id] = now;
        if (res && res.ok) await execMinBudget(c.id, c.name);
        actions.push({ ok: res && res.ok, name: `🛑 ถึงเพดานงบวัน ปิด ${c.name}`, reason: `ใช้ ${Math.round(dailySpent)}/${cap}฿` });
      }
      continue;
    }

    for (const c of live) {
      if ((c.cost || 0) < minData) continue; // wait for enough data
      const budget = c.budget || 0;
      const trend = roiTrend(history[c.id]);

      // Loser: losing money (ROI < 1) or spending with no orders -> cut it.
      if ((c.roi > 0 && c.roi < 1) || (c.orders === 0 && c.cost > minData * 2)) {
        if (acted[c.id] && now - acted[c.id] < 30 * 60 * 1000) continue;
        const res = await execStatus(c.id, 2);
        acted[c.id] = now;
        if (res && res.ok) await execMinBudget(c.id, c.name);
        if (res && res.ok && st.actions?.createNew && !(createdTs[ch.id] && now - createdTs[ch.id] < CREATE_COOLDOWN_MS)) {
          const cr = await execCreate(c.id, ch.id, target, st.actions.createBudget || 300);
          if (cr && cr.ok) createdTs[ch.id] = now;
        }
        actions.push({ ok: res && res.ok, name: `🤖 ตัดตัวขาดทุน ${c.name}`, reason: `ROI ${c.roi.toFixed(1)} · ${c.orders} ออร์เดอร์` });
        continue;
      }

      // Winner: beating target and not trending down -> scale up within the cap.
      // If we have a live signal and the room is NOT live, don't grow it.
      if (c.roi >= target && trend >= -0.15 && !(liveInfo && liveInfo.isLive === false)) {
        const scaleCdMs = (ap.scaleCooldownMin || 15) * 60 * 1000;
        if (scaledTs[c.id] && now - scaledTs[c.id] < scaleCdMs) continue; // space out scale-ups
        // Push harder when the live is genuinely hot (strong GPM).
        const hot = liveInfo && liveInfo.gpm > 300;
        const step = hot ? stepPct * 1.5 : stepPct;
        let next = Math.round(budget * (1 + step));
        if (cap > 0) next = Math.min(next, budget + Math.max(0, Math.round(cap - dailySpent)));
        if (next > budget) {
          const r = await execBudget(c.id, c.name, next);
          if (r && r.ok) scaledTs[c.id] = now;
          const liveTag = liveInfo ? ` · ไลฟ์ GPM ${Math.round(liveInfo.gpm)}฿` : "";
          actions.push({ ok: r && r.ok, name: `🤖 ดันตัวทำกำไร ${c.name}`, reason: `ROI ${c.roi.toFixed(1)} ≥ ${target} · งบ ${budget}→${next}฿${liveTag}` });
        }
        continue;
      }

      // Underperformer (1 ≤ ROI < target): raise the ROI bid to push efficiency.
      if (c.targetRoi > 0) {
        if (roiTs[c.id] && now - roiTs[c.id] < 30 * 60 * 1000) continue;
        const nextRoi = Math.min(c.targetRoi + 0.2, target + 2);
        if (nextRoi > c.targetRoi + 0.05) {
          const r = await execRoi(c.id, c.name, nextRoi);
          if (r && r.ok) roiTs[c.id] = now;
          actions.push({ ok: r && r.ok, name: `🤖 ปรับ ROI เป้า ${c.name}`, reason: `${c.targetRoi.toFixed(1)}→${nextRoi.toFixed(1)} (จริง ${c.roi.toFixed(1)})` });
        }
      }
    }
  }

  await chrome.storage.local.set({
    actedIds: acted, createdTs, scaledTs, roiTs, history, channelMemory,
    aiTs: s.aiTs || {}, aiAnalysis: s.aiAnalysis || {}, lastRun: now,
    pauseDiag: nextDiag, lastScan: scan, lastScanTs: now,
  });

  // Log the "why not paused" notes separately (never sent to Telegram).
  if (diags.length) await addLogs(diags);

  if (actions.length) {
    await addLogs(actions.map((a) => ({ ok: a.ok, text: `${a.name} — ${a.reason}` })));
    const okActs = actions.filter((a) => a.ok);
    const text =
      `🤖 GMV Max Monitor: ทำงาน ${okActs.length}/${actions.length} รายการ\n` +
      actions.map((a) => `${a.ok ? "✅" : "⚠️"} ${a.name} — ${a.reason}`).join("\n");
    if (s.telegramToken && s.telegramChatId)
      sendTelegram(s.telegramToken, s.telegramChatId, text);
  }
}

async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return { ok: false, error: "ยังไม่ได้ตั้ง Telegram" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const j = await res.json();
    return { ok: j.ok === true, error: j.description };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type === "CGMX_TELEGRAM_TEST") {
    chrome.storage.local.get(KEYS, async (s) => {
      sendResponse(
        await sendTelegram(
          s.telegramToken,
          s.telegramChatId,
          "🔔 ทดสอบแจ้งเตือน GMV Max Monitor — ใช้งานได้!"
        )
      );
    });
    return true;
  }
  if (msg?.type === "CGMX_RESCHEDULE") {
    reschedule();
    scheduleMidnight();
    scheduleDailySummary();
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === "CGMX_RUN_NOW") {
    runRules().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "CGMX_DAILY_TEST") {
    sendDailySummary().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "CGMX_AI_TEST") {
    (async () => {
      const s = await chrome.storage.local.get({ openaiKey: "", openaiModel: "gpt-4o-mini" });
      if (!s.openaiKey) return sendResponse({ ok: false, error: "ยังไม่ได้ใส่ API key" });
      const r = await callLLM(s.openaiKey, s.openaiModel, {
        goal: { targetRoi: 25, maxDailySpend: 1000, dailySpent: 0, minBudget: 100 },
        channel: "ทดสอบ",
        campaigns: [{ id: "test", name: "ทดสอบ", delivering: true, budget: 300, spent: 120, gmv: 3600, roi: 30, orders: 8, roiTarget: 1 }],
        live: null,
      });
      if (r.error) return sendResponse({ ok: false, error: r.error });
      sendResponse({ ok: true, reply: (r.analysis || "").slice(0, 120) });
    })();
    return true;
  }
  // Panel-triggered actions — run in the background via direct fetch (reliable).
  if (msg?.type === "CGMX_DO_MINBUDGET") {
    execMinBudget(msg.campaignId, msg.campaignName).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "CGMX_DO_CREATE") {
    execCreate(null, msg.channelId, msg.roi, msg.budget).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "CGMX_DO_STATUS") {
    execStatus(msg.campaignId, msg.operation).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  // Test the real reduce flow on a live campaign: pause -> reduce -> re-enable.
  if (msg?.type === "CGMX_DO_TESTREDUCE") {
    (async () => {
      try {
        const ctx = await apiCtx();
        if (!ctx || !ctx.aadvid) return sendResponse({ ok: false, error: "ยังไม่มี context — เปิดหน้า GMV Max ก่อน" });
        const paused = await apiSetStatus(ctx, msg.campaignId, 2);
        const reduced = await apiReduceToMin(ctx, msg.campaignId, msg.campaignName);
        const reenabled = msg.reenable ? await apiSetStatus(ctx, msg.campaignId, 1) : { ok: true, skipped: true };
        sendResponse({
          ok: reduced.ok,
          budget: reduced.budget,
          paused: paused.ok,
          reenabled: reenabled.ok,
          error: reduced.error,
          msg: reduced.msg,
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});
