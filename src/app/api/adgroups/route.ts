import "@/lib/bootstrap";
import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { getAdGroupsWithMetrics } from "@/lib/tiktok";
import { TimeWindow } from "@/lib/types";

export const dynamic = "force-dynamic";

const WINDOWS: TimeWindow[] = ["today", "yesterday", "last_3d", "last_7d"];

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("window") as TimeWindow;
  const window: TimeWindow = WINDOWS.includes(raw) ? raw : "today";
  try {
    const adgroups = await getAdGroupsWithMetrics(getSettings(), window);
    return NextResponse.json({ ok: true, window, adgroups });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
