import cron, { ScheduledTask } from "node-cron";
import { getSettings } from "./db";
import { runAutomation } from "./rules-engine";

// Background scheduler. Boots from instrumentation.ts and re-reads settings on
// each tick so interval/enabled changes take effect without a restart.
//
// Next.js bundles instrumentation.ts and route handlers into separate module
// graphs, so a plain module-level singleton would not be shared between them.
// We stash the scheduler state on globalThis so every bundle sees one instance.

interface SchedulerState {
  task: ScheduledTask | null;
  currentInterval: number;
  running: boolean;
}

const g = globalThis as typeof globalThis & {
  __tkScheduler?: SchedulerState;
};

function state(): SchedulerState {
  if (!g.__tkScheduler) {
    g.__tkScheduler = { task: null, currentInterval: 0, running: false };
  }
  return g.__tkScheduler;
}

export function getSchedulerStatus() {
  const s = getSettings();
  return {
    enabled: s.schedulerEnabled,
    intervalMinutes: s.schedulerIntervalMinutes,
    active: state().task !== null,
  };
}

async function tick() {
  const st = state();
  if (st.running) return; // avoid overlapping runs
  st.running = true;
  try {
    const result = await runAutomation("auto");
    if (result.actionsTaken > 0) {
      console.log(
        `[scheduler] applied ${result.actionsTaken} action(s) across ${result.activeRules} rule(s)`
      );
    }
  } catch (e) {
    console.error("[scheduler] run failed:", e);
  } finally {
    st.running = false;
  }
}

// Starts (or reconfigures) the scheduler based on current settings.
export function startScheduler() {
  const st = state();
  const s = getSettings();

  if (!s.schedulerEnabled) {
    stopScheduler();
    return;
  }

  const interval = Math.max(1, Math.floor(s.schedulerIntervalMinutes || 15));

  // Already running at the right cadence.
  if (st.task && interval === st.currentInterval) return;

  stopScheduler();
  st.currentInterval = interval;

  // Run every `interval` minutes. For intervals >= 60 fall back to hourly at :00.
  const expr = interval >= 60 ? "0 * * * *" : `*/${interval} * * * *`;
  st.task = cron.schedule(expr, tick);
  console.log(`[scheduler] started, evaluating rules every ${interval} min`);
}

export function stopScheduler() {
  const st = state();
  if (st.task) {
    st.task.stop();
    st.task = null;
    st.currentInterval = 0;
  }
}

// Called by the settings API after saving so cadence updates immediately.
export function reloadScheduler() {
  startScheduler();
}
