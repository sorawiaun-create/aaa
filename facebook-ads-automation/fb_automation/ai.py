"""AI วิเคราะห์ Ads + แนะนำการปรับ (ใช้ ChatGPT ของ OpenAI).

เฟส 1: วิเคราะห์อย่างเดียว — สรุปสุขภาพพอร์ต, วินิจฉัยรายบัญชี, และ
เสนอสิ่งที่ควรทำ (คน/ระบบค่อยตัดสินใจเอง) ยังไม่สั่งแก้แอดโดยตรง.

ออกแบบให้ทดสอบได้ง่าย:
- ``compact_data`` และ ``build_analysis_prompt`` เป็นฟังก์ชันบริสุทธิ์ (ไม่ต่อเน็ต)
- ``run_analysis`` เท่านั้นที่เรียก OpenAI จริง
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

log = logging.getLogger("fb_automation")

DEFAULT_MODEL = "gpt-4o"

# ช่วงเวลาที่ส่งให้ AI ดู (ย่อจาก status.json ให้กระชับ ประหยัด token)
_AI_PERIODS = ["today", "yesterday", "last_7d", "last_30d"]

# โครงผลลัพธ์แบบมีโครงสร้าง (structured output) เพื่อให้ Dashboard อ่านง่าย
ANALYSIS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "สรุปภาพรวมทั้งพอร์ตเป็นภาษาไทย 2-4 ประโยค"},
        "overall_health": {"type": "string", "enum": ["good", "warning", "bad"]},
        "priority_actions": {
            "type": "array",
            "description": "สิ่งที่ควรทำก่อน เรียงจากสำคัญสุด (ภาษาไทย)",
            "items": {"type": "string"},
        },
        "accounts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "health": {"type": "string", "enum": ["good", "warning", "bad"]},
                    "diagnosis": {"type": "string", "description": "วินิจฉัยบัญชีนี้เป็นภาษาไทย"},
                    "recommendations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "campaign": {"type": "string"},
                                "action": {
                                    "type": "string",
                                    "enum": ["PAUSE", "SCALE_UP", "SCALE_DOWN", "KEEP", "REVIEW"],
                                },
                                "reason": {"type": "string", "description": "เหตุผลเป็นภาษาไทย อ้างอิงตัวเลขจริง"},
                            },
                            "required": ["action", "reason"],
                        },
                    },
                },
                "required": ["name", "health", "diagnosis", "recommendations"],
            },
        },
    },
    "required": ["summary", "overall_health", "priority_actions", "accounts"],
}

SYSTEM_PROMPT = (
    "คุณเป็นผู้เชี่ยวชาญยิงแอด Facebook สำหรับสินค้าอีคอมเมิร์ซในไทย "
    "หน้าที่ของคุณคือวิเคราะห์ผลของแต่ละบัญชี/แคมเปญจากตัวเลขจริง แล้วบอกว่าควรทำอะไรเพื่อ 'ทำกำไร' "
    "ให้มากที่สุด โดยดูจาก ROAS (ยิ่งสูงยิ่งดี), ยอดใช้จ่าย, ยอดขาย, จำนวนออร์เดอร์ และต้นทุนต่อออร์เดอร์ "
    "หลักคิด: แคมเปญ ROAS สูงและมีออร์เดอร์ ควรเพิ่มงบ (SCALE_UP); "
    "แคมเปญใช้เงินเยอะแต่ ROAS ต่ำ/ไม่มีออร์เดอร์ ควรลดงบหรือปิด (SCALE_DOWN/PAUSE); "
    "แคมเปญที่ดีอยู่แล้วให้คงไว้ (KEEP); ข้อมูลไม่พอให้ REVIEW. "
    "ตอบเป็นภาษาไทยล้วน กระชับ ตรงประเด็น และอ้างอิงตัวเลขจริงเสมอ "
    "จุดคุ้มทุนของธุรกิจนี้ประมาณ ROAS 1.5-2.0 (ต่ำกว่านี้มักขาดทุน)."
)


def _round(v: Any, n: int = 2) -> Any:
    try:
        return round(float(v), n)
    except (TypeError, ValueError):
        return v


def compact_data(status: dict, board: dict) -> dict:
    """ย่อ status.json + board.json ให้เหลือเฉพาะสิ่งที่ AI ต้องใช้ (ประหยัด token).

    ข้ามบัญชีที่ถูกปิด/มี error เพื่อไม่ให้ AI วิเคราะห์ข้อมูลที่ไม่ครบ.
    """
    board_by_acc = {a.get("account_id"): a for a in (board or {}).get("accounts", [])}
    out_accounts = []
    for acc in (status or {}).get("accounts", []):
        if acc.get("disabled") or acc.get("error"):
            continue
        periods = acc.get("periods", {}) or {}
        acc_periods = {}
        for p in _AI_PERIODS:
            d = periods.get(p) or {}
            acc_periods[p] = {
                "spend": _round(d.get("spend", 0)),
                "revenue": _round(d.get("revenue", 0)),
                "roas": _round(d.get("roas", 0)),
                "orders": int(d.get("orders", 0) or 0),
                "cost_per_order": _round(d.get("cost_per_order", 0)),
            }
        camps = []
        bacc = board_by_acc.get(acc.get("account_id")) or {}
        for c in bacc.get("campaigns", []) or []:
            camps.append({
                "name": c.get("name", ""),
                "status": c.get("status", ""),
                "budget": c.get("budget"),
                "spend_today": _round(c.get("spend", 0)),
                "roas_today": _round(c.get("roas", 0)),
                "orders_today": int(c.get("orders", 0) or 0),
            })
        out_accounts.append({
            "name": acc.get("name", ""),
            "periods": acc_periods,
            "campaigns": camps,
        })
    return {
        "updated_at": (status or {}).get("updated_at"),
        "portfolio_totals": (status or {}).get("period_totals", {}),
        "accounts": out_accounts,
    }


def build_analysis_prompt(status: dict, board: dict) -> str:
    """สร้างข้อความ (prompt) สำหรับส่งให้ Claude — คืน string (ทดสอบได้)."""
    data = compact_data(status, board)
    return (
        "นี่คือข้อมูลผลการยิงแอด Facebook หลายบัญชี (ตัวเลขเป็นเงินบาท, ROAS = รายได้/ค่าโฆษณา)\n"
        "ช่วงเวลา: today=วันนี้, yesterday=เมื่อวาน, last_7d=7 วัน, last_30d=30 วัน\n\n"
        "```json\n" + json.dumps(data, ensure_ascii=False, indent=1) + "\n```\n\n"
        "กรุณาวิเคราะห์และตอบตามโครงสร้างที่กำหนด:\n"
        "1) summary: สรุปภาพรวมทั้งพอร์ต\n"
        "2) overall_health: good/warning/bad\n"
        "3) priority_actions: 3-6 ข้อ ควรทำก่อนอะไร\n"
        "4) accounts: แต่ละบัญชีให้ diagnosis + recommendations (ระบุแคมเปญ, action, เหตุผลพร้อมตัวเลข)\n"
    )


def _parse_json_text(text: str) -> dict:
    """แปลงข้อความตอบกลับเป็น dict (เผื่อโมเดลใส่ ```json ... ``` ครอบ)."""
    text = (text or "").strip()
    if not text:
        raise ValueError("ไม่มีข้อความตอบกลับจาก AI")
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip().rstrip("`").strip()
    return json.loads(text)


def run_analysis(status: dict, board: dict, api_key: str,
                 model: str = DEFAULT_MODEL, max_tokens: int = 4000) -> dict:
    """เรียก OpenAI (ChatGPT) วิเคราะห์จริง คืน dict ตามโครงสร้าง ANALYSIS_SCHEMA (+ meta)."""
    from openai import OpenAI  # import ในฟังก์ชันเพื่อให้ import โมดูลไม่พังถ้ายังไม่ติดตั้ง

    client = OpenAI(api_key=api_key)
    prompt = build_analysis_prompt(status, board)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]
    base: dict[str, Any] = {"model": model, "messages": messages}
    # ลองหลายแบบเผื่อโมเดลบางรุ่นไม่รองรับพารามิเตอร์บางตัว (เช่น max_tokens vs max_completion_tokens)
    attempts = [
        {**base, "response_format": {"type": "json_object"}, "max_tokens": max_tokens},
        {**base, "response_format": {"type": "json_object"}, "max_completion_tokens": max_tokens},
        {**base, "max_completion_tokens": max_tokens},
        base,
    ]
    last_err: Exception | None = None
    for kwargs in attempts:
        try:
            resp = client.chat.completions.create(**kwargs)
            return _parse_json_text(resp.choices[0].message.content)
        except Exception as e:  # noqa: BLE001
            last_err = e
            continue
    raise last_err if last_err else RuntimeError("เรียก OpenAI ไม่สำเร็จ")


def write_analysis(path: str, data: dict[str, Any]) -> None:
    """เขียน analysis.json แบบ atomic ให้ Dashboard อ่าน."""
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def maybe_run_analysis(status: dict, board: dict, now_iso: str) -> bool:
    """ถ้าตั้ง RUN_AI=1 และมี ANTHROPIC_API_KEY ให้เรียก AI วิเคราะห์แล้วเขียน analysis.json.

    คืน True ถ้าวิเคราะห์สำเร็จ. ออกแบบให้ 'ไม่ทำให้รอบหลักพัง' — จับ error ทั้งหมด.
    """
    if str(os.environ.get("RUN_AI", "")).strip().lower() not in ("1", "true", "yes", "on"):
        return False
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        log.warning("ตั้ง RUN_AI แต่ไม่พบ OPENAI_API_KEY — ข้ามการวิเคราะห์ AI")
        return False
    model = os.environ.get("AI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    path = os.environ.get("ANALYSIS_PATH", "analysis.json")
    try:
        log.info("🤖 เริ่มให้ AI (%s) วิเคราะห์ Ads ...", model)
        result = run_analysis(status, board, api_key, model=model)
        result["generated_at"] = now_iso
        result["model"] = model
        write_analysis(path, result)
        n = len(result.get("accounts", []))
        log.info("🤖 AI วิเคราะห์เสร็จ (%d บัญชี) -> %s", n, path)
        return True
    except Exception as e:  # noqa: BLE001
        log.error("🤖 AI วิเคราะห์ล้มเหลว: %s", e)
        try:
            write_analysis(path, {
                "error": str(e)[:400],
                "generated_at": now_iso,
                "model": model,
            })
        except OSError:
            pass
        return False
