// Isolated-world bridge for ads.tiktok.com.
//
// It (a) stores context captured from the page's own API calls, and (b) calls
// TikTok's internal GMV Max APIs directly using the site session — the same
// endpoints the official UI uses:
//   channels   GET  /api/oec_shopping/v1/creation/identity_list  (get_all=false)
//              GET  /api/oec_shopping/v1/creation/creator_identity_list (no-shop)
//   campaigns  POST /api/oec_shopping/v1/oec/stat/post_campaign_list
//   pause/on   POST /api/oec_shopping/v1/creation/campaign/update_status
//                   body {campaign_list:[id], operation: 2=pause | 1=enable}
// Auth is Content-Type + X-Csrftoken (from the csrftoken cookie) + cookies.

const TAG = "__CGMX__";
const MAX_CAPTURES = 50;
const BASE = "https://ads.tiktok.com";
const EP = {
  CHANNEL_LIST: "/api/oec_shopping/v1/creation/identity_list",
  CHANNEL_LIST_NOSHOP: "/api/oec_shopping/v1/creation/creator_identity_list",
  CAMPAIGN_LIST: "/api/oec_shopping/v1/oec/stat/post_campaign_list",
  UPDATE_STATUS: "/api/oec_shopping/v1/creation/campaign/update_status",
  CAMPAIGN_DETAIL: "/api/oec_shopping/v1/creation/all_ad_data/detail",
  CREATE_CAMPAIGN: "/api/oec_shopping/v1/creation/all_ad_data/create",
  UPDATE_CAMPAIGN: "/api/oec_shopping/v1/creation/all_ad_data/update",
};

// Campaign fields to request — mirrors the official UI's query_list.
const CAMPAIGN_QUERY_LIST = [
  "campaign_opt_status", "campaign_name", "campaign_status", "campaign_primary_status",
  "campaign_target_roi_budget", "lod_shop_cost", "lod_shop_billed_cost",
  "campaign_budget", "campaign_total_budget", "tt_account_name", "tt_account_avatar_icon",
  "template_ad_identity_id", "template_ad_start_time", "template_ad_end_time",
  "template_ad_schedule_type", "template_ad_roas_bid", "campaign_no_bid_budget",
  "campaign_target_roi_budget_mode", "campaign_budget_mode",
  "auto_increase_budget_effective_budget", "lod_shop_onsite_roi2_shopping_value",
  "lod_shop_onsite_roi2_shopping", "lod_shop_onsite_roi2_shopping_sku",
  "lod_shop_cost_per_onsite_roi2_shopping_sku", "lod_shop_roi2_live_play_count",
  "lod_shop_roi2_live_follows", "lod_shop_target_roi_cost",
  "lod_shop_target_roi_onsite_roi2_shopping", "gmax_advance_mode", "gmv_max_bid_type",
  "current_optimization_mode", "campaign_eligible_status",
];

/* --------------------------- helpers --------------------------- */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
let CSRF_FALLBACK = "";
function setCsrfFallback(headerTemplate) {
  for (const k of Object.keys(headerTemplate || {}))
    if (k.toLowerCase() === "x-csrftoken" && headerTemplate[k]) {
      CSRF_FALLBACK = headerTemplate[k];
      return;
    }
}
function getCsrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return (m ? decodeURIComponent(m[1]) : "") || CSRF_FALLBACK;
}
function bangkokDateStr() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
function buildUrl(path, params) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params || {}))
    if (v !== null && v !== undefined && v !== "") u.searchParams.set(k, v);
  u.searchParams.set("_t", Date.now());
  return u.toString();
}
async function apiFetch(url, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-Csrftoken": getCsrf(),
    ...(opts.headers || {}),
  };
  const r = await fetch(url, { credentials: "include", ...opts, headers });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { __nonjson: true, status: r.status, body: text.slice(0, 500) };
  }
}
// Recursively set every occurrence of the given keys within an object tree.
function deepSet(node, keys, value, depth = 0) {
  if (!node || typeof node !== "object" || depth > 8) return;
  if (Array.isArray(node)) {
    for (const it of node) deepSet(it, keys, value, depth + 1);
    return;
  }
  for (const k of Object.keys(node)) {
    if (keys.includes(k) && (typeof node[k] !== "object" || node[k] === null)) node[k] = value;
    else deepSet(node[k], keys, value, depth + 1);
  }
}
function ctxParams(ctx, noShop) {
  return {
    locale: "th",
    language: "th",
    oec_seller_id: noShop ? "0" : ctx.oec_seller_id,
    aadvid: ctx.aadvid,
    bc_id: noShop ? "0" : ctx.bc_id,
  };
}

