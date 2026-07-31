import "@/lib/bootstrap";
import { NextRequest, NextResponse } from "next/server";
import { addLogs, getSettings, newId } from "@/lib/db";
import { updateAdGroupStatus } from "@/lib/tiktok";
import { AutomationLog, OperationStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const adgroupIds: string[] = Array.isArray(body.adgroupIds)
    ? body.adgroupIds
    : [];
  const status: OperationStatus =
    body.status === "ENABLE" ? "ENABLE" : "DISABLE";
  if (adgroupIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No adgroup ids provided" },
      { status: 400 }
    );
  }
  try {
    await updateAdGroupStatus(getSettings(), adgroupIds, status);
    const logs: AutomationLog[] = adgroupIds.map((id) => ({
      id: newId("log_"),
      timestamp: new Date().toISOString(),
      ruleId: "manual",
      ruleName: "Manual action",
      level: "adgroup",
      entityId: id,
      entityName: id,
      action: status,
      reason: "Manual toggle from Ad Groups page",
      success: true,
      source: "manual",
    }));
    addLogs(logs);
    return NextResponse.json({ ok: true, updated: adgroupIds.length, status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
