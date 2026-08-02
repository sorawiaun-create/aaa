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
  scaledTs: {}, // campaignId -> ts of last budget scale-up
  roiTs: {}, // campaignId -> ts of last ROI-target adjust
  logs: [],
};

// Minimum spacing between auto-creates on the same channel (safety brake so a
// bad new campaign can't spawn replacements in a tight loop).
const CREATE_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_LOGS = 300;

// Append entries to the persistent activity log (newest first).
async function addLogs(entries) {
  if (!entries || !entries.length) return;
  const { logs = [] } = await chrome.storage.local.get({ logs: [] });
  const stamped = entries.map((e) => ({ ts: Date.now(), ...e }));
  await chrome.storage.local.set({ logs: [...stamped, ...logs].slice(0, MAX_LOGS) });
}

chrome.runtime.onInstalled.addListener(() => { reschedule(); scheduleMidnight(); scheduleDailySummary(); });
chrome.runtime.onStartup.addListener(() => { reschedule(); scheduleMidnight(); scheduleDailySummary(); });

// Schedule the next 00:00 Bangkok (UTC+7) reset.
function scheduleMidnight() {
  const now = Date.now();
  const bkk = new Date(now + 7 * 3600 * 1000); // Bangkok wall-clock via UTC fields
  const nextUtc =
    Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate() + 1, 0, 0, 0) -
    7 * 3600 * 1000;
  chrome.alarms.create("cgmx_midnight", { when: nextUtc });
}

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
  if (a.name === "cgmx_midnight") midnightReset().finally(scheduleMidnight);
  if (a.name === "cgmx_dailysummary") sendDailySummary().finally(scheduleDailySummary);
});

// Reset each running campaign's budget back to the configured base at midnight.
async function midnightReset() {
  await tabSync();
  const s = await chrome.storage.local.get(KEYS);
  const scaledTs = s.scaledTs || {};
  const done = [];
  for (const ch of s.channels || []) {
    const mr = ch.settings?.midnightReset;
    if (!mr?.enabled || !mr.budget) continue;
    const camps = (s.campaigns || []).filter((c) => channelMatch(c, ch) && statusRunning(c.status));
    for (const c of camps) {
      if (Math.round(c.budget || 0) === Math.round(mr.budget)) continue;
      const r = await execBudget(c.id, c.name, mr.budget);
      if (r && r.ok) delete scaledTs[c.id]; // let scaling start fresh today
      done.push({ ok: r && r.ok, name: c.name, to: mr.budget });
    }
  }
  await chrome.storage.local.set({ scaledTs });
  if (done.length) {
    await addLogs(done.map((d) => ({ ok: d.ok, text: `🌙 รีเซตงบเที่ยงคืน ${d.name} → ${d.to}฿` })));
    if (s.telegramToken && s.telegramChatId) {
      const okN = done.filter((d) => d.ok).length;
      const text =
        `🌙 รีเซตงบเที่ยงคืน ${okN}/${done.length} แคมเปญ\n` +
        done.map((d) => `${d.ok ? "✅" : "⚠️"} ${d.name} → ${d.to}฿`).join("\n");
      sendTelegram(s.telegramToken, s.telegramChatId, text);
    }
  }
}

// Build a totals summary across all running campaigns and send it to Telegram.
async function sendDailySummary() {
  await tabSync();
  const s = await chrome.storage.local.get(KEYS);
  if (!s.telegramToken || !s.telegramChatId) return;
  const running = (s.campaigns || []).filter((c) => statusRunning(c.status));
  const sales = running.reduce((a, c) => a + (c.gmv || 0), 0);
  const cost = running.reduce((a, c) => a + (c.cost || 0), 0);
  const orders = running.reduce((a, c) => a + (c.orders || 0), 0);
  const roi = cost > 0 ? sales / cost : 0;
  const text =
    `📊 สรุปยอดวันนี้ (${new Date().toLocaleDateString("th-TH")})\n` +
    `ยอดขาย: ${Math.round(sales).toLocaleString()} ฿\n` +
    `ค่าโฆษณา: ${Math.round(cost).toLocaleString()} ฿\n` +
    `ROI รวม: ${roi.toFixed(2)}\n` +
    `ออร์เดอร์: ${orders}\n` +
    `กำไรคร่าวๆ: ${Math.round(sales - cost).toLocaleString()} ฿\n` +
    `แคมเปญที่รัน: ${running.length}`;
  await sendTelegram(s.telegramToken, s.telegramChatId, text);
}

// Schedule the next daily-summary send at the configured Bangkok hour.
function scheduleDailySummary() {
  chrome.storage.local.get({ dailySummary: { enabled: false, hour: 20 } }, ({ dailySummary }) => {
    if (!dailySummary || !dailySummary.enabled) {
      chrome.alarms.clear("cgmx_dailysummary");
      return;
    }
    const hour = Number(dailySummary.hour) || 20;
    const now = Date.now();
    const bkk = new Date(now + 7 * 3600 * 1000);
    let nextUtc =
      Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate(), hour, 0, 0) - 7 * 3600 * 1000;
    if (nextUtc <= now) nextUtc += 24 * 3600 * 1000;
    chrome.alarms.create("cgmx_dailysummary", { when: nextUtc });
  });
}

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