/* --------------------------- mappers --------------------------- */

function mapChannel(c) {
  return {
    id: String(
      c.tt_asset_id ?? c.tt_uid ?? c.tt_account_id ?? c.account_id ??
        c.identity_id ?? c.id ?? ""
    ),
    name:
      c.tt_asset_name ?? c.nickname ?? c.name ?? c.tt_account_name ??
      c.account_name ?? c.display_name ?? "(ไม่มีชื่อ)",
    icon:
      c.avatar_uri ?? c.avatar_url ?? c.avatar ?? c.tt_account_avatar_icon ??
      c.icon ?? "",
    identityId: String(c.identity_id ?? c.template_ad_identity_id ?? ""),
    raw: c,
  };
}
// Flatten TikTok's identity_list response into a flat channel list.
function flattenIdentity(resp) {
  const groups = resp?.data?.identity_list || resp?.identity_list || [];
  const out = [];
  for (const grp of groups) {
    const av = grp.available_tt_for_live_ads || [];
    const un = grp.unavailable_tt_for_live_ads || [];
    if (av.length || un.length) {
      for (const tt of [...av, ...un]) out.push(mapChannel(tt));
    } else {
      out.push(mapChannel(grp));
    }
  }
  const byId = new Map();
  for (const c of out) if (c.id && c.id !== "undefined") byId.set(c.id, c);
  return [...byId.values()];
}
// A GMV Max LIVE campaign is "on" only when it is actually delivering right now
// (campaign_primary_status delivery_ok / enable). Everything else — mutex
// (roi2_mutex_*), disabled, or asset-unavailable — is off, per the real data.
function campaignState(c) {
  const p = String(c.campaign_primary_status ?? "").toLowerCase();
  return p === "delivery_ok" || p === "enable" ? "on" : "off";
}
function mapCampaigns(arr) {
  return arr.map((c) => {
    const cost = num(c.lod_shop_cost ?? c.cost ?? c.basic_cost);
    const gmv = num(c.lod_shop_onsite_roi2_shopping_value ?? c.onsite_roi2_shopping_value ?? c.gmv);
    const orders = num(
      c.lod_shop_onsite_roi2_shopping_sku ??
        c.lod_shop_onsite_roi2_shopping ??
        c.onsite_roi2_shopping_sku ??
        c.orders
    );
    const cpoField = num(c.lod_shop_cost_per_onsite_roi2_shopping_sku);
    const live = num(c.lod_shop_roi2_live_play_count);
    const budget = num(c.campaign_budget ?? c.campaign_total_budget ?? c.campaign_target_roi_budget);
    const state = campaignState(c); // "on" (delivering) | "wait" (on, not live) | "off"
    return {
      id: String(c.campaign_id ?? c.campaign_id_str ?? c.id ?? ""),
      name: c.campaign_name ?? "(ไม่มีชื่อ)",
      on: state !== "off", // toggled on (delivering or waiting for live)
      delivering: state === "on",
      state,
      status: String(c.campaign_primary_status ?? c.campaign_status ?? ""),
      budget,
      cost,
      gmv,
      orders,
      cpo: cpoField > 0 ? cpoField : orders > 0 ? cost / orders : 0,
      liveViewers: live,
      roi: cost > 0 ? gmv / cost : 0,
      targetRoi: num(c.template_ad_roas_bid ?? c.campaign_eligible_roi),
      channelId: String(c.template_ad_identity_id ?? c.tt_account_id ?? ""),
      channelName: c.tt_account_name ?? "",
      channelIcon: c.tt_account_avatar_icon ?? "",
      raw: c,
    };
  });
}
// Build a channel list from campaign rows (each carries the account name +
// avatar + template_ad_identity_id).
function channelsFromCampaigns(campaigns) {
  const byId = new Map();
  for (const cp of campaigns || []) {
    const id = String(cp.channelId || "");
    if (id && !byId.has(id))
      byId.set(id, {
        id,
        name: cp.channelName || id,
        icon: cp.channelIcon || "",
        identityId: id,
        raw: { from: "campaign" },
      });
  }
  return [...byId.values()];
}
// Recursively find a campaign-looking array (fallback for interceptor captures).
function findCampaignArray(node, depth) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    if (
      node.length &&
      typeof node[0] === "object" &&
      node[0] &&
      ("campaign_name" in node[0] || "campaign_id" in node[0] || "campaign_opt_status" in node[0])
    )
      return node;
    for (const it of node) {
      const r = findCampaignArray(it, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof node === "object")
    for (const k of Object.keys(node)) {
      const r = findCampaignArray(node[k], depth + 1);
      if (r) return r;
    }
  return null;
}

