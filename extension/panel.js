const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

let STORE = {
  enabled: false,
  channels: [], // {id, name, icon, settings}
  telegramToken: "",
  telegramChatId: "",
  campaigns: [],
  pauseRecipe: null,
  lastRun: 0,
};
let view = "main";
let editingId = null;

function defaultSettings() {
  return {
    checkIntervalMin: 1,
    minBudgetBeforeCheck: 10,
    triggers: {
      roi: { on: true, value: 20 },
      cost: { on: true, value: 20 },
      spentNoOrder: { on: true, value: 50 },
    },
    actions: {
      pause: true,
      reduceBudgetBeforePause: true,
      createNew: false,
      createRoi: 1,
      createBudget: 300,
      telegram: false,
    },
    scaling: {
      enabled: false,
      mode: "percent", // time | percent | order
      scaleType: "fixed", // percent | fixed (how much to add)
      whenUsedPercent: 50,
      amount: 100,
      intervalMin: 15,
      cap: 10000,
    },
    onlyWhenLive: true,
    midnightReset: {
      enabled: false,
      budget: 300, // reset every running campaign's budget to this at 00:00 (Bangkok)
    },
    roiAuto: {
      enabled: false,
      step: 0.1, // adjust the ROI target by this each time
      margin: 1, // only adjust when actual ROI is this far from target
      min: 1,
      max: 5,
      intervalMin: 30,
    },
  };
}

function loadStore(cb) {
  chrome.storage.local.get(
    {
      enabled: false,
      channels: [],
      telegramToken: "",
      telegramChatId: "",
      campaigns: [],
      channelList: [],
      channelRecipe: null,
      pauseRecipe: null,
      createRecipe: null,
      budgetRecipe: null,
      logs: [],
      dailySummary: { enabled: false, hour: 20 },
      lastRun: 0,
      syncTs: 0,
    },
    (s) => {
      STORE = s;
      cb && cb();
    }
  );
}
function save(patch, cb) {
  Object.assign(STORE, patch);
  chrome.storage.local.set(patch, cb);
}

function availableChannels() {
  // Prefer the full channel list fetched via sync (all seller channels).
  if ((STORE.channelList || []).length) {
    return STORE.channelList.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      identityId: c.identityId || "",
      count: campaignsOf(c.id).length,
    }));
  }
  const map = new Map();
  for (const c of STORE.campaigns || []) {
    const id = c.channelId || "__current__";
    if (!map.has(id))
      map.set(id, {
        id,
        name: c.channelName || "ร้านปัจจุบัน",
        icon: c.channelIcon || "",
        count: 0,
      });
    map.get(id).count++;
  }
  return [...map.values()];
}
function channelMatch(c, ch) {
  if (!ch) return false;
  const cid = String(c.channelId || "");
  if (cid && (cid === String(ch.id) || cid === String(ch.identityId || ""))) return true;
  if (c.channelName && ch.name && c.channelName === ch.name) return true;
  return false;
}
function campaignsOf(channelId) {
  const ch =
    (STORE.channels || []).find((x) => x.id === channelId) ||
    (STORE.channelList || []).find((x) => x.id === channelId) ||
    { id: channelId };
  return (STORE.campaigns || []).filter((c) => channelMatch(c, ch));
}

/* ------------------------------ Views ------------------------------- */

function setHeader(title, showBack, right) {
  $("title").textContent = title;
  $("back").style.display = showBack ? "inline" : "none";
  $("headRight").innerHTML = right || "";
}

function go(v, id) {
  view = v;
  editingId = id ?? editingId;
  render();
}

function render() {
  if (view === "main") renderMain();
  else if (view === "add") renderAdd();
  else if (view === "detail") renderDetail();
  else if (view === "settings") renderSettings();
  else if (view === "report") renderReport();
  else if (view === "log") renderLog();
}

function fmt(n, d = 0) {
  return Number(n || 0).toLocaleString("th-TH", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}
// Send a message to the TikTok tab; if the content script is orphaned (extension
// was reloaded — "message port closed"), inject a fresh copy and retry once.
function sendToTikTok(msg, cb) {
  chrome.tabs.query({ url: "https://ads.tiktok.com/*" }, (tabs) => {
    if (!tabs.length) return cb({ ok: false, error: "เปิดแท็บ ads.tiktok.com (หน้า GMV Max) ก่อน" });
    const tabId = tabs[0].id;
    chrome.tabs.sendMessage(tabId, msg, (r) => {
      if (!chrome.runtime.lastError) return cb(r);
      chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }, () => {
        if (chrome.runtime.lastError) return cb({ ok: false, error: "inject: " + chrome.runtime.lastError.message });
        chrome.tabs.sendMessage(tabId, msg, (r2) =>
          cb(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r2)
        );
      });
    });
  });
}
// Is a campaign toggled ON? Prefer the explicit flag from mapCampaigns; fall
// back to reading the status string for older cached data.
function isOn(c) {
  if (typeof c.on === "boolean") return c.on;
  const t = String(c.status).toUpperCase();
  return t === "1" || t.includes("ENABLE");
}
// 3-state dot: green = delivering now, amber = on but waiting its turn, gray = off.
function stateColor(c) {
  if (c.state === "on" || c.delivering) return "var(--green)";
  if (c.state === "wait" || isOn(c)) return "#f5a623";
  return "#cfd8d7";
}

