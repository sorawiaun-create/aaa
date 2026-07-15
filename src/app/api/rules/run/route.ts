import "@/lib/bootstrap";
import { NextResponse } from "next/server";
import { runAutomation } from "@/lib/rules-engine";

export const dynamic = "force-dynamic";

// Manually trigger a full rules evaluation right now (the "Run now" button).
export async function POST() {
  try {
    const result = await runAutomation("manual");
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
