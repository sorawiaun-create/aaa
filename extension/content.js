// Isolated-world content script. Bridges the page interceptor (injected.js) to
// extension storage, and can execute same-origin API calls on ads.tiktok.com
// using the site's session (for automation once endpoints are known).

const TAG = "__CGMX__";
const MAX_CAPTURES = 60;

// Receive captured API calls from the page and store a de-duplicated list.
window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const data = ev.data;
  if (!data || data.source !== TAG || !data.entry) return;
  const entry = data.entry;
  if (entry.url === "__ready__") return;

  chrome.storage.local.get({ captures: [] }, (res) => {
    const list = res.captures || [];
    const key = `${entry.method} ${entry.url.split("?")[0]}`;
    const idx = list.findIndex(
      (c) => `${c.method} ${c.url.split("?")[0]}` === key
    );
    const record = {
      method: entry.method,
      url: entry.url,
      reqBody: entry.reqBody || null,
      resSample: entry.resSample || "",
      via: entry.via,
      ts: entry.ts,
      count: idx >= 0 ? (list[idx].count || 1) + 1 : 1,
    };
    if (idx >= 0) list[idx] = record;
    else list.unshift(record);
    chrome.storage.local.set({ captures: list.slice(0, MAX_CAPTURES) });
  });
});

// Execute an API call in the page origin (cookies included) — used later for
// automation (pause / budget / create) once we know the exact request shape.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "CGMX_EXEC") {
    const { method, url, body, headers } = msg.req;
    fetch(url, {
      method: method || "GET",
      headers: headers || { "Content-Type": "application/json" },
      body: method && method !== "GET" ? body : undefined,
      credentials: "include",
    })
      .then(async (r) => {
        const text = await r.text();
        sendResponse({ ok: true, status: r.status, body: text.slice(0, 4000) });
      })
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
});
