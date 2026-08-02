// MAIN-world interceptor on ads.tiktok.com. Observes the internal APIs the
// GMV Max UI calls, capturing the exact request (incl. headers) so we can
// replay them for automation, and stashing the campaign-list response.
(function () {
  const TAG = "__CGMX__";
  const LIST_EP = "/oec/stat/post_campaign_list";
  const STATUS_EP = "/creation/campaign/update_status";
  const CREATE_EP = "/creation/all_ad_data/create";
  const BUDGET_EP = "/creation/all_ad_data/update";
  // Endpoints that carry the seller's LIVE/TikTok-account (channel) list —
  // e.g. the "แหล่งที่มาของ LIVE / ค้นหาตามชื่อผู้ใช้" dropdown on the
  // create-campaign page. Capture their full response so we can list channels.
  const CHAN_EPS = [
    "identity_list", "tt_list", "get_current_bind_info", "shop_allow_list",
    "identity", "author", "anchor", "tt_account", "account_list", "creator",
  ];

  function isInteresting(url) {
    try {
      const u = String(url).toLowerCase();
      return (
        u.includes("gmv") ||
        u.includes("campaign") ||
        u.includes("/report") ||
        u.includes("smart_plus") ||
        u.includes("oec_shopping") ||
        u.includes("store") ||
        u.includes("/shop") ||
        u.includes("identity") ||
        u.includes("seller") ||
        u.includes("account")
      );
    } catch {
      return false;
    }
  }

  function post(entry) {
    try {
      window.postMessage({ source: TAG, entry }, "*");
    } catch {
      /* ignore */
    }
  }

  function headersToObj(h) {
    const out = {};
    try {
      if (!h) return out;
      if (h instanceof Headers) {
        h.forEach((v, k) => (out[k] = v));
      } else if (Array.isArray(h)) {
        for (const [k, v] of h) out[k] = v;
      } else if (typeof h === "object") {
        for (const k of Object.keys(h)) out[k] = h[k];
      }
    } catch {
      /* ignore */
    }
    return out;
  }

  function bodyToStr(body) {
    try {
      if (!body) return null;
      if (typeof body === "string") return body;
      if (body instanceof URLSearchParams) return body.toString();
      return null;
    } catch {
      return null;
    }
  }

  function classify(url, method, headers, reqBody, resText) {
    const u = String(url);
    const ul = u.toLowerCase();
    if (u.includes(LIST_EP) && resText) {
      post({ kind: "list", url: u, resFull: resText.slice(0, 200000), ts: Date.now() });
    }
    if (resText && CHAN_EPS.some((ep) => ul.includes(ep))) {
      post({
        kind: "channels",
        url: u,
        method: String(method).toUpperCase(),
        headers,
        reqBody,
        resFull: resText.slice(0, 200000),
        ts: Date.now(),
      });
    }
    if (u.includes(STATUS_EP)) {
      post({
        kind: "recipe",
        url: u,
        method: String(method).toUpperCase(),
        headers,
        reqBody,
        ts: Date.now(),
      });
    }
    // Record a real "create campaign" request so we can replay it (with a new
    // ROI/budget/name) when a trigger fires.
    if (u.includes(CREATE_EP) && reqBody) {
      post({
        kind: "createRecipe",
        url: u,
        method: String(method).toUpperCase(),
        headers,
        reqBody,
        ts: Date.now(),
      });
    }
    // Record a real "budget update" request (used for budget scaling).
    if (u.includes(BUDGET_EP) && reqBody) {
      post({
        kind: "budgetRecipe",
        url: u,
        method: String(method).toUpperCase(),
        headers,
        reqBody,
        ts: Date.now(),
      });
    }
    // Store a header template + request context from any oec_shopping POST so
    // the extension can call the internal APIs itself.
    if (u.includes("oec_shopping") && String(method).toUpperCase() === "POST") {
      post({ kind: "ctx", url: u, headers, ts: Date.now() });
    }
    // generic debug capture
    post({
      kind: "capture",
      via: "net",
      method: String(method).toUpperCase(),
      url: u,
      reqBody: reqBody ? String(reqBody).slice(0, 500) : null,
      resSample: resText ? resText.slice(0, 800) : "",
      ts: Date.now(),
    });
  }

  // --- patch fetch ---
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    const method =
      (init && init.method) || (input && input.method) || "GET";
    const interesting = isInteresting(url);
    const headers = interesting ? headersToObj(init && init.headers) : {};
    const reqBody = interesting && init ? bodyToStr(init.body) : null;

    const res = await origFetch.apply(this, arguments);
    if (interesting) {
      res
        .clone()
        .text()
        .then((t) => classify(url, method, headers, reqBody, t))
        .catch(() => classify(url, method, headers, reqBody, ""));
    }
    return res;
  };

  // --- patch XHR ---
  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OrigXHR();
    let _url = "";
    let _method = "GET";
    const _headers = {};
    const open = xhr.open;
    xhr.open = function (m, u) {
      _method = m;
      _url = u;
      return open.apply(xhr, arguments);
    };
    const setH = xhr.setRequestHeader;
    xhr.setRequestHeader = function (k, v) {
      try {
        _headers[k] = v;
      } catch {
        /* ignore */
      }
      return setH.apply(xhr, arguments);
    };
    const send = xhr.send;
    xhr.send = function (body) {
      if (isInteresting(_url)) {
        const reqBody = bodyToStr(body);
        xhr.addEventListener("load", function () {
          let resText = "";
          try {
            resText = String(xhr.responseText || "");
          } catch {
            /* ignore */
          }
          classify(_url, _method, _headers, reqBody, resText);
        });
      }
      return send.apply(xhr, arguments);
    };
    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;
})();