// Change a campaign's budget via the content script.
function execBudget(campaignId, campaignName, budget) {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: "https://ads.tiktok.com/*" }, (tabs) => {
      if (!tabs.length) return resolve({ ok: false, error: "no tiktok tab" });
      chrome.tabs.sendMessage(
        tabs[0].id,
        { type: "CGMX_BUDGET", campaignId, campaignName, budget },
        (r) => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r)
      );
    });
  });
}

// Change a campaign's ROI target (roas_bid) via the content script.
function execRoi(campaignId, campaignName, roi) {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: "https://ads.tiktok.com/*" }, (tabs) => {
      if (!tabs.length) return resolve({ ok: false, error: "no tiktok tab" });
      chrome.tabs.sendMessage(
        tabs[0].id,
        { type: "CGMX_ROI", campaignId, campaignName, roi },
        (r) => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r)
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
  // Always refresh data from TikTok first — this keeps the panel's numbers and
  // "last synced" time current every interval, regardless of the master toggle.
  await tabSync();
  const s = await chrome.storage.local.get(KEYS);
  if (!s.enabled) return; // only ACT (pause/create) when the program is on
  const acted = s.actedIds || {};
  const createdTs = s.createdTs || {};
  const scaledTs = s.scaledTs || {};
  const roiTs = s.roiTs || {};
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

  // --- Budget scaling: grow the budget of running (healthy) campaigns. ---
  for (const ch of s.channels || []) {
    const st = ch.settings || {};
    const sc = st.scaling || {};
    if (!sc.enabled) continue;
    const camps = (s.campaigns || []).filter((c) => channelMatch(c, ch) && statusRunning(c.status));
    for (const c of camps) {
      const budget = c.budget || 0;
      if (budget <= 0) continue;
      const intervalMs = (sc.intervalMin || 15) * 60 * 1000;
      if (scaledTs[c.id] && now - scaledTs[c.id] < intervalMs) continue;
      const usedPct = (c.cost / budget) * 100;
      // "time" mode scales every interval; otherwise scale once the used-budget
      // threshold is reached.
      const shouldScale = sc.mode === "time" ? true : usedPct >= (sc.whenUsedPercent || 50);
      if (!shouldScale) continue;
      let next = sc.scaleType === "percent" ? budget * (1 + (sc.amount || 0) / 100) : budget + (sc.amount || 0);
      next = Math.round(next);
      if (sc.cap && sc.cap > 0) next = Math.min(next, sc.cap);
      if (next <= budget) continue; // already at/over the cap
      const r = await execBudget(c.id, c.name, next);
      if (r && r.ok) scaledTs[c.id] = now;
      actions.push({
        ok: r && r.ok,
        name: `↗ เพิ่มงบ ${c.name}`,
        reason: r && r.ok ? `${budget} → ${next} ฿` : `ไม่สำเร็จ: ${(r && (r.error || r.msg)) || "?"}`,
      });
    }
  }

  // --- Auto ROI target: nudge roas_bid toward performance. ---
  for (const ch of s.channels || []) {
    const st = ch.settings || {};
    const ra = st.roiAuto || {};
    if (!ra.enabled) continue;
    const camps = (s.campaigns || []).filter((c) => channelMatch(c, ch) && statusRunning(c.status));
    for (const c of camps) {
      if (c.cost < (st.minBudgetBeforeCheck || 0)) continue; // need real data first
      const target = c.targetRoi || 0;
      if (target <= 0 || c.roi <= 0) continue;
      const intervalMs = (ra.intervalMin || 30) * 60 * 1000;
      if (roiTs[c.id] && now - roiTs[c.id] < intervalMs) continue;
      const step = ra.step || 0.1;
      let next = null;
      if (c.roi >= target + (ra.margin || 1)) next = Math.min(target + step, ra.max || 5);
      else if (c.roi <= target - (ra.margin || 1)) next = Math.max(target - step, ra.min || 1);
      if (next == null || Math.abs(next - target) < 0.05) continue;
      const r = await execRoi(c.id, c.name, next);
      if (r && r.ok) roiTs[c.id] = now;
      actions.push({
        ok: r && r.ok,
        type: "roi",
        name: `🎯 ปรับ ROI เป้า ${c.name}`,
        reason: r && r.ok ? `${target.toFixed(1)} → ${next.toFixed(1)} (จริง ${c.roi.toFixed(1)})` : `ไม่สำเร็จ: ${(r && (r.error || r.msg)) || "?"}`,
      });
    }
  }

  await chrome.storage.local.set({ actedIds: acted, createdTs, scaledTs, roiTs, lastRun: now });

  if (actions.length) {
    await addLogs(actions.map((a) => ({ ok: a.ok, text: `${a.name} — ${a.reason}` })));
    const okActs = actions.filter((a) => a.ok);
    const text =
      `🤖 GMV Max Monitor: ทำงาน ${okActs.length}/${actions.length} รายการ\n` +
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
    scheduleMidnight();
    scheduleDailySummary();
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === "CGMX_RUN_NOW") {
    runRules().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "CGMX_DAILY_TEST") {
    sendDailySummary().then(() => sendResponse({ ok: true }));
    return true;
  }
});
