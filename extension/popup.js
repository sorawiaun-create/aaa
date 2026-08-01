const DEFAULTS = {
  enabled: false,
  intervalMinutes: 10,
  telegramToken: "",
  telegramChatId: "",
};

const $ = (id) => document.getElementById(id);

function load() {
  chrome.storage.local.get({ ...DEFAULTS, captures: [] }, (cfg) => {
    $("enabled").checked = !!cfg.enabled;
    $("interval").value = cfg.intervalMinutes;
    $("tgToken").value = cfg.telegramToken;
    $("tgChat").value = cfg.telegramChatId;
    renderCaptures(cfg.captures || []);
  });
}

function renderCaptures(list) {
  const box = $("caps");
  if (!list.length) {
    box.innerHTML =
      '<div class="muted">ยังไม่มี — เปิด ads.tiktok.com หน้า GMV Max แล้วลองกดปุ่มต่างๆ</div>';
    return;
  }
  box.innerHTML = list
    .map((c) => {
      const path = c.url.split("?")[0];
      const body = c.reqBody
        ? `<div class="b">body: ${escapeHtml(String(c.reqBody).slice(0, 300))}</div>`
        : "";
      return `<div class="cap"><span class="m">${c.method}</span><span class="u">${escapeHtml(
        path
      )}</span>${body}</div>`;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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
    $("msg").textContent = r && r.ok ? "ส่งสำเร็จ ✓ เช็ค Telegram" : `ผิดพลาด: ${(r && r.error) || "?"}`;
  });
});

$("clearCap").addEventListener("click", () => {
  chrome.storage.local.set({ captures: [] }, load);
});

// Live-refresh the capture list while the popup is open.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.captures) renderCaptures(changes.captures.newValue || []);
});

load();
