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
    return {
      id: String(c.campaign_id ?? c.campaign_id_str ?? c.id ?? ""),
      name: c.campaign_name ?? "(ไม่มีชื่อ)",
      status: String(c.campaign_status ?? c.campaign_primary_status ?? c.campaign_opt_status ?? ""),
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
      if (arr) chrome.storage.local.set({ campaigns: mapCampaigns(arr), campaignsTs: e.ts });
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
        const { list: channelList, source } = await fetchChannels(ctx, out);
        const campaigns = await fetchCampaigns(ctx, out);
        out.channelSource = source;

        const patch = { syncRaw: out, campaigns, syncTs: Date.now() };
        if (channelList.length) patch.channelList = channelList;
        await chrome.storage.local.set(patch);
        sendResponse({
          ok: true,
          channels: channelList.length,
          campaigns: campaigns.length,
          source,
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
