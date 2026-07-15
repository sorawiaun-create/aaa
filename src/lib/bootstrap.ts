import { startScheduler } from "./scheduler";

// Reliable scheduler bootstrap. Next.js' instrumentation hook can be finicky to
// trigger under `next start`, so we also self-start the scheduler the first time
// any API route imports this module. The globalThis guard ensures it runs once
// per server process regardless of how many routes import it.

const g = globalThis as typeof globalThis & { __tkBootstrapped?: boolean };

if (!g.__tkBootstrapped) {
  g.__tkBootstrapped = true;
  try {
    startScheduler();
  } catch (e) {
    console.error("[bootstrap] failed to start scheduler:", e);
  }
}

export {};
