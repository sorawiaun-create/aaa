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

function mapCampaigns(arr) {
  return arr.map((c) => ({
    id: String(c.campaign_id ?? c.campaign_id_str ?? c.id ?? ""),
    name: c.campaign_name ?? "(ไม่มีชื่อ)",
    status: String(c.campaign_opt_status ?? c.campaign_primary_status ?? ""),
    budget: c.campaign_budget ?? c.lod_shop_budget ?? null,
    cost: c.lod_shop_cost ?? null,
    raw: c,
  }));
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

  if (e.kind === "capture") {
    chrome.storage.local.get({ captures: [] }, (res) => {
      const list = res.captures || [];
      const key = `${e.method} ${e.url.split("?")[0]}`;
      const idx = list.findIndex(
        (c) => `${c.method} ${c.url.split("?")[0]}` === key
      );
      const rec = {
        method: e.method,
        url: e.url,
        reqBody: e.reqBody || null,
        ts: e.ts,
      };
      if (idx >= 0) list[idx] = rec;
      else list.unshift(rec);
      chrome.storage.local.set({ captures: list.slice(0, MAX_CAPTURES) });
    });
  }
});

// Execute an API call on the page origin (cookies + optional captured headers).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
