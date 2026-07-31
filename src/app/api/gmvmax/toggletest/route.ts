import "@/lib/bootstrap";
import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { diagnoseGmvMaxToggle } from "@/lib/tiktok";
import { OperationStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// Diagnostic: /api/gmvmax/toggletest?campaign_id=123&to=DISABLE
// Tries each candidate status endpoint server-side and reports which one
// actually changes the campaign's status. no-store so the browser can't cache.
export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaign_id") || "";
  const to = (req.nextUrl.searchParams.get("to") || "DISABLE").toUpperCase();
  const target: OperationStatus = to === "ENABLE" ? "ENABLE" : "DISABLE";

  if (!campaignId) {
    return NextResponse.json({ ok: false, error: "ต้องระบุ campaign_id" });
  }

  try {
    const result = await diagnoseGmvMaxToggle(getSettings(), campaignId, target);
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}
