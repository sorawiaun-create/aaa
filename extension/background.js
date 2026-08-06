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
  logs: [],
};

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

// Evaluate a campaign against a channel's trigger settings (OR logic).
function triggered(c, st) {
  if (c.cost < (st.minBudgetBeforeCheck || 0)) return null;
  const T = st.triggers || {};
  const cpo = c.orders > 0 ? c.cost / c.orders : c.cost;
  if (T.roi?.on && c.roi > 0 && c.roi < T.roi.value)
    return `ROI ${c.roi.toFixed(2)} < ${T.roi.value}`;
  if (T.cost?.on && cpo > T.cost.value)
    return `ต้นทุน/ซื้อ ${cpo.toFixed(0)} > ${T.cost.value}`;
  if (T.spentNoOrder?.on && c.orders === 0 && c.cost > T.spentNoOrder.value)
    return `ใช้งบ ${c.cost.toFixed(0)} แต่ไม่มีออร์เดอร์`;
  return null;
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
  const detail = await apiGetDetail(ctx, campaignId);
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
  const j = await apiFetch(apiBuildUrl(API.UPDATE, apiCtxParams(ctx)), { method: "POST", body: JSON.stringify(payload) });
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
  let target = 100; // start at the known daily floor; bump up only if TikTok asks
  let last = null;
  for (let i = 0; i < 5; i++) {
    const r = await apiUpdate(ctx, campaignId, { budget: target, campaignName });
    if (r.ok) return { ok: true, budget: target, retried: i };
    last = r;
    const need = apiParseMinBudget(r.resp);
    // No parseable amount, or it isn't asking for more than we tried -> give up.
    if (need == null || Math.ceil(need) <= target)
      return { ok: false, error: r.msg || r.error || "ตั้งงบต่ำสุดไม่ได้", resp: r.resp };
    target = Math.ceil(need);
  }
  return { ok: false, error: (last && (last.msg || last.error)) || "ลองหลายครั้งแล้วยังไม่ได้", resp: last && last.resp };
}
async function apiSetStatus(ctx, campaignId, operation) {
  const j = await apiFetch(apiBuildUrl(API.STATUS, apiCtxParams(ctx)), {
    method: "POST", body: JSON.stringify({ campaign_list: [String(campaignId)], operation }),
  });
  return { ok: j && j.code === 0, code: j && j.code, msg: j && j.msg, resp: j };
}
function apiPad2(n) { return String(n).padStart(2, "0"); }
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
      campaign_id: "", campaign_name: `${yy}/${MM}/${dd} - ${accountName || "ช่อง"} - ${hh}${mm}`,
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
  const j = await apiFetch(apiBuildUrl(API.CREATE, apiCtxParams(ctx)), {
    method: "POST", body: JSON.stringify(apiBuildCreate(detail, ctx, roi, budget, accountName)),
  });
  return { ok: j && j.code === 0, code: j && j.code, msg: j && j.msg, resp: j };
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

async function runRules() {
  // Always refresh data from TikTok first — this keeps the panel's numbers and
  // "last synced" time current every interval, regardless of the master toggle.
  await tabSync();
  const s = await chrome.storage.local.get(KEYS);
  if (!s.enabled) return; // only ACT (pause/create) when the program is on
  const acted = s.actedIds || {};
  const createdTs = s.createdTs || {};
  const scaledTs = s.scaledTs || {};
  const roiTs = s.roiTs || {};
  const now = Date.now();
  const actions = [];

  for (const ch of s.channels || []) {
    const st = ch.settings || {};
    if (!st.actions?.pause) continue;
    const camps = (s.campaigns || []).filter((c) => channelMatch(c, ch));
    for (const c of camps) {
      if (!statusRunning(c)) continue;
      if (acted[c.id] && now - acted[c.id] < 30 * 60 * 1000) continue; // cooldown 30m
      const reason = triggered(c, st);
      if (!reason) continue;
      const res = await execStatus(c.id, 2); // 2 = pause FIRST
      acted[c.id] = now;
      actions.push({ ok: res && res.ok, name: c.name, reason });
      // Then drop the budget to the minimum — TikTok only allows lowering the
      // budget once the campaign is paused. This stops a high (scaled-up)
      // budget from continuing to spend after the pause.
      if (res && res.ok && st.actions?.reduceBudgetBeforePause !== false) {
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
          const cr = await execCreate(c.id, ch.id, st.actions.createRoi, st.actions.createBudget);
          if (cr && cr.ok) createdTs[ch.id] = now;
          actions.push({
            ok: cr && cr.ok,
            name: `↳ สร้างใหม่ (ROI ${st.actions.createRoi}, งบ ${st.actions.createBudget}฿)`,
            reason: cr && cr.ok ? "สำเร็จ" : `ไม่สำเร็จ: ${(cr && (cr.error || cr.msg)) || "?"}`,
          });
        }
      }
    }
  }

  // --- Budget scaling: grow the budget of running (healthy) campaigns. ---
  for (const ch of s.channels || []) {
    const st = ch.settings || {};
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

  await chrome.storage.local.set({ actedIds: acted, createdTs, scaledTs, roiTs, lastRun: now });

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