/* --------------------- context from the page URL --------------------- */

// The GMV Max page URL carries the context params, e.g.
//   ads.tiktok.com/i18n/gmv-max/?aadvid=...&bc_id=...&oec_seller_id=...
// Read them directly so Sync works without waiting for an intercepted call.
function ctxFromLocation() {
  const href = location.href;
  const grab = (k) => {
    const m = href.match(new RegExp("[?&#]" + k + "=([^&#/]+)"));
    return m ? decodeURIComponent(m[1]) : "";
  };
  return {
    aadvid: grab("aadvid"),
    oec_seller_id: grab("oec_seller_id"),
    bc_id: grab("bc_id"),
  };
}
function captureCtxFromLocation() {
  const loc = ctxFromLocation();
  if (!loc.aadvid) return;
  chrome.storage.local.get({ ctx: null }, (st) => {
    const prev = st.ctx || {};
    const ctx = {
      aadvid: loc.aadvid || prev.aadvid || "",
      oec_seller_id: loc.oec_seller_id || prev.oec_seller_id || "",
      bc_id: loc.bc_id || prev.bc_id || "",
    };
    if (ctx.aadvid && JSON.stringify(ctx) !== JSON.stringify(prev))
      chrome.storage.local.set({ ctx });
  });
}
captureCtxFromLocation();
// TikTok is a SPA — re-check when the URL changes.
setInterval(captureCtxFromLocation, 3000);

/* --------------------- passive capture (context) --------------------- */

window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const data = ev.data;
  if (!data || data.source !== TAG || !data.entry) return;
  const e = data.entry;

  if (e.kind === "list" && e.resFull) {
    try {
      const arr = findCampaignArray(JSON.parse(e.resFull), 0);
      if (arr) {
        const campaigns = mapCampaigns(arr);
        // Derive channels from the campaign rows and merge them into the stored
        // channel list — this works passively, without pressing Sync.
        const derived = channelsFromCampaigns(campaigns);
        chrome.storage.local.get({ channelList: [] }, (st) => {
          const byId = new Map();
          for (const c of st.channelList || []) if (c.id) byId.set(c.id, c);
          for (const c of derived) byId.set(c.id, { ...byId.get(c.id), ...c });
          chrome.storage.local.set({
            campaigns,
            campaignsTs: e.ts,
            channelList: [...byId.values()],
          });
        });
      }
    } catch {
      /* ignore */
    }
    return;
  }
  if (e.kind === "recipe") {
    chrome.storage.local.set({
      pauseRecipe: {
        url: e.url, method: e.method || "POST", headers: e.headers || {},
        reqBody: e.reqBody || "", ts: e.ts,
      },
    });
    return;
  }
  if (e.kind === "createRecipe") {
    chrome.storage.local.set({
      createRecipe: { url: e.url, method: e.method || "POST", reqBody: e.reqBody || "", ts: e.ts },
    });
    return;
  }
  if (e.kind === "budgetRecipe") {
    chrome.storage.local.set({
      budgetRecipe: { url: e.url, method: e.method || "POST", reqBody: e.reqBody || "", ts: e.ts },
    });
    return;
  }
  if (e.kind === "ctx") {
    try {
      const q = new URL(e.url, BASE).searchParams;
      const ctx = {
        oec_seller_id: q.get("oec_seller_id") || "",
        aadvid: q.get("aadvid") || "",
        bc_id: q.get("bc_id") || "",
      };
      if (ctx.aadvid) chrome.storage.local.set({ ctx, headerTemplate: e.headers || {} });
    } catch {
      /* ignore */
    }
    return;
  }
  if (e.kind === "capture") {
    chrome.storage.local.get({ captures: [] }, (res) => {
      const list = res.captures || [];
      const key = `${e.method} ${e.url.split("?")[0]}`;
      const idx = list.findIndex((c) => `${c.method} ${c.url.split("?")[0]}` === key);
      const rec = {
        method: e.method, url: e.url.split("?")[0], reqBody: e.reqBody || null,
        resSample: e.resSample || "", ts: e.ts,
      };
      if (idx >= 0) list[idx] = rec;
      else list.unshift(rec);
      chrome.storage.local.set({ captures: list.slice(0, MAX_CAPTURES) });
    });
  }
});

