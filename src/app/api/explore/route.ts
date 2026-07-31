import "@/lib/bootstrap";
import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

// Local debugging helper: authenticated proxy to the TikTok Marketing API.
// Lets us probe endpoints (incl. POST) to discover the right calls without
// re-shipping the app each time. GET/POST only, uses the stored token,
// intended for localhost use.
//
// GET probe:  /api/explore?path=/gmv_max/store/list/
// POST probe: /api/explore?method=POST&path=/campaign/status/update/&body={...json...}
async function handle(req: NextRequest) {
  const s = getSettings();
  if (!s.accessToken) {
    return NextResponse.json({ ok: false, error: "ยังไม่ได้เชื่อมต่อ" });
  }

  const params = new URLSearchParams(req.nextUrl.search);
  const path = params.get("path") || "";
  const method = (params.get("method") || "GET").toUpperCase();
  const bodyRaw = params.get("body");
  params.delete("path");
  params.delete("method");
  params.delete("body");

  if (!path.startsWith("/")) {
    return NextResponse.json({
      ok: false,
      error: "ต้องระบุ path ที่ขึ้นต้นด้วย / เช่น ?path=/gmv_max/store/list/",
    });
  }

  const base = s.apiBase.replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Access-Token": s.accessToken,
    "Content-Type": "application/json",
  };

  try {
    let res: Response;
    if (method === "POST") {
      let body: Record<string, unknown> = {};
      if (bodyRaw) {
        try {
          body = JSON.parse(bodyRaw);
        } catch {
          return NextResponse.json({
            ok: false,
            error: "body ต้องเป็น JSON ที่ถูกต้อง",
          });
        }
      }
      if (!("advertiser_id" in body)) body.advertiser_id = s.advertiserId;
      res = await fetch(`${base}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } else {
      if (!params.has("advertiser_id"))
        params.set("advertiser_id", s.advertiserId);
      res = await fetch(`${base}${path}?${params.toString()}`, { headers });
    }
    const json = await res.json();
    return NextResponse.json({ ok: true, method, requested: path, response: json });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}

export const GET = handle;
export const POST = handle;
