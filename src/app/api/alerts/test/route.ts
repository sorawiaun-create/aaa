import "@/lib/bootstrap";
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { notifyWebhook } from "@/lib/tiktok";

export const dynamic = "force-dynamic";

// Sends a test message to the configured webhook.
export async function POST() {
  const s = getSettings();
  if (!s.webhookUrl) {
    return NextResponse.json(
      { ok: false, error: "ยังไม่ได้ตั้ง Webhook URL ในหน้า Settings" },
      { status: 400 }
    );
  }
  try {
    await notifyWebhook(
      s.webhookUrl,
      "🔔 ทดสอบการแจ้งเตือนจาก TikTok Ads Automation — ใช้งานได้!"
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
