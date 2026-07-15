import "@/lib/bootstrap";
import { NextRequest, NextResponse } from "next/server";
import { addLogs, getSettings, newId } from "@/lib/db";
import { getAdsWithMetrics, updateAdStatus } from "@/lib/tiktok";
import { AutomationLog, OperationStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// Manual enable/disable of one or more ads from the dashboard.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const adIds: string[] = Array.isArray(body.adIds) ? body.adIds : [];
  const status: OperationStatus =
    body.status === "ENABLE" ? "ENABLE" : "DISABLE";

  if (adIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No ad ids provided" },
      { status: 400 }
    );
  }

  const settings = getSettings();
  try {
    await updateAdStatus(settings, adIds, status);

    // Look up names for nicer logs (best-effort).
    let nameById: Record<string, string> = {};
    try {
      const ads = await getAdsWithMetrics(settings, "today");
      nameById = Object.fromEntries(ads.map((a) => [a.ad_id, a.ad_name]));
    } catch {
      /* ignore lookup failures */
    }

    const logs: AutomationLog[] = adIds.map((id) => ({
      id: newId("log_"),
      timestamp: new Date().toISOString(),
      ruleId: "manual",
      ruleName: "Manual action",
      level: "ad",
      entityId: id,
      entityName: nameById[id] ?? id,
      action: status,
      reason: "Manual toggle from dashboard",
      success: true,
      source: "manual",
    }));
    addLogs(logs);

    return NextResponse.json({ ok: true, updated: adIds.length, status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
