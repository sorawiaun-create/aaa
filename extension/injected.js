// Runs in the PAGE (MAIN world) on ads.tiktok.com so it shares the site's
// logged-in session. It patches fetch/XHR to observe the internal APIs the
// TikTok Ads Manager UI calls (especially GMV Max), and forwards a summary to
// the extension's isolated content script via window.postMessage.
//
// This is the "learn" mechanism: use the TikTok UI normally (list, pause,
// change budget, create) and the extension records the exact endpoints so we
// can replay them for automation.
(function () {
  const TAG = "__CGMX__";

  // Which requests we care about (TikTok internal ad APIs).
  function isInteresting(url) {
    try {
      const u = String(url).toLowerCase();
      return (
        u.includes("gmv") ||
        u.includes("campaign") ||
        u.includes("/report") ||
        u.includes("smart_plus")
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

  function summarizeBody(body) {
    try {
      if (!body) return null;
      if (typeof body === "string") return body.slice(0, 2000);
      if (body instanceof URLSearchParams) return body.toString().slice(0, 2000);
      return null;
    } catch {
      return null;
    }
  }

  // --- patch fetch ---
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    const method =
      (init && init.method) ||
      (typeof input === "object" && input && input.method) ||
      "GET";
    const interesting = isInteresting(url);
    let reqBody = null;
    if (interesting && init && init.body) reqBody = summarizeBody(init.body);

    const res = await origFetch.apply(this, arguments);
    if (interesting) {
      try {
        const clone = res.clone();
        clone
          .text()
          .then((t) =>
            post({
              via: "fetch",
              method: String(method).toUpperCase(),
              url: String(url),
              reqBody,
              resSample: t.slice(0, 1500),
              ts: Date.now(),
            })
          )
          .catch(() => {});
      } catch {
        post({ via: "fetch", method, url: String(url), reqBody, ts: Date.now() });
      }
    }
    return res;
  };

  // --- patch XHR ---
  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OrigXHR();
    let _url = "";
    let _method = "GET";
    const open = xhr.open;
    xhr.open = function (m, u) {
      _method = m;
      _url = u;
      return open.apply(xhr, arguments);
    };
    const send = xhr.send;
    xhr.send = function (body) {
      if (isInteresting(_url)) {
        const reqBody = summarizeBody(body);
        xhr.addEventListener("load", function () {
          let resSample = "";
          try {
            resSample = String(xhr.responseText || "").slice(0, 1500);
          } catch {
            /* ignore */
          }
          post({
            via: "xhr",
            method: String(_method).toUpperCase(),
            url: String(_url),
            reqBody,
            resSample,
            ts: Date.now(),
          });
        });
      }
      return send.apply(xhr, arguments);
    };
    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;

  post({ via: "system", url: "__ready__", method: "-", ts: Date.now() });
})();
