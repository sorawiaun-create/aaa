// Service worker: config storage, periodic loop (chrome.alarms), and Telegram
// notifications. Automation actions run in the content script (page session);
// this worker orchestrates them.

const DEFAULTS = {
  enabled: false,
  intervalMinutes: 10,
  telegramToken: "",
  telegramChatId: "",
  rules: [], // future: [{metric, op, value, action}]
};

// Open the side panel when the toolbar icon is clicked (stays docked).
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(DEFAULTS, (cfg) => {
    chrome.storage.local.set(cfg);
    scheduleAlarm(cfg.intervalMinutes);
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(DEFAULTS, (cfg) =>
    scheduleAlarm(cfg.intervalMinutes)
  );
});

function scheduleAlarm(minutes) {
  chrome.alarms.clear("cgmx_loop", () => {
    chrome.alarms.create("cgmx_loop", {
      periodInMinutes: Math.max(1, Number(minutes) || 10),
    });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "cgmx_loop") return;
  chrome.storage.local.get(DEFAULTS, async (cfg) => {
    if (!cfg.enabled) return;
    // TODO (next step): run rules against captured GMV Max endpoints.
    // For now the loop is a heartbeat; automation wiring comes after we
    // capture the internal list/pause/budget endpoints.
  });
});

async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return { ok: false, error: "ยังไม่ได้ตั้ง Telegram" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const json = await res.json();
    return { ok: json.ok === true, error: json.description };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "CGMX_TELEGRAM_TEST") {
    chrome.storage.local.get(DEFAULTS, async (cfg) => {
      const r = await sendTelegram(
        cfg.telegramToken,
        cfg.telegramChatId,
        "🔔 ทดสอบการแจ้งเตือนจาก GMV Max Controller — ใช้งานได้!"
      );
      sendResponse(r);
    });
    return true;
  }
  if (msg && msg.type === "CGMX_RESCHEDULE") {
    scheduleAlarm(msg.intervalMinutes);
    sendResponse({ ok: true });
    return true;
  }
});
