import "@/lib/bootstrap";
import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

// Local debugging helper: authenticated GET proxy to the TikTok Marketing API.
// Lets us probe endpoints (e.g. /gmv_max/store/list/) to discover the right
// calls for LIVE GMV Max without re-shipping the app each time.
//
// Usage: /api/explore?path=/gmv_max/store/list/&extra=params
// - `path` is forwarded onto the configured apiBase (TikTok only).
// - all other query params are passed through as-is.
// - advertiser_id defaults to the connected account if not supplied.
// GET only, uses the stored token, intended for localhost use.
export async function GET(req: NextRequest) {
  const s = getSettings();
  if (!s.accessToken) {
    return NextResponse.json({ ok: false, error: "ยังไม่ได้เชื่อมต่อ" });
  }

  const params = new URLSearchParams(req.nextUrl.search);
  const path = params.get("path") || "";
  params.delete("path");
  if (!path.startsWith("/")) {
    return NextResponse.json({
      ok: false,
      error: "ต้องระบุ path ที่ขึ้นต้นด้วย / เช่น ?path=/gmv_max/store/list/",
    });
  }
  if (!params.has("advertiser_id")) {
    params.set("advertiser_id", s.advertiserId);
  }

  const base = s.apiBase.replace(/\/$/, "");
  const url = `${base}${path}?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: { "Access-Token": s.accessToken, "Content-Type": "application/json" },
    });
    const json = await res.json();
    // Echo back the request path so it's easy to see what was called.
    return NextResponse.json({ ok: true, requested: path, response: json });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
