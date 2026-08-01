// Isolated-world bridge: stores captured data and can replay same-origin API
// calls on ads.tiktok.com using the site session.

const TAG = "__CGMX__";
const MAX_CAPTURES = 50;

// Recursively find the array that looks like a campaign list.
function findCampaignArray(node, depth) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    if (
      node.length &&
      typeof node[0] === "object" &&
      node[0] &&
      ("campaign_name" in node[0] ||
        "campaign_id" in node[0] ||
        "campaign_opt_status" in node[0])
    ) {
      return node;
    }
    for (const it of node) {
      const r = findCampaignArray(it, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof node === "object") {
    for (const k of Object.keys(node)) {
      const r = findCampaignArray(node[k], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapCampaigns(arr) {
  return arr.map((c) => {
    const cost = num(c.lod_shop_cost ?? c.cost ?? c.basic_cost ?? c.stats_total_cost);
    const gmv = num(c.onsite_roi2_shopping_value ?? c.gmv ?? c.shopping_value);
    const orders = num(c.onsite_roi2_shopping_sku ?? c.onsite_roi2_shopping ?? c.orders);
    const roiField = num(c.onsite_roi2_roi ?? c.roi);
    return {
      id: String(c.campaign_id ?? c.campaign_id_str ?? c.id ?? ""),
      name: c.campaign_name ?? "(ไม่มีชื่อ)",
      status: String(c.campaign_status ?? c.campaign_primary_status ?? c.campaign_opt_status ?? ""),
      budget: num(c.campaign_budget ?? c.campaign_total_budget),
      cost,
      gmv,
      orders,
      roi: roiField > 0 ? roiField : cost > 0 ? gmv / cost : 0,
      channelId: String(
        c.tt_account_id ?? c.identity_id ?? c.template_ad_identity_id ?? c.tt_uid ?? ""
      ),
      channelName: c.tt_account_name ?? "",
      channelIcon: c.tt_account_avatar_icon ?? "",
      raw: c,
    };
  });
}

window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const data = ev.data;
  if (!data || data.source !== TAG || !data.entry) return;
  const e = data.entry;

  if (e.kind === "list" && e.resFull) {
    try {
      const json = JSON.parse(e.resFull);
      const arr = findCampaignArray(json, 0);
      if (arr) {
        chrome.storage.local.set({
          campaigns: mapCampaigns(arr),
          campaignsTs: e.ts,
        });
      }
    } catch {
      /* ignore parse errors */
    }
    return;
  }

  if (e.kind === "channels" && e.resFull) {
    try {
      const json = JSON.parse(e.resFull);
      const arr = findChannelArray(json, 0);
      if (arr && arr.length) {
        const mapped = arr.map(mapChannel).filter((c) => c.id && c.id !== "undefined");
        if (mapped.length) {
          // Merge with existing discovered channels (dedupe by id) AND remember
          // how this list was requested so we can replay it automatically.
          chrome.storage.local.get({ channelList: [] }, (res) => {
            const byId = new Map();
            for (const c of res.channelList || []) byId.set(c.id, c);
            for (const c of mapped) byId.set(c.id, { ...byId.get(c.id), ...c });
            chrome.storage.local.set({
              channelList: [...byId.values()],
              channelListTs: e.ts,
              channelRecipe: {
                url: e.url,
                method: e.method || "GET",
                headers: e.headers || {},
                reqBody: e.reqBody || null,
                ts: e.ts,
              },
            });
          });
        }
      }
    } catch {
      /* ignore parse errors */
    }
    return;
  }

  if (e.kind === "recipe") {
    chrome.storage.local.set({
      pauseRecipe: {
        url: e.url,
        method: e.method || "POST",
        headers: e.headers || {},
        reqBody: e.reqBody || "",
        ts: e.ts,
      },
    });
    return;
  }

  if (e.kind === "ctx") {
    try {
      const q = new URL(e.url, "https://ads.tiktok.com").searchParams;
      const ctx = {
        oec_seller_id: q.get("oec_seller_id") || "",
        aadvid: q.get("aadvid") || "",
        bc_id: q.get("bc_id") || "",
      };
      if (ctx.aadvid)
        chrome.storage.local.set({ ctx, headerTemplate: e.headers || {} });
    } catch {
      /* ignore */
    }
    return;
  }

  if (e.kind === "capture") {
    chrome.storage.local.get({ captures: [] }, (res) => {
      const list = res.captures || [];
      const key = `${e.method} ${e.url.split("?")[0]}`;
      const idx = list.findIndex(
        (c) => `${c.method} ${c.url.split("?")[0]}` === key
      );
      const rec = {
        method: e.method,
        url: e.url.split("?")[0],
        reqBody: e.reqBody || null,
        resSample: e.resSample || "",
        ts: e.ts,
      };
      if (idx >= 0) list[idx] = rec;
      else list.unshift(rec);
      chrome.storage.local.set({ captures: list.slice(0, MAX_CAPTURES) });
    });
  }
});

const CHANNEL_KEYS = [
  "tt_uid", "tt_account_id", "account_id", "identity_id", "nickname",
  "store_id", "shop_id", "store_name", "shop_name", "bc_id",
];
function findChannelArray(node, depth) {
  if (!node || depth > 7) return null;
  if (Array.isArray(node)) {
    if (
      node.length &&
      typeof node[0] === "object" &&
      node[0] &&
      CHANNEL_KEYS.some((k) => k in node[0])
    )
      return node;
    for (const it of node) {
      const r = findChannelArray(it, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof node === "object")
    for (const k of Object.keys(node)) {
      const r = findChannelArray(node[k], depth + 1);
      if (r) return r;
    }
  return null;
}
function mapChannel(c) {
  return {
    id: String(
      c.tt_uid ?? c.tt_account_id ?? c.account_id ?? c.identity_id ??
        c.store_id ?? c.shop_id ?? c.id ?? ""
    ),
    name:
      c.name ?? c.nickname ?? c.account_name ?? c.tt_account_name ??
      c.store_name ?? c.shop_name ?? "(ไม่มีชื่อ)",
    icon:
      c.avatar ?? c.avatar_url ?? c.tt_account_avatar_icon ?? c.icon ??
      c.store_logo ?? c.logo ?? "",
  };
}
function sanitizeHeaders(h) {
  const out = {};
  const drop = ["cookie", "content-length", "host", "user-agent", "accept-encoding", "connection"];
  for (const k of Object.keys(h || {})) if (!drop.includes(k.toLowerCase())) out[k] = h[k];
  out["Content-Type"] = "application/json";
  return out;
}

// Execute an API call on the page origin (cookies + optional captured headers).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "CGMX_SYNC") {
    (async () => {
      try {
        const st = await chrome.storage.local.get({
          ctx: null, headerTemplate: {}, channelList: [], channelRecipe: null,
        });
        const ctx = st.ctx;
        // Channels already discovered live from the create-campaign dropdown.
        const discovered = st.channelList || [];

        const hdr = sanitizeHeaders(st.headerTemplate);
        const out = { ctxUsed: ctx, probes: {}, errors: [], recipePages: 0 };
        const parsed = {};
        let chSource = discovered.length ? "หน้าสร้างแคมเปญ" : "";

        // Auto-replay the learned channel-list request (from the create-campaign
        // dropdown). Once captured, this fetches ALL channels with no manual step.
        const recipeChannels = [];
        if (st.channelRecipe && st.channelRecipe.url) {
          const rec = st.channelRecipe;
          const rHdr = sanitizeHeaders(rec.headers);
          let bodyObj = null;
          try { bodyObj = rec.reqBody ? JSON.parse(rec.reqBody) : null; } catch { bodyObj = null; }
          const pageKey = bodyObj
            ? ["page", "page_no", "cursor", "offset"].find((k) => k in bodyObj)
            : null;
          for (let p = 1; p <= 20; p++) {
            let url = rec.url;
            let body = rec.reqBody;
            if (bodyObj && pageKey) {
              bodyObj[pageKey] = pageKey === "offset" ? (p - 1) * (bodyObj.count || bodyObj.limit || 20) : p;
              body = JSON.stringify(bodyObj);
            }
            try {
              const r = await fetch(url, {
                method: rec.method || "GET",
                credentials: "include",
                headers: rHdr,
                body: rec.method && rec.method !== "GET" ? body : undefined,
              });
              const j = await r.json();
              if (p === 1) out.probes.channelRecipe = j;
              const arr = findChannelArray(j, 0) || [];
              const mapped = arr.map(mapChannel).filter((c) => c.id && c.id !== "undefined");
              out.recipePages = p;
              recipeChannels.push(...mapped);
              // Stop when a page returns nothing new / no pagination available.
              if (!pageKey || arr.length === 0) break;
              if (mapped.length === 0) break;
            } catch (e) {
              out.errors.push(`channelRecipe p${p}: ${e}`);
              break;
            }
          }
          if (recipeChannels.length && !discovered.length) chSource = "auto (จำจากหน้าสร้าง)";
        }

        if (ctx && ctx.aadvid) {
          const qs = `locale=th&language=th&oec_seller_id=${ctx.oec_seller_id}&aadvid=${ctx.aadvid}&bc_id=${ctx.bc_id}`;
          const B = "https://ads.tiktok.com/api/oec_shopping/v1";

          const getEps = [
            ["tt_list", `${B}/oec/tt_list?${qs}`],
            ["identity_list", `${B}/creation/identity_list?${qs}`],
            ["get_current_bind_info", `${B}/oec/get_current_bind_info?${qs}`],
            ["shop_allow_list", `${B}/oec/shop_allow_list?${qs}`],
          ];
          for (const [name, url] of getEps) {
            try {
              const r = await fetch(url, { credentials: "include", headers: hdr });
              out.probes[name] = await r.json();
            } catch (e) {
              out.errors.push(`${name}: ${e}`);
            }
          }

          try {
            const today = new Date().toISOString().slice(0, 10);
            const body = {
              query_list: [
                "campaign_id", "campaign_name", "campaign_opt_status",
                "campaign_primary_status", "campaign_status", "campaign_budget",
                "campaign_total_budget", "tt_account_id", "tt_account_name",
                "tt_account_avatar_icon", "template_ad_identity_id", "identity_id",
                "lod_shop_cost", "cost", "onsite_roi2_shopping_value",
                "onsite_roi2_shopping_sku", "onsite_roi2_shopping",
                "cost_per_onsite_roi2_shopping_sku", "onsite_roi2_roi",
              ],
              start_time: today, end_time: today, order_field: "lod_shop_cost",
              order_type: 0, page: 1, campaign_shop_automation_type: 2,
              external_type_list: ["307", "304", "305"],
            };
            const r = await fetch(`${B}/oec/stat/post_campaign_list?${qs}`, {
              method: "POST", credentials: "include", headers: hdr, body: JSON.stringify(body),
            });
            out.probes.post_campaign_list = await r.json();
          } catch (e) {
            out.errors.push("post_campaign_list: " + e);
          }

          const cpArr = findCampaignArray(out.probes.post_campaign_list, 0);
          if (cpArr) parsed.campaigns = mapCampaigns(cpArr);
        } else {
          out.errors.push("ไม่มี ctx (aadvid) — โหลดได้เฉพาะช่องที่ดักจากหน้าเว็บ");
        }

        // Merge channels from all sources (dedupe by id), starting with the
        // ones the interceptor already grabbed from the create-campaign page.
        const byId = new Map();
        for (const c of discovered) if (c.id) byId.set(c.id, c);
        for (const c of recipeChannels) byId.set(c.id, { ...byId.get(c.id), ...c });
        for (const name of ["tt_list", "identity_list", "get_current_bind_info", "shop_allow_list"]) {
          const arr = findChannelArray(out.probes[name], 0);
          if (arr) for (const c of arr.map(mapChannel)) {
            if (c.id && c.id !== "undefined") {
              byId.set(c.id, { ...byId.get(c.id), ...c });
              if (!chSource) chSource = name;
            }
          }
        }
        if (byId.size === 0 && parsed.campaigns) {
          for (const c of parsed.campaigns) {
            const id = c.channelId || "__current__";
            if (!byId.has(id))
              byId.set(id, { id, name: c.channelName || "ร้านปัจจุบัน", icon: c.channelIcon || "" });
          }
          if (byId.size) chSource = "campaigns";
        }
        if (byId.size) parsed.channelList = [...byId.values()];

        out.channelSource = chSource;
        await chrome.storage.local.set({ syncRaw: out, ...parsed, syncTs: Date.now() });
        sendResponse({
          ok: true,
          channels: parsed.channelList ? parsed.channelList.length : 0,
          campaigns: parsed.campaigns ? parsed.campaigns.length : 0,
          source: chSource,
          errors: out.errors,
        });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
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
