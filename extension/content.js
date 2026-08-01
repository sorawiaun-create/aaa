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

function findChannelArray(node, depth) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    if (
      node.length &&
      typeof node[0] === "object" &&
      node[0] &&
      ("tt_uid" in node[0] ||
        "tt_account_id" in node[0] ||
        "account_id" in node[0] ||
        "identity_id" in node[0] ||
        "nickname" in node[0])
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
    id: String(c.tt_uid ?? c.tt_account_id ?? c.account_id ?? c.identity_id ?? c.id ?? ""),
    name: c.name ?? c.nickname ?? c.account_name ?? c.tt_account_name ?? "(ไม่มีชื่อ)",
    icon: c.avatar ?? c.avatar_url ?? c.tt_account_avatar_icon ?? c.icon ?? "",
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
      const st = await chrome.storage.local.get({ ctx: null, headerTemplate: {} });
      const ctx = st.ctx;
      if (!ctx || !ctx.aadvid) {
        sendResponse({
          ok: false,
          error: "ยังไม่มี context — เปิดหน้า GMV Max แล้วกดปุ่มในหน้าสัก 1 ครั้งก่อน",
        });
        return;
      }
      const hdr = sanitizeHeaders(st.headerTemplate);
      const qs = `locale=th&language=th&oec_seller_id=${ctx.oec_seller_id}&aadvid=${ctx.aadvid}&bc_id=${ctx.bc_id}`;
      const B = "https://ads.tiktok.com";
      const out = { channelsRaw: null, campaignsRaw: null, errors: [] };
      try {
        const r = await fetch(`${B}/api/oec_shopping/v1/oec/tt_list?${qs}`, {
          credentials: "include",
          headers: hdr,
        });
        out.channelsRaw = await r.json();
      } catch (e) {
        out.errors.push("tt_list: " + e);
      }
      try {
        const today = new Date().toISOString().slice(0, 10);
        const body = {
          query_list: [
            "campaign_id", "campaign_name", "campaign_opt_status",
            "campaign_primary_status", "campaign_status", "campaign_budget",
            "campaign_total_budget", "tt_account_name", "tt_account_avatar_icon",
            "template_ad_identity_id", "lod_shop_cost", "cost",
            "onsite_roi2_shopping_value", "onsite_roi2_shopping_sku",
            "onsite_roi2_shopping", "cost_per_onsite_roi2_shopping_sku",
          ],
          start_time: today, end_time: today, order_field: "lod_shop_cost",
          order_type: 0, page: 1, campaign_shop_automation_type: 2,
          external_type_list: ["307", "304", "305"],
        };
        const r = await fetch(
          `${B}/api/oec_shopping/v1/oec/stat/post_campaign_list?${qs}`,
          { method: "POST", credentials: "include", headers: hdr, body: JSON.stringify(body) }
        );
        out.campaignsRaw = await r.json();
      } catch (e) {
        out.errors.push("post_campaign_list: " + e);
      }

      const parsed = {};
      const chArr = findChannelArray(out.channelsRaw, 0);
      if (chArr) parsed.channelList = chArr.map(mapChannel).filter((c) => c.id);
      const cpArr = findCampaignArray(out.campaignsRaw, 0);
      if (cpArr) parsed.campaigns = mapCampaigns(cpArr);

      await chrome.storage.local.set({ syncRaw: out, ...parsed, syncTs: Date.now() });
      sendResponse({
        ok: true,
        channels: parsed.channelList ? parsed.channelList.length : 0,
        campaigns: parsed.campaigns ? parsed.campaigns.length : 0,
        errors: out.errors,
      });
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