function renderMain() {
  setHeader(
    "GMV Max Monitor",
    false,
    '<span id="reload" title="โหลดใหม่" style="cursor:pointer">🔄</span>'
  );
  const t = STORE.lastRun ? new Date(STORE.lastRun).toLocaleTimeString("th-TH") : "-";
  const chans = STORE.channels || [];
  const app = $("app");
  app.innerHTML = `
    <div class="card">
      <div class="row">
        <div><b>เปิด/ปิดโปรแกรม</b><div class="muted">อัพเดทล่าสุด ${t}</div></div>
        <label class="switch"><input type="checkbox" id="prog" ${STORE.enabled ? "checked" : ""}><span class="slider"></span></label>
      </div>
      <div class="muted" style="margin-top:8px">
        <span class="status-dot" style="background:${STORE.enabled ? "var(--green)" : "#cfd8d7"}"></span>
        ${STORE.enabled ? "กำลังมอนิเตอร์ — เปิดคอมและหน้า GMV Max ไว้" : "หยุดชั่วคราว"}
      </div>
    </div>
    <div class="sec">ช่องที่ดูแล (${chans.length})</div>
    ${
      chans.length
        ? chans
            .map(
              (c) => `<div class="chan" data-edit="${esc(c.id)}">
        <div class="av">${c.icon ? `<img src="${esc(c.icon)}">` : esc((c.name || "?")[0])}</div>
        <div><div class="nm">${esc(c.name)}</div><div class="id">${campaignsOf(c.id).length} แคมเปญ${c.settings?.actions?.pause ? " · ปิดอัตโนมัติ" : ""}</div></div>
        <span class="chev">›</span></div>`
            )
            .join("")
        : '<div class="muted" style="padding:4px 2px 10px">ยังไม่มีช่อง — กด “เพิ่มช่องใหม่” ด้านล่าง</div>'
    }
    <div class="addbtn" id="addChan">+ เพิ่มช่องใหม่</div>
    <div class="row" style="margin-top:10px;gap:8px">
      <button class="ghost" id="reportBtn" style="flex:1">📊 รายงานรวม</button>
      <button class="ghost" id="logBtn" style="flex:1">📜 ประวัติการทำงาน</button>
    </div>
    <div class="card" style="margin-top:10px">
      <button class="primary" id="syncBtn">🔄 ดึงช่อง + ข้อมูลแคมเปญ (Sync)</button>
      <div class="muted" style="margin-top:6px">${STORE.syncTs ? "ซิงค์ล่าสุด " + new Date(STORE.syncTs).toLocaleTimeString("th-TH") : "ยังไม่เคยซิงค์"} · เจอช่องแล้ว ${(STORE.channelList || []).length}</div>
      <div class="muted" style="margin-top:2px">เปิดหน้า GMV Max บน ads.tiktok.com ค้างไว้ — ระบบดึงช่อง+แคมเปญเองอัตโนมัติ</div>
      <div class="msg" id="syncMsg"></div>
    </div>
    <div class="sec">อื่นๆ</div>
    <div class="card">
      <div class="row"><label>แจ้งเตือน Telegram Token</label></div>
      <input class="search" id="tgToken" placeholder="123456:ABC…" value="${esc(STORE.telegramToken)}" style="width:100%;margin:6px 0">
      <input class="search" id="tgChat" placeholder="Chat ID" value="${esc(STORE.telegramChatId)}" style="width:100%">
      <div class="row" style="margin-top:8px"><button class="ghost" id="tgSave">บันทึก</button><button class="ghost" id="tgTest">ทดสอบส่ง</button></div>
      <div class="msg" id="msg"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:12px 0">
      <label class="row" style="cursor:pointer"><span>สรุปยอดรายวันทาง Telegram</span>
        <input type="checkbox" id="dsEn" ${STORE.dailySummary?.enabled ? "checked" : ""}></label>
      <div class="row" style="margin-top:8px"><label>ส่งเวลา (น.)</label>
        <select id="dsHour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${(STORE.dailySummary?.hour ?? 20) === h ? "selected" : ""}>${String(h).padStart(2, "0")}:00</option>`).join("")}</select></div>
      <div class="row" style="margin-top:8px"><button class="ghost" id="dsSave">บันทึกสรุปรายวัน</button><button class="ghost" id="dsTest">ทดสอบส่งสรุป</button></div>
      <div class="msg" id="dsMsg"></div>
    </div>
    <div class="card">
      <div class="row" style="gap:8px">
        <button class="ghost" id="exportBtn" style="flex:1">⬆️ Export ตั้งค่า</button>
        <button class="ghost" id="importBtn" style="flex:1">⬇️ Import ตั้งค่า</button>
      </div>
      <input type="file" id="importFile" accept="application/json" style="display:none">
      <div class="msg" id="ioMsg"></div>
      <div class="muted" style="margin-top:8px">
        <button class="ghost" id="dlDbg" style="width:100%">⬇️ ดาวน์โหลด debug ทั้งไฟล์ (ส่งให้ผม)</button>
      </div>
    </div>`;

  $("prog").addEventListener("change", (e) =>
    save({ enabled: e.target.checked }, () => {
      chrome.runtime.sendMessage({ type: "CGMX_RESCHEDULE" });
      renderMain();
    })
  );
  $("addChan").addEventListener("click", () => go("add"));
  $("reportBtn").addEventListener("click", () => go("report"));
  $("logBtn").addEventListener("click", () => go("log"));
  $("reload").addEventListener("click", reloadTikTok);
  app.querySelectorAll("[data-edit]").forEach((el) =>
    el.addEventListener("click", () => go("detail", el.getAttribute("data-edit")))
  );
  $("tgSave").addEventListener("click", () =>
    save(
      { telegramToken: $("tgToken").value.trim(), telegramChatId: $("tgChat").value.trim() },
      () => ($("msg").textContent = "บันทึกแล้ว ✓")
    )
  );
  $("tgTest").addEventListener("click", () => {
    save({ telegramToken: $("tgToken").value.trim(), telegramChatId: $("tgChat").value.trim() });
    $("msg").textContent = "กำลังส่ง…";
    chrome.runtime.sendMessage({ type: "CGMX_TELEGRAM_TEST" }, (r) => {
      $("msg").textContent = r && r.ok ? "ส่งสำเร็จ ✓" : `ผิดพลาด: ${(r && r.error) || "?"}`;
    });
  });
  $("dsSave").addEventListener("click", () =>
    save(
      { dailySummary: { enabled: $("dsEn").checked, hour: Number($("dsHour").value) } },
      () => {
        chrome.runtime.sendMessage({ type: "CGMX_RESCHEDULE" });
        $("dsMsg").textContent = "บันทึกแล้ว ✓";
      }
    )
  );
  $("dsTest").addEventListener("click", () => {
    $("dsMsg").textContent = "กำลังส่ง…";
    chrome.runtime.sendMessage({ type: "CGMX_DAILY_TEST" }, () => {
      $("dsMsg").textContent = "ส่งแล้ว — เช็ค Telegram";
    });
  });
  $("exportBtn").addEventListener("click", exportSettings);
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", importSettings);
  $("dlDbg").addEventListener("click", downloadDebug);
  $("syncBtn").addEventListener("click", () => {
    $("syncMsg").textContent = "กำลังดึงข้อมูล…";
    chrome.tabs.query({ url: "https://ads.tiktok.com/*" }, (tabs) => {
      if (!tabs.length) {
        $("syncMsg").textContent = "เปิดแท็บ ads.tiktok.com (หน้า GMV Max) ก่อน";
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type: "CGMX_SYNC" }, (r) => {
        if (chrome.runtime.lastError) {
          $("syncMsg").textContent =
            "เชื่อมต่อแท็บไม่ได้ — กรุณา รีเฟรช (F5) หน้า ads.tiktok.com แล้วกด Sync ใหม่";
          return;
        }
        if (!r || !r.ok) {
          $("syncMsg").textContent = "ผิดพลาด: " + ((r && r.error) || "?");
          return;
        }
        $("syncMsg").textContent =
          `ได้ ${r.channels} ช่อง · ${r.campaigns} แคมเปญ` +
          (r.source ? ` (จาก ${r.source})` : "") +
          (r.channels === 0 ? " — กด ⬇️ ดาวน์โหลด debug ส่งให้ผมด้วยครับ" : " ✓");
        loadStore(render);
      });
    });
  });
}

function exportSettings() {
  const data = {
    _type: "chobtham-gmvmax-settings",
    version: 1,
    exportedAt: new Date().toISOString(),
    channels: STORE.channels || [],
    telegramToken: STORE.telegramToken || "",
    telegramChatId: STORE.telegramChatId || "",
    dailySummary: STORE.dailySummary || { enabled: false, hour: 20 },
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "chobtham-gmvmax-settings.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  $("ioMsg").textContent = "Export แล้ว — เก็บไฟล์ chobtham-gmvmax-settings.json ไว้";
}

function importSettings(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (d._type !== "chobtham-gmvmax-settings" || !Array.isArray(d.channels))
        throw new Error("ไฟล์ไม่ถูกต้อง");
      if (!confirm(`นำเข้า ${d.channels.length} ช่อง? (ทับการตั้งค่าเดิม)`)) return;
      save(
        {
          channels: d.channels,
          telegramToken: d.telegramToken || STORE.telegramToken || "",
          telegramChatId: d.telegramChatId || STORE.telegramChatId || "",
          dailySummary: d.dailySummary || STORE.dailySummary || { enabled: false, hour: 20 },
        },
        () => {
          chrome.runtime.sendMessage({ type: "CGMX_RESCHEDULE" });
          $("ioMsg").textContent = "นำเข้าสำเร็จ ✓";
          render();
        }
      );
    } catch (e) {
      $("ioMsg").textContent = "ผิดพลาด: " + (e.message || e);
    }
  };
  reader.readAsText(file);
}

function downloadDebug() {
  chrome.storage.local.get(null, (all) => {
    const data = {
      campaigns: all.campaigns || [],
      channelList: all.channelList || [],
      captures: all.captures || [],
      syncRaw: all.syncRaw || null,
      channelRecipe: all.channelRecipe
        ? { url: all.channelRecipe.url, method: all.channelRecipe.method, reqBody: all.channelRecipe.reqBody }
        : null,
      pauseRecipe: all.pauseRecipe
        ? { url: all.pauseRecipe.url, reqBody: all.pauseRecipe.reqBody }
        : null,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gmvmax-debug.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    $("msg").textContent = "ดาวน์โหลดแล้ว — ส่งไฟล์ gmvmax-debug.json ให้ผม";
  });
}

function renderAdd() {
  setHeader("เพิ่มช่อง", true);
  const added = new Set((STORE.channels || []).map((c) => c.id));
  const avail = availableChannels().filter((c) => !added.has(c.id));
  const app = $("app");
  app.innerHTML = `
    <div class="note">💡 <b>วิธีให้เห็นครบทุกช่อง:</b> ไปหน้า <b>สร้างแคมเปญ</b> บน TikTok →
      กดช่อง <b>“แหล่งที่มาของ LIVE / ค้นหาชื่อผู้ใช้ TikTok”</b> ให้รายชื่อช่องเด้งขึ้นมา
      (เลื่อนดูให้ครบ) — ระบบจะดักรายชื่อทั้งหมดอัตโนมัติ แล้วกลับมากด Sync</div>
    <input class="search" id="q" placeholder="ค้นหาชื่อช่อง...">
    <div id="list">${
      avail.length ? "" : '<div class="muted">ยังไม่เห็นช่อง — เปิดหน้า GMV Max ก่อน</div>'
    }</div>`;
  const render = (f) => {
    $("list").innerHTML = avail
      .filter((c) => !f || c.name.toLowerCase().includes(f.toLowerCase()))
      .map(
        (c) => `<div class="chan" data-add="${esc(c.id)}">
        <div class="av">${c.icon ? `<img src="${esc(c.icon)}">` : esc((c.name || "?")[0])}</div>
        <div><div class="nm">${esc(c.name)}</div><div class="id">${esc(c.id)} · ${c.count} แคมเปญ</div></div>
        <span class="chev">›</span></div>`
      )
      .join("");
    $("list")
      .querySelectorAll("[data-add]")
      .forEach((el) =>
        el.addEventListener("click", () => addChannel(el.getAttribute("data-add")))
      );
  };
  render("");
  $("q").addEventListener("input", (e) => render(e.target.value));
}

function addChannel(id) {
  const src = availableChannels().find((c) => c.id === id);
  const ch = {
    id,
    name: src ? src.name : id,
    icon: src ? src.icon : "",
    identityId: src ? src.identityId || "" : "",
    settings: defaultSettings(),
  };
  const channels = [...(STORE.channels || []), ch];
  save({ channels }, () => go("settings", id));
}

function renderLog() {
  setHeader("ประวัติการทำงาน", true, '<span id="clearLog" title="ล้าง" style="cursor:pointer">🗑</span>');
  const logs = STORE.logs || [];
  const app = $("app");
  app.innerHTML = `
    <div class="muted" style="margin-bottom:8px">บันทึกการปิด / สร้าง / สเกลงบ / ปรับ ROI / รีเซต (ล่าสุด ${logs.length})</div>
    <div class="card clist">
      ${
        logs.length
          ? logs
              .map(
                (l) => `<div class="crow">
        <span class="dot" style="background:${l.ok ? "var(--green)" : "var(--red)"}"></span>
        <span class="cn" style="white-space:normal">${esc(l.text)}</span>
        <span class="muted" style="min-width:70px;text-align:right">${new Date(l.ts).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
      </div>`
              )
              .join("")
          : '<div class="muted">ยังไม่มีประวัติ — เมื่อระบบปิด/สร้าง/สเกลงบ จะบันทึกไว้ที่นี่</div>'
      }
    </div>`;
  $("clearLog").addEventListener("click", () => {
    if (!confirm("ล้างประวัติทั้งหมด?")) return;
    save({ logs: [] }, () => renderLog());
  });
}

function renderReport() {
  setHeader("รายงานรวม", true, '<span id="reload" title="โหลดใหม่" style="cursor:pointer">🔄</span>');
  const chans = (STORE.channelList || []).length ? STORE.channelList : STORE.channels || [];
  const rows = chans
    .map((ch) => {
      const camps = campaignsOf(ch.id).filter((c) => isOn(c));
      const sales = camps.reduce((a, c) => a + (c.gmv || 0), 0);
      const cost = camps.reduce((a, c) => a + (c.cost || 0), 0);
      const orders = camps.reduce((a, c) => a + (c.orders || 0), 0);
      return {
        name: ch.name,
        icon: ch.icon,
        running: camps.length,
        sales,
        cost,
        orders,
        roi: cost > 0 ? sales / cost : 0,
      };
    })
    .filter((r) => r.running > 0 || r.sales > 0);
  rows.sort((a, b) => b.sales - a.sales);

  const tSales = rows.reduce((a, r) => a + r.sales, 0);
  const tCost = rows.reduce((a, r) => a + r.cost, 0);
  const tOrders = rows.reduce((a, r) => a + r.orders, 0);
  const tRoi = tCost > 0 ? tSales / tCost : 0;

  const app = $("app");
  app.innerHTML = `
    <div class="muted" style="margin-bottom:8px">รวมเฉพาะแคมเปญที่เปิดอยู่ · ${STORE.syncTs ? "ซิงค์ " + new Date(STORE.syncTs).toLocaleTimeString("th-TH") : "ยังไม่ซิงค์"}</div>
    <div class="card">
      <div class="metrics">
        <div class="metric"><div class="v">${fmt(tSales, 0)}</div><div class="l">ยอดขายรวม (฿)</div></div>
        <div class="metric"><div class="v">${fmt(tCost, 0)}</div><div class="l">ค่าโฆษณา (฿)</div></div>
        <div class="metric"><div class="v" style="color:var(--teal)">${fmt(tRoi, 2)}</div><div class="l">ROI รวม</div></div>
      </div>
      <div style="margin-top:10px">
        <div class="kv"><span class="k">Orders รวม</span><span class="val">${fmt(tOrders, 0)}</span></div>
        <div class="kv"><span class="k">ช่องที่กำลังรัน</span><span class="val">${rows.filter((r) => r.running > 0).length} / ${chans.length}</span></div>
        <div class="kv"><span class="k">กำไรคร่าวๆ (ยอด − ค่าแอด)</span><span class="val" style="color:${tSales - tCost >= 0 ? "var(--green)" : "var(--red)"}">${fmt(tSales - tCost, 0)} ฿</span></div>
      </div>
    </div>

    <div class="sec">แยกตามช่อง (${rows.length})</div>
    ${
      rows.length
        ? rows
            .map(
              (r) => `<div class="card" style="padding:10px 12px">
        <div class="row">
          <div style="display:flex;align-items:center;gap:8px;min-width:0">
            <div class="av" style="width:28px;height:28px">${r.icon ? `<img src="${esc(r.icon)}">` : esc((r.name || "?")[0])}</div>
            <div class="nm" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name)}</div>
          </div>
          <span class="pill" style="background:#eaf7f5;color:#0e8a7c">ROI ${fmt(r.roi, 2)}</span>
        </div>
        <div class="row" style="margin-top:8px">
          <span class="muted">🟢 รัน ${r.running}</span>
          <span class="muted">ยอด ${fmt(r.sales, 0)}฿</span>
          <span class="muted">แอด ${fmt(r.cost, 0)}฿</span>
          <span class="muted">${fmt(r.orders, 0)} ออร์เดอร์</span>
        </div>
      </div>`
            )
            .join("")
        : '<div class="muted" style="padding:6px 2px">ยังไม่มีแคมเปญที่รันอยู่ — เปิดหน้า GMV Max ให้โหลดข้อมูลก่อน</div>'
    }`;

  $("reload").addEventListener("click", reloadTikTok);
}

function renderDetail() {
  const ch = (STORE.channels || []).find((c) => c.id === editingId);
  if (!ch) return go("main");
  const s = ch.settings || defaultSettings();
  const camps = campaignsOf(ch.id);
  // Metrics cover only campaigns that are open (currently delivering).
  const active = camps.filter((c) => isOn(c));
  const sales = active.reduce((a, c) => a + (c.gmv || 0), 0);
  const cost = active.reduce((a, c) => a + (c.cost || 0), 0);
  const orders = active.reduce((a, c) => a + (c.orders || 0), 0);
  const roi = cost > 0 ? sales / cost : 0;
  const cpo = orders > 0 ? cost / orders : 0;
  const liveViewers = active.reduce((a, c) => a + (c.liveViewers || 0), 0);
  const budget = active.reduce((a, c) => a + (c.budget || 0), 0);
  const usedPct = budget > 0 ? Math.min(100, (cost / budget) * 100) : 0;
  const triggerAt = s.scaling?.whenUsedPercent || 50;

  setHeader(
    ch.name,
    true,
    `<span id="dSet" title="ตั้งค่า" style="cursor:pointer">⚙️</span>`
  );

  const T = s.triggers || {};
  const app = $("app");
  app.innerHTML = `
    <div class="card">
      <div class="row"><span class="muted">🟢 เปิดอยู่ ${active.length} · ⚪ ปิด ${camps.length - active.length} · ทั้งหมด ${camps.length}</span>
        <span class="muted">${STORE.syncTs ? "ซิงค์ " + new Date(STORE.syncTs).toLocaleTimeString("th-TH") : ""}</span></div>
      <div class="muted" style="margin-top:2px">ตัวเลขด้านล่างคิดเฉพาะแคมเปญที่เปิด (กำลังยิงจริง) เท่านั้น</div>
      <div class="metrics" style="margin-top:10px">
        <div class="metric"><div class="v">${fmt(sales, 0)}</div><div class="l">ยอดขาย (฿)</div></div>
        <div class="metric"><div class="v">${fmt(cpo, 2)}</div><div class="l">ทุน/ซื้อ (฿)</div></div>
        <div class="metric"><div class="v" style="color:var(--teal)">${fmt(roi, 2)}</div><div class="l">ROI</div></div>
      </div>
      <div style="margin-top:10px">
        <div class="kv"><span class="k">งบใช้ / เพดาน</span><span class="val">${fmt(cost, 0)} / ${fmt(budget, 0)} ฿</span></div>
        <div class="kv"><span class="k">Orders</span><span class="val">${fmt(orders, 0)}</span></div>
        <div class="kv"><span class="k">ผู้ชม live</span><span class="val">${fmt(liveViewers, 0)} คน</span></div>
      </div>
    </div>

    <div class="sec">เงื่อนไขที่ตั้งไว้</div>
    <div class="card">
      <div>
        <span class="chip">🕐 เช็คทุก ${s.checkIntervalMin} นาที</span>
        ${s.scaling?.enabled ? `<span class="chip">↗ เพิ่มงบ +${fmt(s.scaling.amount, 0)}${s.scaling.scaleType === "percent" ? "%" : "฿"} เมื่อใช้ ${triggerAt}%</span>` : ""}
        ${s.onlyWhenLive ? `<span class="chip">🔴 เฉพาะตอนไลฟ์</span>` : ""}
      </div>
      <div class="cond">
        <div class="cbox ${T.roi?.on ? "" : "off"}"><div class="ct">เช็คถ้า ROI ต่ำกว่า</div><div class="cv">${fmt(T.roi?.value, 0)}</div></div>
        <div class="cbox ${T.cost?.on ? "" : "off"}"><div class="ct">ทุน/ซื้อ สูงกว่า</div><div class="cv">${fmt(T.cost?.value, 0)}฿</div></div>
        <div class="cbox ${T.spentNoOrder?.on ? "" : "off"}"><div class="ct">ใช้งบ ไม่มียอด</div><div class="cv">${fmt(T.spentNoOrder?.value, 0)}฿</div></div>
      </div>
      <div style="margin-top:10px">
        ${s.actions?.pause ? `<span class="chip act">✓ ปิดแคมเปญ</span>` : ""}
        ${s.actions?.createNew ? `<span class="chip act">✓ สร้างใหม่</span>` : ""}
        ${s.actions?.telegram ? `<span class="chip act">✓ Telegram</span>` : ""}
      </div>
    </div>

    ${
      s.scaling?.enabled
        ? `<div class="sec">สเกลงบอัตโนมัติ</div>
    <div class="card">
      <div class="muted">ใช้งบครบ ${triggerAt}% → เพิ่มงบอีก +${fmt(s.scaling.amount, 0)}${s.scaling.scaleType === "percent" ? "%" : "฿"}</div>
      <div class="row" style="margin-top:8px"><span class="k muted">การใช้งบปัจจุบัน</span><span class="val">${fmt(cost, 0)} / ${fmt(budget, 0)} ฿ (${fmt(usedPct, 0)}%)</span></div>
      <div class="bar"><span style="width:${usedPct}%"></span><i style="left:${triggerAt}%"></i></div>
      <div class="row"><span class="muted">0 ฿</span><span class="muted">trigger ${triggerAt}% (${fmt(budget * triggerAt / 100, 0)} ฿)</span><span class="muted">${fmt(budget, 0)} ฿</span></div>
    </div>`
        : ""
    }

    <button class="primary" id="dSet2">⚙️ ตั้งค่าการเช็ค และสเกลงบ</button>

    <div class="sec">10 แคมเปญล่าสุด</div>
    <div class="card clist">
      ${
        camps.length
          ? camps
              .slice(0, 10)
              .map(
                (c) => `<div class="crow">
        <span class="dot" style="background:${stateColor(c)}"></span>
        <span class="cn">${esc(c.name)}</span>
        <span class="pill" style="background:#eaf7f5;color:#0e8a7c">ROI ${fmt(c.roi, 2)}</span>
        <span class="muted" style="min-width:52px;text-align:right">${fmt(c.gmv, 0)}฿</span>
      </div>`
              )
              .join("")
          : `<div class="muted">ยังไม่มีข้อมูลแคมเปญ — กด Sync ในหน้าหลัก</div>`
      }
    </div>

    <button class="ghost" id="dDel" style="width:100%;margin-top:4px;color:var(--red)">🗑 ลบช่องนี้</button>`;

  $("dSet").addEventListener("click", () => go("settings", ch.id));
  $("dSet2").addEventListener("click", () => go("settings", ch.id));
  $("dDel").addEventListener("click", () => {
    if (!confirm(`ลบช่อง "${ch.name}"?`)) return;
    save({ channels: (STORE.channels || []).filter((c) => c.id !== ch.id) }, () =>
      go("main")
    );
  });
}

function renderSettings() {
  const ch = (STORE.channels || []).find((c) => c.id === editingId);
  if (!ch) return go("main");
  const s = ch.settings;
  setHeader(`ตั้งค่า · ${ch.name}`, true);
  const app = $("app");
  app.innerHTML = `
    <div class="note">💻 ระบบทำงานบนเครื่องนี้ — เฝ้าแคมเปญตลอดเวลาที่เปิดคอมและ Chrome ไว้ (ปิดเครื่อง/Sleep = พัก)</div>

    <div class="sec">เงื่อนไข TRIGGER (OR)</div>
    <div class="card">
      <div class="row"><label>เช็คทุกๆ</label>
        <select id="iv">${[1, 3, 5, 10, 15, 30, 60].map((m) => `<option value="${m}" ${s.checkIntervalMin === m ? "selected" : ""}>${m} นาที</option>`).join("")}</select>
      </div>
      <div class="row" style="margin-top:8px"><label>งบขั้นต่ำก่อนเช็ค (฿)</label><input type="number" id="minb" value="${s.minBudgetBeforeCheck}"></div>
      <div class="muted">เริ่มเช็คเงื่อนไขหลังใช้งบเกินนี้</div>
    </div>
    ${triggerCard("roi", "เช็คถ้า ROI ต่ำกว่า", "ROI ขั้นต่ำที่ยอมรับได้", s.triggers.roi)}
    ${triggerCard("cost", "เช็คถ้า ต้นทุน/ซื้อ สูงกว่า", "ต้นทุน/ซื้อ สูงสุดที่ยอมรับได้ (฿)", s.triggers.cost)}
    ${triggerCard("spentNoOrder", "เช็คถ้า ใช้งบแล้วไม่มียอด", "งบที่ใช้ไปแล้วสูงสุด (฿)", s.triggers.spentNoOrder)}

    <div class="card" style="margin-top:10px">
      <label class="row" style="cursor:pointer"><span>ทำงานเฉพาะตอนไลฟ์อยู่ <span class="muted">(Only when LIVE)</span></span><input type="checkbox" id="onlyLive" ${s.onlyWhenLive ? "checked" : ""}></label>
    </div>

    <div class="sec">ACTION เมื่อ TRIGGER</div>
    <div class="card">
      <label class="row" style="cursor:pointer"><span>ปิดแคมเปญ</span><input type="checkbox" id="aPause" ${s.actions.pause ? "checked" : ""}></label>
      <label class="row" style="cursor:pointer;margin-top:8px"><span>ลดงบต่ำสุดหลังปิด <span class="muted">(กันงบไหลต่อ)</span></span><input type="checkbox" id="aReduce" ${s.actions.reduceBudgetBeforePause !== false ? "checked" : ""}></label>
      <label class="row" style="cursor:pointer;margin-top:8px"><span>แจ้งเตือน Telegram</span><input type="checkbox" id="aTg" ${s.actions.telegram ? "checked" : ""}></label>
      <button class="ghost" id="testReduce" style="width:100%;margin-top:10px">🧪 ทดสอบลดงบต่ำสุด (แคมที่ยิงอยู่)</button>
      <div class="msg" id="reduceMsg"></div>
    </div>

    <div class="sec">สร้างแคมเปญใหม่อัตโนมัติ</div>
    <div class="card">
      <div class="row"><span><b>เปิดใช้งาน</b></span>
        <label class="switch"><input type="checkbox" id="aCreate" ${s.actions.createNew ? "checked" : ""}><span class="slider"></span></label></div>
      <div class="row" style="margin-top:8px"><label>ROI เป้าหมาย</label><input type="number" step="0.1" id="cRoi" value="${s.actions.createRoi}"></div>
      <div class="row" style="margin-top:6px"><label>งบเริ่มต้น (฿)</label><input type="number" id="cBudget" value="${s.actions.createBudget}"></div>
      <div class="muted" style="margin-top:6px">เมื่อปิดแคมเปญเดิม จะสร้างตัวใหม่ด้วยค่านี้ (ROI + งบ)</div>
      <div class="muted" style="margin-top:6px">โคลนจากแคมเปญเดิมของช่องนี้อัตโนมัติ (ไม่ต้องสร้างมือก่อน)</div>
      <button class="ghost" id="testCreate" style="width:100%;margin-top:8px">🧪 ทดสอบสร้าง 1 ตัวเลย (ใช้ค่าด้านบน)</button>
      <div class="msg" id="createMsg"></div>
    </div>

    <div class="sec">รีเซตงบเที่ยงคืน</div>
    <div class="card">
      <div class="row"><span><b>เปิดใช้งาน</b> <span class="muted">(00:00 น.)</span></span>
        <label class="switch"><input type="checkbox" id="mrEn" ${s.midnightReset?.enabled ? "checked" : ""}><span class="slider"></span></label></div>
      <div class="row" style="margin-top:8px"><label>รีเซตงบกลับเป็น (฿)</label><input type="number" id="mrBudget" value="${s.midnightReset?.budget ?? 300}"></div>
      <div class="muted" style="margin-top:6px">ทุกเที่ยงคืน (เวลาไทย) ตั้งงบของแคมที่รันอยู่กลับเป็นค่านี้ — ใช้คู่กับสเกลงบ (กลางวันงบโต กลางคืนรีเซต)</div>
    </div>

    <div class="sec">ปรับ ROI เป้าอัตโนมัติ</div>
    <div class="card">
      <div class="row"><span><b>เปิดใช้งาน</b></span>
        <label class="switch"><input type="checkbox" id="raEn" ${s.roiAuto?.enabled ? "checked" : ""}><span class="slider"></span></label></div>
      <div class="row" style="margin-top:8px"><label>ปรับทีละ (ROI)</label><input type="number" step="0.1" id="raStep" value="${s.roiAuto?.step ?? 0.1}"></div>
      <div class="row" style="margin-top:6px"><label>ปรับเมื่อ ROI ห่างเป้าเกิน</label><input type="number" step="0.1" id="raMargin" value="${s.roiAuto?.margin ?? 1}"></div>
      <div class="row" style="margin-top:6px"><label>ROI เป้าต่ำสุด</label><input type="number" step="0.1" id="raMin" value="${s.roiAuto?.min ?? 1}"></div>
      <div class="row" style="margin-top:6px"><label>ROI เป้าสูงสุด</label><input type="number" step="0.1" id="raMax" value="${s.roiAuto?.max ?? 5}"></div>
      <div class="muted" style="margin-top:6px">ROI จริงดีกว่าเป้ามาก → ดันเป้าขึ้น (รีดกำไร) · แย่กว่าเป้า → ลดเป้าลง (ให้ยิงได้)</div>
    </div>

    <div class="sec">Budget Scaling (สเกลงบอัตโนมัติ)</div>
    <div class="card">
      <div class="row"><span><b>เปิดใช้งาน</b></span>
        <label class="switch"><input type="checkbox" id="scEn" ${s.scaling.enabled ? "checked" : ""}><span class="slider"></span></label></div>
      <div class="muted" style="margin-top:4px">ตัวอย่าง: ใช้งบครบ ${s.scaling.whenUsedPercent}% → เพิ่มอีก ${s.scaling.amount}${s.scaling.scaleType === "percent" ? "%" : "฿"}</div>
      <div class="tabs" id="scMode" style="margin-top:8px">
        ${["time:ตามเวลา", "percent:ตาม %", "order:ตามออเดอร์"].map((x) => { const [k, l] = x.split(":"); return `<button data-m="${k}" class="${s.scaling.mode === k ? "on" : ""}">${l}</button>`; }).join("")}
      </div>
      <div class="row" style="margin-top:8px"><label>เมื่อใช้งบครบ (%)</label><input type="number" id="scWhen" value="${s.scaling.whenUsedPercent}"></div>
      <div class="row" style="margin-top:6px"><label>วิธีเพิ่มงบ</label>
        <div class="tabs" id="scType">
          ${["fixed:คงที่ (฿)", "percent:เปอร์เซ็นต์ (%)"].map((x) => { const [k, l] = x.split(":"); return `<button data-t="${k}" class="${s.scaling.scaleType === k ? "on" : ""}">${l}</button>`; }).join("")}
        </div>
      </div>
      <div class="row" style="margin-top:6px"><label>จำนวนที่เพิ่ม</label><input type="number" id="scAmt" value="${s.scaling.amount}"></div>
      <div class="row" style="margin-top:6px"><label>สเกลทุกๆ</label><select id="scIv">${[5, 10, 15, 30, 60].map((m) => `<option value="${m}" ${s.scaling.intervalMin === m ? "selected" : ""}>${m} นาที</option>`).join("")}</select></div>
      <div class="row" style="margin-top:6px"><label>เพดานงบสูงสุด/แคมเปญ (฿)</label><input type="number" id="scCap" value="${s.scaling.cap}"></div>
    </div>

    <button class="primary" id="saveBtn">บันทึกการตั้งค่า</button>
    <button class="ghost" id="delBtn" style="width:100%;margin-top:8px;color:var(--red)">ลบช่องนี้</button>
    <div class="msg" id="msg"></div>`;

  let mode = s.scaling.mode;
  app.querySelectorAll("#scMode button").forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.getAttribute("data-m");
      app.querySelectorAll("#scMode button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    })
  );
  let scaleType = s.scaling.scaleType || "fixed";
  app.querySelectorAll("#scType button").forEach((b) =>
    b.addEventListener("click", () => {
      scaleType = b.getAttribute("data-t");
      app.querySelectorAll("#scType button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    })
  );

  $("saveBtn").addEventListener("click", () => {
    ch.settings = {
      checkIntervalMin: Number($("iv").value),
      minBudgetBeforeCheck: Number($("minb").value),
      onlyWhenLive: $("onlyLive").checked,
      midnightReset: {
        enabled: $("mrEn").checked,
        budget: Number($("mrBudget").value),
      },
      roiAuto: {
        enabled: $("raEn").checked,
        step: Number($("raStep").value),
        margin: Number($("raMargin").value),
        min: Number($("raMin").value),
        max: Number($("raMax").value),
        intervalMin: s.roiAuto?.intervalMin || 30,
      },
      triggers: {
        roi: readTrigger("roi"),
        cost: readTrigger("cost"),
        spentNoOrder: readTrigger("spentNoOrder"),
      },
      actions: {
        pause: $("aPause").checked,
        reduceBudgetBeforePause: $("aReduce").checked,
        createNew: $("aCreate").checked,
        createRoi: Number($("cRoi").value),
        createBudget: Number($("cBudget").value),
        telegram: $("aTg").checked,
      },
      scaling: {
        enabled: $("scEn").checked,
        mode,
        scaleType,
        whenUsedPercent: Number($("scWhen").value),
        amount: Number($("scAmt").value),
        intervalMin: Number($("scIv").value),
        cap: Number($("scCap").value),
      },
    };
    const channels = (STORE.channels || []).map((c) => (c.id === ch.id ? ch : c));
    save({ channels }, () => {
      chrome.runtime.sendMessage({ type: "CGMX_RESCHEDULE" });
      $("msg").textContent = "บันทึกแล้ว ✓ ระบบจะเฝ้าให้ตามนี้";
      setTimeout(() => go("detail", ch.id), 700);
    });
  });
  $("delBtn").addEventListener("click", () => {
    if (!confirm(`ลบช่อง "${ch.name}"?`)) return;
    save({ channels: (STORE.channels || []).filter((c) => c.id !== ch.id) }, () =>
      go("main")
    );
  });
  $("testCreate").addEventListener("click", () => {
    const roi = Number($("cRoi").value);
    const budget = Number($("cBudget").value);
    if (!confirm(`สร้างแคมเปญ GMV Max Live ใหม่จริงบนช่อง "${ch.name}"?\nROI ${roi} · งบ ${budget}฿`)) return;
    $("createMsg").textContent = "กำลังสร้าง…";
    chrome.runtime.sendMessage({ type: "CGMX_DO_CREATE", channelId: ch.id, roi, budget }, (r) => {
      if (chrome.runtime.lastError) { $("createMsg").textContent = "ผิดพลาด: " + chrome.runtime.lastError.message; return; }
      $("createMsg").textContent =
        r && r.ok
          ? "✅ สร้างสำเร็จ! เช็คในหน้า GMV Max ได้เลย"
          : `❌ ไม่สำเร็จ: ${(r && (r.error || r.msg)) || "?"}`;
    });
  });
  $("testReduce").addEventListener("click", () => {
    // Prefer a delivering campaign; else the highest-spend one on this channel.
    const camps = campaignsOf(ch.id);
    const target =
      camps.find((c) => isOn(c)) ||
      camps.slice().sort((a, b) => (b.cost || 0) - (a.cost || 0))[0];
    if (!target) {
      $("reduceMsg").textContent = "ไม่พบแคมเปญของช่องนี้ — กด Sync ก่อน";
      return;
    }
    if (!confirm(`ทดสอบ: ปิด → ลดงบต่ำสุด → เปิดกลับ\nแคม "${target.name}" (งบ ${fmt(target.budget, 0)}฿)\n\n⚠️ TikTok ให้ลดงบได้เฉพาะตอนแคมถูกปิด ระบบจะปิดชั่วครู่แล้วเปิดกลับ (งบจะเหลือต่ำสุด)`)) return;
    $("reduceMsg").textContent = "กำลังปิด → ลดงบ → เปิดกลับ…";
    chrome.runtime.sendMessage(
      { type: "CGMX_DO_TESTREDUCE", campaignId: target.id, campaignName: target.name, reenable: true },
      (r) => {
        if (chrome.runtime.lastError) { $("reduceMsg").textContent = "ผิดพลาด: " + chrome.runtime.lastError.message; return; }
        $("reduceMsg").textContent =
          r && r.ok
            ? `✅ ลดงบเหลือ ${r.budget}฿ แล้ว (ปิด:${r.paused ? "✓" : "✗"} เปิดกลับ:${r.reenabled ? "✓" : "✗"})`
            : `❌ ลดงบไม่สำเร็จ: ${(r && (r.error || r.msg)) || "?"} (ปิด:${r && r.paused ? "✓" : "✗"})`;
      }
    );
  });
}

function triggerCard(key, title, sub, t) {
  return `<div class="trigger">
    <div class="row"><b>${title}</b>
      <label class="switch"><input type="checkbox" id="t_${key}_on" ${t.on ? "checked" : ""}><span class="slider"></span></label>
    </div>
    <div class="row" style="margin-top:6px"><label>${sub}</label><input type="number" id="t_${key}_v" value="${t.value}"></div>
  </div>`;
}
function readTrigger(key) {
  return { on: $(`t_${key}_on`).checked, value: Number($(`t_${key}_v`).value) };
}

function reloadTikTok() {
  chrome.tabs.query({ url: "https://ads.tiktok.com/*" }, (tabs) => {
    if (tabs.length) chrome.tabs.reload(tabs[0].id);
  });
}

$("back").addEventListener("click", () => {
  if (view === "settings" && editingId) go("detail", editingId);
  else go("main");
});

chrome.storage.onChanged.addListener(() => loadStore(render));
loadStore(render);

// Auto-sync silently (if a TikTok tab is present) so the user rarely has to
// press Sync manually — once on open, then repeatedly while the panel is open.
function autoSync() {
  chrome.tabs.query({ url: "https://ads.tiktok.com/*" }, (tabs) => {
    if (!tabs.length) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: "CGMX_SYNC" }, () => {
      void chrome.runtime.lastError; // ignore; user can press Sync manually
      loadStore(render);
    });
  });
}
autoSync();
setInterval(autoSync, 45 * 1000);
