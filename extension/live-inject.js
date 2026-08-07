// MAIN-world interceptor on shop.tiktok.com (TikTok Shop Seller Center).
// Captures the internal API responses behind the LIVE dashboard (sales,
// orders, products, viewers) so the extension can feed live signals to the
// autopilot. We don't know the exact endpoints yet, so match broadly and let
// the isolated bridge parse/store what looks like live stats.
(function () {
  const TAG = "__CGMXLIVE__";

  function interesting(url) {
    try {
      const u = String(url).toLowerCase();
      return (
        u.includes("/api/") &&
        (u.includes("live") ||
          u.includes("room") ||
          u.includes("overview") ||
          u.includes("real_time") ||
          u.includes("realtime") ||
          u.includes("analytic") ||
          u.includes("dashboard") ||
          u.includes("statistic") ||
          u.includes("gmv") ||
          u.includes("order") ||
          u.includes("product") ||
          u.includes("trend"))
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

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    const res = await origFetch.apply(this, arguments);
    try {
      if (interesting(url)) {
        res
          .clone()
          .text()
          .then((t) => post({ url: String(url), body: String(t).slice(0, 200000), ts: Date.now() }))
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
    return res;
  };

  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OrigXHR();
    let _url = "";
    const open = xhr.open;
    xhr.open = function (m, u) {
      _url = u;
      return open.apply(xhr, arguments);
    };
    const send = xhr.send;
    xhr.send = function () {
      if (interesting(_url)) {
        xhr.addEventListener("load", function () {
          try {
            post({ url: String(_url), body: String(xhr.responseText || "").slice(0, 200000), ts: Date.now() });
          } catch {
            /* ignore */
          }
        });
      }
      return send.apply(xhr, arguments);
    };
    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;
})();