/* --------------------- direct API calls (automation) --------------------- */

async function fetchChannels(ctx, out) {
  // Primary: with-shop identity list.
  try {
    const withShop = await apiFetch(
      buildUrl(EP.CHANNEL_LIST, { ...ctxParams(ctx, false), get_all: false }),
      { method: "GET" }
    );
    out.probes.identity_list = withShop;
    let list = flattenIdentity(withShop);
    if (list.length) return { list, source: "identity_list" };
  } catch (e) {
    out.errors.push("identity_list: " + e);
  }
  // Fallback: no-shop creator identity list.
  try {
    const noShop = await apiFetch(
      buildUrl(EP.CHANNEL_LIST_NOSHOP, { ...ctxParams(ctx, true), get_all: false }),
      { method: "GET" }
    );
    out.probes.creator_identity_list = noShop;
    const list = flattenIdentity(noShop);
    if (list.length) return { list, source: "creator_identity_list" };
  } catch (e) {
    out.errors.push("creator_identity_list: " + e);
  }
  return { list: [], source: "" };
}

// Fetch every other endpoint that might list the seller's channels, storing
// the raw response so the parsing can be verified/extended from a debug export.
async function probeExtraChannelEndpoints(ctx, out) {
  const eps = [
    ["marketing_account_identity_list", "/api/oec_shopping/v1/creation/marketing_account_identity_list"],
    ["tt_list", "/api/oec_shopping/v1/oec/tt_list"],
    ["shop_allow_list", "/api/oec_shopping/v1/oec/shop_allow_list"],
    ["get_adv_bind_shop_list", "/api/shopping/v1/gmv_max/get_adv_bind_shop_list/"],
  ];
  for (const [name, path] of eps) {
    try {
      out.probes[name] = await apiFetch(buildUrl(path, ctxParams(ctx, false)), { method: "GET" });
    } catch (e) {
      out.errors.push(`${name}: ${e}`);
    }
  }
}

async function fetchCampaigns(ctx, out) {
  const date = bangkokDateStr();
  const body = {
    query_list: CAMPAIGN_QUERY_LIST,
    start_time: date,
    end_time: date,
    order_field: "campaign_id",
    order_type: 1,
    page: 1,
    page_size: 200,
    campaign_status: ["no_delete"],
    campaign_shop_automation_type: 2,
    external_type_list: ["305"],
  };
  try {
    const resp = await apiFetch(
      buildUrl(EP.CAMPAIGN_LIST, ctxParams(ctx, false)),
      { method: "POST", body: JSON.stringify(body) }
    );
    out.probes.post_campaign_list = resp;
    const arr = findCampaignArray(resp, 0) || [];
    return mapCampaigns(arr);
  } catch (e) {
    out.errors.push("post_campaign_list: " + e);
    return [];
  }
}

