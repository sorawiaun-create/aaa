// Service worker: scheduling, the automation engine, and Telegram.

if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

const KEYS = {
  enabled: false,
  channels: [],
  telegramToken: "",
  telegramChatId: "",
  campaigns: [],
  pauseRecipe: null,
  lastRun: 0,
  actedIds: {}, // campaignId -> ts (avoid repeat actions within a window)
  createdTs: {}, // channelId -> ts of last auto-create (rate-limit new campaigns)
};

// Minimum spacing between auto-creates on the same channel (safety brake so a
// bad new campaign can't spawn replacements in a tight loop).
const CREATE_COOLDOWN_MS = 10 * 60 * 1000;

chrome.runtime.onInstalled.addListener(() => reschedule());
chrome.runtime.onStartup.addListener(() => reschedule());

function reschedule() {
  chrome.storage.local.get(KEYS, (s) => {
    const mins = (s.channels || [])
      .map((c) => c.settings?.checkIntervalMin || 5)
      .filter(Boolean);
    const period = Math.max(1, mins.length ? Math.min(...mins) : 5);
    chrome.alarms.clear("cgmx_loop", () =>
      chrome.alarms.create("cgmx_loop", { periodInMinutes: period })
    );
  });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "cgmx_loop") runRules();
});

function statusRunning(s) {
  const t = String(s).toUpperCase();
  return t.includes("ENABLE") || t === "1" || t.includes("DELIVER") || t.includes("ACTIVE");
}

// A campaign belongs to a channel if its identity id matches the channel id or
// the channel's identity id, or (last resort) the channel name matches.
function channelMatch(c, ch) {
  const cid = String(c.channelId || "");
  if (cid && (cid === String(ch.id) || cid === String(ch.identityId || ""))) return true;
  if (c.channelName && ch.name && c.channelName === ch.name) return true;
  return false;
}

// Evaluate a campaign against a channel's trigger settings (OR logic).
function triggered(c, st) {
  if (c.cost < (st.minBudgetBeforeCheck || 0)) return null;
  const T = st.triggers || {};
  const cpo = c.orders > 0 ? c.cost / c.orders : c.cost;
  if (T.roi?.on && c.roi > 0 && c.roi < T.roi.value)
    return `ROI ${c.roi.toFixed(2)} < ${T.roi.value}`;
  if (T.cost?.on && cpo > T.cost.value)
    return `ต้นทุน/ซื้อ ${cpo.toFixed(0)} > ${T.cost.value}`;
  if (T.spentNoOrder?.on && c.orders === 0 && c.cost > T.spentNoOrder.value)
    return `ใช้งบ ${c.cost.toFixed(0)} แต่ไม่มีออร์เดอร์`;
  return null;
}

function execOnTikTok(req) {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: "https://ads.tiktok.com/*" }, (tabs) => {
      if (!tabs.length) return resolve({ ok: false, error: "no tiktok tab" });
      chrome.tabs.sendMessage(tabs[0].id, { type: "CGMX_EXEC", req }, (r) =>
        resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r)
      );
    });
  });
}

// Ask the content script to refresh channels + campaigns from TikTok.
function tabSync() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: "https://ads.tiktok.com/*" }, (tabs) => {
      if (!tabs.length) return resolve({ ok: false, error: "no tiktok tab" });
      chrome.tabs.sendMessage(tabs[0].id, { type: "CGMX_SYNC" }, (r) =>
        resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r)
      );
    });
  });
}

// Create a new campaign by cloning a template campaign, with a new ROI + budget.
function execCreate(templateCampaignId, channelId, roi, budget) {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: "https://ads.tiktok.com/*" }, (tabs) => {
      if (!tabs.length) return resolve({ ok: false, error: "no tiktok tab" });
      chrome.tabs.sendMessage(
        tabs[0].id,
        { type: "CGMX_CREATE", templateCampaignId, channelId, roi, budget },
        (r) => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r)
      );
    });
  });
}

