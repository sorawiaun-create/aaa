import "@/lib/bootstrap";
import { NextRequest, NextResponse } from "next/server";
import { getLogs } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
  return NextResponse.json({ ok: true, logs: getLogs(limit) });
}