// Read an existing campaign's full ad data (used as the create template).
async function getCampaignDetail(ctx, campaignId) {
  const url = buildUrl(EP.CAMPAIGN_DETAIL, { ...ctxParams(ctx, false), campaign_id: campaignId });
  const j = await apiFetch(url, { method: "GET" });
  return j && j.data ? j.data : null;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
function riskInfo() {
  return {
    cookie_enabled: true,
    screen_width: screen.width || 1920,
    screen_height: screen.height || 1080,
    browser_language: "th-TH",
    browser_platform: navigator.platform || "Win32",
    browser_name: "Mozilla",
    browser_version: navigator.userAgent || "Mozilla/5.0",
    browser_online: true,
    timezone_name: "Asia/Bangkok",
  };
}

// Update a campaign's budget and/or ROI target. Reads the existing ad data and
// re-posts it through all_ad_data/update (mirrors the official edit). Pass only
// the fields you want to change; the rest are kept from the current campaign.
async function updateCampaign(ctx, campaignId, opts) {
  const detail = await getCampaignDetail(ctx, campaignId);
  if (!detail || !detail.ad_info) return { ok: false, error: "อ่านรายละเอียดแคมเปญไม่ได้" };
  const ad = detail.ad_info;
  const bud = opts.budget != null ? Math.round(Number(opts.budget)) : Math.round(Number(ad.budget) || 0);
  const budStr = bud + ".00";
  const roasBid = opts.roi != null ? parseFloat(Number(opts.roi).toFixed(1)) : ad.roas_bid;
  const pds = ad.promotion_days_setting || {};
  const mult = pds.budget_multiplier || 150;
  const payload = {
    campaign_info: {
      campaign_id: campaignId,
      campaign_name: (detail.campaign_info && detail.campaign_info.campaign_name) || opts.campaignName || ad.campaign_name || "",
      budget_mode: -1,
      budget: budStr,
      shop_automation_type: 2,
      shop_image_aigc_mode: 0,
    },
    ad_info: {
      ...ad,
      campaign_id: campaignId,
      ad_id: ad.ad_id || "",
      budget_mode: 0,
      budget: budStr,
      roas_bid: roasBid,
      shop_id: ctx.oec_seller_id,
      shop_authorized_bc: ad.shop_authorized_bc || ctx.bc_id,
      promotion_days_setting: { ...pds, adjusted_budget: Math.round((bud * mult) / 100) },
      gmax_budget_adjust_setting: { ...(ad.gmax_budget_adjust_setting || {}), effective_budget: bud },
    },
    risk_info: riskInfo(),
  };
  const url = buildUrl(EP.UPDATE_CAMPAIGN, ctxParams(ctx, false));
  const j = await apiFetch(url, { method: "POST", body: JSON.stringify(payload) });
  return { ok: j && j.code === 0, code: j && j.code, msg: j && j.msg, resp: j };
}

// Build a GMV Max Live create payload by cloning an existing campaign's ad_info
// and swapping in the new name, budget and ROI. Field names/values mirror what
// the TikTok create API expects (with-shop / LIVE GMV Max).
function buildCreatePayload(detail, ctx, roi, budget, accountName) {
  const ad = (detail && detail.ad_info) || {};
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const MM = pad2(now.getMonth() + 1);
  const dd = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const mm = pad2(now.getMinutes());
  const ss = pad2(now.getSeconds());
  const startTime = `${now.getFullYear()}-${MM}-${dd} ${hh}:${mm}:${ss}`;
  const campaignName = `${yy}/${MM}/${dd} - ${accountName || "ช่อง"} - ${hh}${mm}`;
  const roasBid = parseFloat(Number(roi).toFixed(1));
  const adjustedRoas = (Number(roi) * 0.9).toFixed(1);
  const bud = Number(budget);

  const identityList =
    ad.identity_list && ad.identity_list.length
      ? ad.identity_list
      : [{ tt_uid: ad.template_ad_identity_id || "", identity_type: 8 }];

  return {
    campaign_info: {
      campaign_id: "",
      campaign_name: campaignName,
      budget_mode: 0,
      budget: bud,
      shop_automation_type: 2,
      shop_image_aigc_mode: 0,
    },
    ad_info: {
      name: `adgroup_${now.getFullYear()}${MM}${dd}_${hh}${mm}${ss}`,
      campaign_id: "",
      ad_id: "",
      inventory_flow_type: ad.inventory_flow_type || 1,
      inventory_flow: ad.inventory_flow || [3000],
      shopping_inventory_type: ad.shopping_inventory_type || 1,
      external_type: ad.external_type ?? 0,
      is_comment_disable: 0,
      schedule_type: 1,
      start_time: startTime,
      flow_control_mode: ad.flow_control_mode || 0,
      budget_mode: 0,
      budget: bud,
      product_video_selection_type: 1,
      pricing: ad.pricing || 9,
      cpa_skip_first_phrase: ad.cpa_skip_first_phrase || 0,
      optimize_goal: ad.optimize_goal || 111,
      external_action: ad.external_action ?? 0,
      deep_bid_type: ad.deep_bid_type || 108,
      roas_bid: roasBid,
      product_platform_id: "",
      country: "TH",
      shop_id: ctx.oec_seller_id,
      ...(ad.shop_type ? { shop_type: ad.shop_type } : {}),
      shop_authorized_bc: ad.shop_authorized_bc || ctx.bc_id,
      promotion_flow_type: 2,
      product_source: ad.product_source ?? 0,
      product_bid_type: ad.product_bid_type ?? 0,
      custom_tz_id: ad.custom_tz_id || "7473426712694374408",
      custom_tz_type: ad.custom_tz_type ?? 2,
      promotion_days_setting: {
        is_enable: false,
        automode_enable: true,
        custom_schedules: [],
        roas_bid_multiplier: 90,
        budget_multiplier: 150,
        adjusted_roas_bid: adjustedRoas,
        adjusted_budget: (bud * 1.5).toFixed(2),
        benchmark_roas_bid: Number(roi),
      },
      compensation_activity_type: ad.compensation_activity_type ?? 3,
      gmax_budget_adjust_setting: {
        strategy: ad.gmax_budget_adjust_setting?.strategy || 2,
        auto_budget_switch: ad.gmax_budget_adjust_setting?.auto_budget_switch ?? false,
        auto_budget_adjust_config:
          ad.gmax_budget_adjust_setting?.auto_budget_adjust_config || { adjust_ratio: 0.5, max_daily_adjust_times: 10 },
        promotion_day_adjust_config:
          ad.gmax_budget_adjust_setting?.promotion_day_adjust_config || { adjust_ratio: 0.5, max_daily_adjust_times: 10 },
      },
      identity_list: identityList,
      enable_shop_video_exclusion_filter: true,
      shop_video_filters: [],
      pre_item_list: [],
      shop_live_video_identity_list: [],
      key_live_days: [],
    },
    risk_info: riskInfo(),
  };
}

// Clone an existing campaign into a new one with the given ROI + budget.
async function createFromTemplate(ctx, templateCampaignId, roi, budget, accountName) {
  const detail = await getCampaignDetail(ctx, templateCampaignId);
  if (!detail || !detail.ad_info)
    return { ok: false, error: "อ่านรายละเอียดแคมเปญต้นแบบไม่ได้" };
  const payload = buildCreatePayload(detail, ctx, roi, budget, accountName);
  const url = buildUrl(EP.CREATE_CAMPAIGN, ctxParams(ctx, false));
  const j = await apiFetch(url, { method: "POST", body: JSON.stringify(payload) });
  return { ok: j && j.code === 0, code: j && j.code, msg: j && j.msg, resp: j };
}

async function setCampaignStatus(ctx, campaignId, operation) {
  const url = buildUrl(EP.UPDATE_STATUS, ctxParams(ctx, false));
  const j = await apiFetch(url, {
    method: "POST",
    body: JSON.stringify({ campaign_list: [String(campaignId)], operation }),
  });
  return { ok: j && j.code === 0, code: j && j.code, msg: j && j.msg, resp: j };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "CGMX_SYNC") {
    (async () => {
      try {
        const st = await chrome.storage.local.get({ ctx: null, headerTemplate: {} });
        setCsrfFallback(st.headerTemplate);
        const ctx = st.ctx;
        if (!ctx || !ctx.aadvid) {
          sendResponse({
            ok: false,
            error: "ยังไม่มี context — เปิดหน้า GMV Max ให้โหลดสักครู่ แล้วกด Sync อีกครั้ง",
          });
          return;
        }
        const out = { ctxUsed: ctx, probes: {}, errors: [] };
        const { list: idChannels, source } = await fetchChannels(ctx, out);
        const campaigns = await fetchCampaigns(ctx, out);
        await probeExtraChannelEndpoints(ctx, out);

        // Union: identity-list channels + channels derived from campaign rows
        // (each campaign carries tt_account_name/avatar + template_ad_identity_id).
        const byId = new Map();
        for (const c of idChannels) if (c.id) byId.set(c.id, c);
        for (const cp of campaigns) {
          const id = String(cp.channelId || "");
          if (id && !byId.has(id))
            byId.set(id, {
              id,
              name: cp.channelName || id,
              icon: cp.channelIcon || "",
              identityId: id,
              raw: { from: "campaign" },
            });
        }
        // Also try parsing any extra probe that returned a channel-looking list.
        for (const [name, resp] of Object.entries(out.probes)) {
          if (["post_campaign_list", "identity_list", "creator_identity_list"].includes(name)) continue;
          for (const ch of flattenIdentity(resp)) if (ch.id && !byId.has(ch.id)) byId.set(ch.id, ch);
        }
        const channelList = [...byId.values()];
        out.channelSource = source || (channelList.length ? "campaigns" : "");

        const patch = { syncRaw: out, campaigns, syncTs: Date.now() };
        if (channelList.length) patch.channelList = channelList;
        await chrome.storage.local.set(patch);
        sendResponse({
          ok: true,
          channels: channelList.length,
          campaigns: campaigns.length,
          source: out.channelSource,
          errors: out.errors,
        });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      }
    })();
    return true;
  }

  if (msg && msg.type === "CGMX_STATUS") {
    (async () => {
      try {
        const st = await chrome.storage.local.get({ ctx: null, headerTemplate: {} });
        setCsrfFallback(st.headerTemplate);
        if (!st.ctx || !st.ctx.aadvid) {
          sendResponse({ ok: false, error: "no ctx" });
          return;
        }
        sendResponse(await setCampaignStatus(st.ctx, msg.campaignId, msg.operation || 2));
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg && msg.type === "CGMX_BUDGET") {
    (async () => {
      try {
        const st = await chrome.storage.local.get({ ctx: null, headerTemplate: {} });
        setCsrfFallback(st.headerTemplate);
        if (!st.ctx || !st.ctx.aadvid) {
          sendResponse({ ok: false, error: "no ctx" });
          return;
        }
        sendResponse(await updateCampaign(st.ctx, msg.campaignId, { budget: msg.budget, campaignName: msg.campaignName }));
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg && msg.type === "CGMX_ROI") {
    (async () => {
      try {
        const st = await chrome.storage.local.get({ ctx: null, headerTemplate: {} });
        setCsrfFallback(st.headerTemplate);
        if (!st.ctx || !st.ctx.aadvid) {
          sendResponse({ ok: false, error: "no ctx" });
          return;
        }
        sendResponse(await updateCampaign(st.ctx, msg.campaignId, { roi: msg.roi, campaignName: msg.campaignName }));
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg && msg.type === "CGMX_CREATE") {
    (async () => {
      try {
        const st = await chrome.storage.local.get({
          ctx: null, headerTemplate: {}, createRecipe: null, campaigns: [],
        });
        setCsrfFallback(st.headerTemplate);
        const ctx = st.ctx;
        if (!ctx || !ctx.aadvid) {
          sendResponse({ ok: false, error: "no ctx" });
          return;
        }
        // Preferred: clone an existing campaign (no manual recording needed).
        let templateId = msg.templateCampaignId;
        let accountName = "";
        if (!templateId) {
          // Pick any campaign on the same channel as a template.
          const camps = st.campaigns || [];
          const match = camps.find((c) => String(c.channelId) === String(msg.channelId)) || camps[0];
          if (match) {
            templateId = match.id;
            accountName = match.channelName;
          }
        } else {
          const found = (st.campaigns || []).find((c) => String(c.id) === String(templateId));
          if (found) accountName = found.channelName;
        }
        if (templateId) {
          const r = await createFromTemplate(ctx, templateId, msg.roi, msg.budget, accountName);
          if (r.ok) {
            sendResponse(r);
            return;
          }
          // fall through to recipe replay if the clone failed
          if (!st.createRecipe) {
            sendResponse(r);
            return;
          }
        }
        // Fallback: replay a recorded create request.
        if (st.createRecipe && st.createRecipe.reqBody) {
          let body;
          try {
            body = JSON.parse(st.createRecipe.reqBody);
          } catch {
            sendResponse({ ok: false, error: "แม่แบบการสร้างเสียหาย" });
            return;
          }
          if (msg.roi != null) deepSet(body, ["roas_bid"], parseFloat(Number(msg.roi).toFixed(1)));
          if (msg.budget != null) deepSet(body, ["budget"], Number(msg.budget));
          deepSet(body, ["campaign_name"], `AUTO_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`);
          const j = await apiFetch(st.createRecipe.url, {
            method: st.createRecipe.method || "POST",
            body: JSON.stringify(body),
          });
          sendResponse({ ok: j && j.code === 0, code: j && j.code, msg: j && j.msg, resp: j });
          return;
        }
        sendResponse({ ok: false, error: "ไม่มีแคมเปญต้นแบบให้โคลน — ลองซิงก์ให้เจอแคมเปญก่อน" });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg && msg.type === "CGMX_EXEC") {
    const { method, url, body, headers } = msg.req;
    fetch(url, {
      method: method || "POST",
      headers: headers || { "Content-Type": "application/json" },
      body: method && method !== "GET" ? body : undefined,
      credentials: "include",
    })
      .then(async (r) => {
        const text = await r.text();
        sendResponse({ ok: true, status: r.status, body: text.slice(0, 2000) });
      })
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});
