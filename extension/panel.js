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
    actions: { pause: true, createNew: false, telegram: false },
    scaling: {
      enabled: false,
      mode: "time",
      type: "add",
      intervalMin: 15,
      amount: 50,
      cap: 10000,
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
      pauseRecipe: null,
      lastRun: 0,
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
function campaignsOf(channelId) {
  return (STORE.campaigns || []).filter(
    (c) => (c.channelId || "__current__") === channelId
  );
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
  else if (view === "settings") renderSettings();
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
    <div class="sec">อื่นๆ</div>
    <div class="card">
      <div class="row"><label>แจ้งเตือน Telegram Token</label></div>
      <input class="search" id="tgToken" placeholder="123456:ABC…" value="${esc(STORE.telegramToken)}" style="width:100%;margin:6px 0">
      <input class="search" id="tgChat" placeholder="Chat ID" value="${esc(STORE.telegramChatId)}" style="width:100%">
      <div class="row" style="margin-top:8px"><button class="ghost" id="tgSave">บันทึก</button><button class="ghost" id="tgTest">ทดสอบส่ง</button></div>
      <div class="msg" id="msg"></div>
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
  $("reload").addEventListener("click", reloadTikTok);
  app.querySelectorAll("[data-edit]").forEach((el) =>
    el.addEventListener("click", () => go("settings", el.getAttribute("data-edit")))
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
  $("dlDbg").addEventListener("click", downloadDebug);
}

function downloadDebug() {
  chrome.storage.local.get(null, (all) => {
    const data = {
      campaigns: all.campaigns || [],
      captures: all.captures || [],
      channelsRaw: all.channelsRaw || null,
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
    <div class="note">💡 เห็นเฉพาะช่องที่โหลดข้อมูลแล้ว — เปิดหน้า GMV Max และ
      <b>สลับร้าน/ช่องใน TikTok</b> ให้ครบ เพื่อให้ระบบเห็นทุกช่อง</div>
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
    settings: defaultSettings(),
  };
  const channels = [...(STORE.channels || []), ch];
  save({ channels }, () => go("settings", id));
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

    <div class="sec">ACTION เมื่อ TRIGGER</div>
    <div class="card">
      <label class="row" style="cursor:pointer"><span>ปิดแคมเปญ</span><input type="checkbox" id="aPause" ${s.actions.pause ? "checked" : ""}></label>
      <label class="row" style="cursor:pointer;margin-top:8px"><span>สร้างแคมเปญใหม่ <span class="pill" style="background:#eee;color:#999">เร็วๆนี้</span></span><input type="checkbox" id="aCreate" ${s.actions.createNew ? "checked" : ""} disabled></label>
      <label class="row" style="cursor:pointer;margin-top:8px"><span>แจ้งเตือน Telegram</span><input type="checkbox" id="aTg" ${s.actions.telegram ? "checked" : ""}></label>
    </div>

    <div class="sec">Budget Scaling</div>
    <div class="card">
      <div class="row"><span>เปิดใช้งาน <span class="pill" style="background:#eee;color:#999">ต้องเรียนรู้ endpoint งบ</span></span>
        <label class="switch"><input type="checkbox" id="scEn" ${s.scaling.enabled ? "checked" : ""}><span class="slider"></span></label></div>
      <div class="tabs" id="scMode">
        ${["time:ตามเวลา", "percent:ตาม %", "order:ตามออเดอร์"].map((x) => { const [k, l] = x.split(":"); return `<button data-m="${k}" class="${s.scaling.mode === k ? "on" : ""}">${l}</button>`; }).join("")}
      </div>
      <div class="row" style="margin-top:6px"><label>เพิ่มครั้งละ (฿)</label><input type="number" id="scAmt" value="${s.scaling.amount}"></div>
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

  $("saveBtn").addEventListener("click", () => {
    ch.settings = {
      checkIntervalMin: Number($("iv").value),
      minBudgetBeforeCheck: Number($("minb").value),
      triggers: {
        roi: readTrigger("roi"),
        cost: readTrigger("cost"),
        spentNoOrder: readTrigger("spentNoOrder"),
      },
      actions: {
        pause: $("aPause").checked,
        createNew: false,
        telegram: $("aTg").checked,
      },
      scaling: {
        enabled: $("scEn").checked,
        mode,
        type: "add",
        intervalMin: Number($("scIv").value),
        amount: Number($("scAmt").value),
        cap: Number($("scCap").value),
      },
    };
    const channels = (STORE.channels || []).map((c) => (c.id === ch.id ? ch : c));
    save({ channels }, () => {
      chrome.runtime.sendMessage({ type: "CGMX_RESCHEDULE" });
      $("msg").textContent = "บันทึกแล้ว ✓ ระบบจะเฝ้าให้ตามนี้";
      setTimeout(() => go("main"), 700);
    });
  });
  $("delBtn").addEventListener("click", () => {
    if (!confirm(`ลบช่อง "${ch.name}"?`)) return;
    save({ channels: (STORE.channels || []).filter((c) => c.id !== ch.id) }, () =>
      go("main")
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

$("back").addEventListener("click", () => go("main"));

chrome.storage.onChanged.addListener(() => loadStore(render));
loadStore(render);
