import "@/lib/bootstrap";
import { NextRequest, NextResponse } from "next/server";
import { getRules, newId, saveRule } from "@/lib/db";
import { parseRuleInput } from "@/lib/validate";
import { AutomationRule } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, rules: getRules() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = parseRuleInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const now = new Date().toISOString();
  const rule: AutomationRule = {
    id: newId("rule_"),
    ...parsed.rule,
    createdAt: now,
    updatedAt: now,
  };
  saveRule(rule);
  return NextResponse.json({ ok: true, rule });
}
