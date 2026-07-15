import "@/lib/bootstrap";
import { NextRequest, NextResponse } from "next/server";
import { deleteRule, getRule, saveRule } from "@/lib/db";
import { parseRuleInput } from "@/lib/validate";

export const dynamic = "force-dynamic";

interface Ctx {
  params: { id: string };
}

// Full update, or a lightweight toggle when only { enabled } is sent.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const existing = getRule(params.id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const body = await req.json();

  // Quick enable/disable toggle.
  if (
    typeof body.enabled === "boolean" &&
    Object.keys(body).length === 1
  ) {
    const updated = {
      ...existing,
      enabled: body.enabled,
      updatedAt: new Date().toISOString(),
    };
    saveRule(updated);
    return NextResponse.json({ ok: true, rule: updated });
  }

  const parsed = parseRuleInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const updated = {
    ...existing,
    ...parsed.rule,
    updatedAt: new Date().toISOString(),
  };
  saveRule(updated);
  return NextResponse.json({ ok: true, rule: updated });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const removed = deleteRule(params.id);
  if (!removed) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
