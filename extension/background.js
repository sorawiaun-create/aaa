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
};

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

function buildPauseBody(recipe, id) {
  try {
    const o = JSON.parse(recipe.reqBody);
    o.campaign_list = [String(id)];
    o.operation = 2;
    return JSON.stringify(o);
  } catch {
    return JSON.stringify({ campaign_list: [String(id)], operation: 2 });
  }
}
function sanitize(h) {
  const out = {};
  const drop = ["cookie", "content-length", "host", "user-agent", "accept-encoding", "connection"];
  for (const k of Object.keys(h || {})) if (!drop.includes(k.toLowerCase())) out[k] = h[k];
  if (!Object.keys(out).some((k) => k.toLowerCase() === "content-type"))
    out["Content-Type"] = "application/json";
  return out;
}

async function runRules() {
  const s = await chrome.storage.local.get(KEYS);
  if (!s.enabled) return;
  const acted = s.actedIds || {};
  const now = Date.now();
  const actions = [];

  for (const ch of s.channels || []) {
    const st = ch.settings || {};
    if (!st.actions?.pause) continue;
    const camps = (s.campaigns || []).filter(
      (c) => (c.channelId || "__current__") === ch.id
    );
    for (const c of camps) {
      if (!statusRunning(c.status)) continue;
      if (acted[c.id] && now - acted[c.id] < 30 * 60 * 1000) continue; // cooldown 30m
      const reason = triggered(c, st);
      if (!reason) continue;
      if (!s.pauseRecipe) continue;
      const res = await execOnTikTok({
        method: "POST",
        url: s.pauseRecipe.url,
        headers: sanitize(s.pauseRecipe.headers),
        body: buildPauseBody(s.pauseRecipe, c.id),
      });
      acted[c.id] = now;
      actions.push({ ok: res && res.ok, name: c.name, reason });
    }
  }

  await chrome.storage.local.set({ actedIds: acted, lastRun: now });

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
