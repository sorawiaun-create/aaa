import "@/lib/bootstrap";
import { NextRequest, NextResponse } from "next/server";
import { deleteAlert, getAlerts, saveAlert } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Ctx {
  params: { id: string };
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const existing = getAlerts().find((a) => a.id === params.id);
  if (!existing)
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const body = await req.json();
  if (typeof body.enabled === "boolean") {
    saveAlert({ ...existing, enabled: body.enabled });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const ok = deleteAlert(params.id);
  return NextResponse.json({ ok });
}