// Pause (operation 2) / enable (operation 1) a campaign natively via the
// content script, which calls TikTok's update_status endpoint with the CSRF
// token — no captured recipe required.
function execStatus(campaignId, operation) {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: "https://ads.tiktok.com/*" }, (tabs) => {
      if (!tabs.length) return resolve({ ok: false, error: "no tiktok tab" });
      chrome.tabs.sendMessage(
        tabs[0].id,
        { type: "CGMX_STATUS", campaignId, operation },
        (r) => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r)
      );
    });
  });
}

async function runRules() {
  let s = await chrome.storage.local.get(KEYS);
  if (!s.enabled) return;
  // Auto-refresh data from TikTok first so decisions use live numbers.
  await tabSync();
  s = await chrome.storage.local.get(KEYS);
  const acted = s.actedIds || {};
  const createdTs = s.createdTs || {};
  const now = Date.now();
  const actions = [];

  for (const ch of s.channels || []) {
    const st = ch.settings || {};
    if (!st.actions?.pause) continue;
    const camps = (s.campaigns || []).filter((c) => channelMatch(c, ch));
    for (const c of camps) {
      if (!statusRunning(c.status)) continue;
      if (acted[c.id] && now - acted[c.id] < 30 * 60 * 1000) continue; // cooldown 30m
      const reason = triggered(c, st);
      if (!reason) continue;
      const res = await execStatus(c.id, 2); // 2 = pause
      acted[c.id] = now;
      actions.push({ ok: res && res.ok, name: c.name, reason });

      // Optionally create a fresh campaign to replace the paused one, cloning
      // the campaign we just paused as the template. This keeps the loop going
      // (pause → create → monitor → repeat) while a rate limit prevents runaway
      // spawning if a brand-new campaign immediately underperforms.
      if (res && res.ok && st.actions?.createNew) {
        if (createdTs[ch.id] && now - createdTs[ch.id] < CREATE_COOLDOWN_MS) {
          actions.push({ ok: true, name: "↳ ข้ามการสร้างใหม่", reason: "เพิ่งสร้างไปเมื่อครู่ (กันสร้างรัว)" });
        } else {
          const cr = await execCreate(c.id, ch.id, st.actions.createRoi, st.actions.createBudget);
          if (cr && cr.ok) createdTs[ch.id] = now;
          actions.push({
            ok: cr && cr.ok,
            name: `↳ สร้างใหม่ (ROI ${st.actions.createRoi}, งบ ${st.actions.createBudget}฿)`,
            reason: cr && cr.ok ? "สำเร็จ" : `ไม่สำเร็จ: ${(cr && (cr.error || cr.msg)) || "?"}`,
          });
        }
      }
    }
  }

  await chrome.storage.local.set({ actedIds: acted, createdTs, lastRun: now });

  if (actions.length) {
    const okActs = actions.filter((a) => a.ok);
    const text =
      `🤖 GMV Max Monitor ปิดแคมเปญ ${okActs.length}/${actions.length} ตัว\n` +
      actions.map((a) => `${a.ok ? "✅" : "⚠️"} ${a.name} — ${a.reason}`).join("\n");
    if (s.telegramToken && s.telegramChatId)
      sendTelegram(s.telegramToken, s.telegramChatId, text);
  }
}

async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return { ok: false, error: "ยังไม่ได้ตั้ง Telegram" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const j = await res.json();
    return { ok: j.ok === true, error: j.description };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type === "CGMX_TELEGRAM_TEST") {
    chrome.storage.local.get(KEYS, async (s) => {
      sendResponse(
        await sendTelegram(
          s.telegramToken,
          s.telegramChatId,
          "🔔 ทดสอบแจ้งเตือน GMV Max Monitor — ใช้งานได้!"
        )
      );
    });
    return true;
  }
  if (msg?.type === "CGMX_RESCHEDULE") {
    reschedule();
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === "CGMX_RUN_NOW") {
    runRules().then(() => sendResponse({ ok: true }));
    return true;
  }
});
