import "@/lib/bootstrap";
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { getAuthorizedAdvertisers } from "@/lib/tiktok";

export const dynamic = "force-dynamic";

// Lists all advertiser accounts (sellers) the connected token can manage,
// so the user can switch which account the tool controls.
export async function GET() {
  const s = getSettings();
  if (!s.accessToken) {
    return NextResponse.json(
      { ok: false, error: "ยังไม่ได้เชื่อมต่อ" },
      { status: 400 }
    );
  }
  try {
    const advertisers = await getAuthorizedAdvertisers(s, s.accessToken);
    return NextResponse.json({ ok: true, advertisers, current: s.advertiserId });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
