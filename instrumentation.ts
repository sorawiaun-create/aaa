// Next.js instrumentation hook. Runs once when the server process boots.
// Must live at the project root (not src/) for Next 14 to detect it here.
// We use it to start the automation scheduler in the Node.js runtime only.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("[instrumentation] register() booting scheduler");
    const { startScheduler } = await import("./src/lib/scheduler");
    startScheduler();
  }
}
