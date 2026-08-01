const DEFAULTS = {
  enabled: false,
  intervalMinutes: 10,
  telegramToken: "",
  telegramChatId: "",
};

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function load() {
  chrome.storage.local.get(
    { ...DEFAULTS, captures: [], campaigns: [], pauseRecipe: null },
    (cfg) => {
      $("enabled").checked = !!cfg.enabled;
      $("interval").value = cfg.intervalMinutes;
      $("tgToken").value = cfg.telegramToken;
      $("tgChat").value = cfg.telegramChatId;
      renderCampaigns(cfg.campaigns || [], cfg.pauseRecipe);
      renderCaptures(cfg.captures || []);
    }
  );
}

function statusRunning(s) {
  const t = String(s).toUpperCase();
  return t.includes("ENABLE") || t === "1" || t.includes("DELIVER") || t.includes("ACTIVE");
}

function renderCampaigns(list, recipe) {
  $("learnHint").style.display = recipe ? "none" : "block";
  const box = $("camps");
  if (!list.length) {
    box.innerHTML =
      '<div class="muted">ยังไม่มีข้อมูล — เปิดหน้า GMV Max บน ads.tiktok.com แล้วกด “โหลดใหม่”</div>';
    return;
  }
  box.innerHTML = list
    .slice(0, 100)
    .map((c) => {
      const run = statusRunning(c.status);
      return `<div class="camp">
        <div class="n">${esc(c.name)}</div>
        <div class="meta">
          <span class="pill" style="background:${run ? "#123a2a" : "#2a2a34"};color:${run ? "#34d399" : "#a0a0ad"}">${run ? "กำลังรัน" : "ปิด/อื่นๆ"}</span>
          ${c.budget != null ? " · งบ " + esc(c.budget) : ""} · ID ${esc(c.id)}
        </div>
        <div class="acts">
          <button class="ghost" data-id="${esc(c.id)}" data-op="1">เปิด</button>
          <button class="primary" data-id="${esc(c.id)}" data-op="2">ปิด</button>
        </div>
      </div>`;
    })
    .join("");
  box.querySelectorAll("button[data-id]").forEach((b) => {
    b.addEventListener("click", () =>
      setStatus(b.getAttribute("data-id"), Number(b.getAttribute("data-op")), b)
    );
  });
}

function renderCaptures(list) {
  const box = $("caps");
  box.innerHTML = list.length
    ? list
        .slice(0, 20)
        .map(
          (c) =>
            `<div class="cap"><span class="m">${esc(c.method)}</span><span class="u">${esc(
              c.url.split("?")[0]
            )}</span></div>`
        )
        .join("")
    : '<div class="muted">ยังไม่มี</div>';
}

function sanitizeHeaders(h) {
  const out = {};
  const drop = ["cookie", "content-length", "host", "user-agent", "accept-encoding", "connection"];
  for (const k of Object.keys(h || {})) {
    if (drop.includes(k.toLowerCase())) continue;
    out[k] = h[k];
  }
  if (!Object.keys(out).some((k) => k.toLowerCase() === "content-type"))
    out["Content-Type"] = "application/json";
  return out;
}

function buildBody(recipe, campaignId, operation) {
  try {
    const obj = JSON.parse(recipe.reqBody);
    obj.campaign_list = [String(campaignId)];
    obj.operation = operation;
    return JSON.stringify(obj);
  } catch {
    return JSON.stringify({ campaign_list: [String(campaignId)], operation });
  }
}

function execOnTikTok(req, cb) {
  chrome.tabs.query({ url: "https://ads.tiktok.com/*" }, (tabs) => {
    if (!tabs.length) {
      cb({ ok: false, error: "เปิดแท็บ ads.tiktok.com ก่อน" });
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, { type: "CGMX_EXEC", req }, (resp) => {
      if (chrome.runtime.lastError)
        cb({ ok: false, error: chrome.runtime.lastError.message });
      else cb(resp);
    });
  });
}

function setStatus(campaignId, operation, btn) {
  chrome.storage.local.get({ pauseRecipe: null }, (s) => {
    if (!s.pauseRecipe) {
      $("msg").textContent =
        "ยังไม่ได้เรียนรู้คำสั่ง — ปิดแคมเปญ 1 ตัวในหน้า TikTok ด้วยมือก่อน 1 ครั้ง";
      return;
    }
    const r = s.pauseRecipe;
    const req = {
      method: "POST",
      url: r.url,
      headers: sanitizeHeaders(r.headers),
      body: buildBody(r, campaignId, operation),
    };
    const old = btn.textContent;
    btn.textContent = "…";
    execOnTikTok(req, (resp) => {
      btn.textContent = old;
      if (resp && resp.ok) {
        $("msg").textContent = `${operation === 2 ? "ปิด" : "เปิด"}แคมเปญแล้ว ✓ (${resp.status})`;
      } else {
        $("msg").textContent = `ผิดพลาด: ${(resp && resp.error) || "?"}`;
      }
    });
  });
}

function save() {
  const cfg = {
    enabled: $("enabled").checked,
    intervalMinutes: Math.max(1, Number($("interval").value) || 10),
    telegramToken: $("tgToken").value.trim(),
    telegramChatId: $("tgChat").value.trim(),
  };
  chrome.storage.local.set(cfg, () => {
    chrome.runtime.sendMessage({
      type: "CGMX_RESCHEDULE",
      intervalMinutes: cfg.intervalMinutes,
    });
    $("msg").textContent = "บันทึกแล้ว ✓";
    setTimeout(() => ($("msg").textContent = ""), 2000);
  });
}

$("save").addEventListener("click", save);
$("enabled").addEventListener("change", save);
$("testTg").addEventListener("click", () => {
  save();
  $("msg").textContent = "กำลังส่ง…";
  chrome.runtime.sendMessage({ type: "CGMX_TELEGRAM_TEST" }, (r) => {
    $("msg").textContent =
      r && r.ok ? "ส่งสำเร็จ ✓ เช็ค Telegram" : `ผิดพลาด: ${(r && r.error) || "?"}`;
  });
});
$("clearCap").addEventListener("click", () =>
  chrome.storage.local.set({ captures: [] }, load)
);
$("reloadTt").addEventListener("click", () => {
  chrome.tabs.query({ url: "https://ads.tiktok.com/*" }, (tabs) => {
    if (tabs.length) chrome.tabs.reload(tabs[0].id);
    $("msg").textContent = "สั่งโหลดหน้า TikTok ใหม่แล้ว รอสักครู่…";
  });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.campaigns || changes.pauseRecipe) load();
  else if (changes.captures) renderCaptures(changes.captures.newValue || []);
});

load();
