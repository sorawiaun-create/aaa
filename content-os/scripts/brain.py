"""ให้ Claude คิดคอนเทนต์เองทั้งหมด — สมองของ Content OS.

รับ "ข้อเท็จจริง" ที่ดึงมาจริง (โปรไฟล์ IG, โพสต์ที่เวิร์ค, ตัวเลขโฆษณา)
แล้วให้ Claude คิดต่อให้เอง: เทรนด์วันนี้ · คู่แข่งที่ควรตาม · คลัง HOOK ·
ปฏิทินคอนเทนต์พร้อมสคริปต์เต็ม · สรุปเช้านี้ · สิ่งที่ควรทำวันนี้

ทำงาน 2 จังหวะ:
1. ``research``  — Claude ค้นเว็บเองว่าตอนนี้วงการนี้มีเทรนด์อะไร ใครกำลังมาแรง
2. ``plan``      — เอาตัวเลขจริง + ผลค้น มาออกแบบแผนคอนเทนต์เป็น JSON ตามโครงหน้าเว็บ

ออกแบบให้ทดสอบได้: ``build_research_prompt`` และ ``build_plan_prompt`` เป็น
ฟังก์ชันบริสุทธิ์ (ไม่ต่อเน็ต) มีแค่ ``Brain.research`` / ``Brain.plan`` ที่เรียก API จริง
"""
from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from typing import Any

import anthropic

log = logging.getLogger("content-os")

MODEL = "claude-opus-5"

# ถ้า Claude ปฏิเสธคำขอด้วยเหตุผลด้านนโยบาย ให้ API ลองรุ่นสำรองให้ในคำขอเดียวกัน
FALLBACK_BETA = "server-side-fallback-2026-06-01"
FALLBACKS = [{"model": "claude-opus-4-8"}]

# ชื่อหน้าในเว็บ ใช้เป็นปลายทางของปุ่มใน "สิ่งที่ควรทำวันนี้"
PAGES = ["analytics", "rivals", "trends", "hooks", "schedule", "calendar", "ads"]
TAG_KINDS = ["", "good", "pink", "warn"]

SYSTEM = (
    "คุณเป็นผู้อำนวยการฝ่ายการตลาดคอนเทนต์ของธุรกิจไทย ทำงานให้เจ้าของธุรกิจที่ไม่มีทีม "
    "หน้าที่ของคุณคือตื่นมาทุกเช้า 6 โมง ดูตัวเลขจริงของเมื่อวาน แล้ววางแผนให้เสร็จสรรพ "
    "เจ้าของธุรกิจแค่เปิดมาอ่านแล้วลงมือทำได้เลย ไม่ต้องคิดเอง ไม่ต้องสั่งเพิ่ม\n\n"
    "หลักการเขียน:\n"
    "- เขียนภาษาไทยแบบคนทำงานจริงคุยกัน ไม่ใช่ภาษาการตลาดลอย ๆ\n"
    "- อ้างตัวเลขจริงที่ได้รับมาเสมอ ห้ามแต่งตัวเลขขึ้นเอง ถ้าไม่มีตัวเลขให้พูดเชิงคุณภาพแทน\n"
    "- ทุกข้อเสนอต้องลงมือทำได้ภายในวันนี้ บอกให้ชัดว่าทำอะไร ไม่ใช่ 'ควรปรับปรุงคอนเทนต์'\n"
    "- สคริปต์ต้องเขียนจริงให้ครบ ถ่ายตามได้เลย ไม่ใช่โครงร่างว่างเปล่า"
)

# โครงผลลัพธ์ — ตรงกับที่หน้าเว็บ (index.html) ต้องใช้พอดี
PLAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["profile", "summary", "todo", "weak", "rivals", "trends", "hooks", "calendar", "adsAdvice"],
    "properties": {
        "profile": {
            "type": "object",
            "additionalProperties": False,
            "required": ["niche", "audience", "tone"],
            "properties": {
                "niche": {"type": "string", "description": "ธุรกิจนี้ทำอะไร สรุปสั้น ๆ จาก bio และคอนเทนต์ที่เห็น"},
                "audience": {"type": "string", "description": "คนดูหลักเป็นใคร"},
                "tone": {"type": "string", "description": "โทนการพูดของแบรนด์นี้"},
            },
        },
        "summary": {
            "type": "array",
            "description": "สรุปเช้านี้ 3-5 ข้อ อ้างตัวเลขจริง ใส่ <b> เน้นคำสำคัญได้",
            "items": {"type": "string"},
        },
        "todo": {
            "type": "array",
            "description": "สิ่งที่ควรทำวันนี้ 3-5 ข้อ เรียงจากผลกระทบต่อยอดมากสุด",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["title", "note", "cta", "go"],
                "properties": {
                    "title": {"type": "string", "description": "ทำอะไร บอกเป็นประโยคคำสั่งที่ลงมือได้เลย"},
                    "note": {"type": "string", "description": "ทำไมต้องทำ + ใช้เวลาเท่าไหร่"},
                    "cta": {"type": "string", "description": "ข้อความบนปุ่ม สั้น ๆ"},
                    "go": {"type": "string", "enum": PAGES, "description": "หน้าที่ปุ่มพาไป"},
                },
            },
        },
        "weak": {
            "type": "array",
            "description": "คอนเทนต์ที่ต่ำกว่าค่าเฉลี่ย 0-3 ข้อ พร้อมบอกว่าควรแก้ตรงไหน (ถ้าไม่มีข้อมูลให้ส่งลิสต์ว่าง)",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["title", "note", "tag"],
                "properties": {
                    "title": {"type": "string"},
                    "note": {"type": "string", "description": "ตัวเลข + สาเหตุที่คิดว่าไม่เวิร์ค"},
                    "tag": {"type": "string", "description": "สิ่งที่ควรแก้ สั้น ๆ เช่น 'แก้ hook'"},
                },
            },
        },
        "rivals": {
            "type": "object",
            "additionalProperties": False,
            "required": ["creators", "spotlight", "hooks"],
            "properties": {
                "creators": {
                    "type": "array",
                    "description": "ครีเอเตอร์/แบรนด์สายเดียวกันที่ควรตาม 6-8 ราย จากผลค้นเว็บเท่านั้น",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["handle", "followers", "delta", "dir"],
                        "properties": {
                            "handle": {"type": "string", "description": "@ชื่อบัญชี"},
                            "followers": {"type": "string", "description": "ผู้ติดตามโดยประมาณ เช่น '214K' — ถ้าไม่รู้ให้ใส่ '—'"},
                            "delta": {"type": "string", "description": "เช่น '+8.6%' — ถ้าไม่รู้ให้ใส่ ''"},
                            "dir": {"type": "string", "enum": ["up", "down"]},
                        },
                    },
                },
                "spotlight": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["handle", "text", "big", "bigNote"],
                    "properties": {
                        "handle": {"type": "string"},
                        "text": {"type": "string", "description": "เขาทำอะไรน่าสนใจสัปดาห์นี้ ใส่ <b> เน้นได้"},
                        "big": {"type": "string", "description": "ตัวเลขเด่น เช่น '+12.4K' — ถ้าไม่รู้ให้ใส่ '—'"},
                        "bigNote": {"type": "string", "description": "ตัวเลขนั้นคืออะไร"},
                    },
                },
                "hooks": {
                    "type": "array",
                    "description": "hook ที่แกะจากคอนเทนต์ที่ปังของคนอื่น 3-5 อัน ทำเป็นเทมเพลตใส่ [ตัวแปร]",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["title", "note", "tag"],
                        "properties": {
                            "title": {"type": "string"},
                            "note": {"type": "string", "description": "มาจากใคร/ทำไมมันเวิร์ค"},
                            "tag": {"type": "string", "description": "ประเภท เช่น BUILD LIST SWAP CONTRARIAN"},
                        },
                    },
                },
            },
        },
        "trends": {
            "type": "object",
            "additionalProperties": False,
            "required": ["badge", "items", "advice"],
            "properties": {
                "badge": {"type": "string", "description": "เช่น '5 อันทำ HOOK ได้'"},
                "items": {
                    "type": "array",
                    "description": "เทรนด์ 4-6 ข้อจากผลค้นเว็บ เรียงจากที่เอามาทำคอนเทนต์ได้ดีสุด",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["title", "tag", "kind", "skip"],
                        "properties": {
                            "title": {"type": "string", "description": "พาดหัวข่าว/เทรนด์ สั้น"},
                            "tag": {"type": "string", "description": "HOOK = ทำคอนเทนต์ได้เลย, EXPLAIN = อธิบายได้, SKIP = ข้าม"},
                            "kind": {"type": "string", "enum": TAG_KINDS, "description": "pink=HOOK, good=EXPLAIN, ว่าง=SKIP"},
                            "skip": {"type": "string", "description": "ถ้า tag เป็น SKIP ให้บอกเหตุผลสั้น ๆ ไม่งั้นใส่ ''"},
                        },
                    },
                },
                "advice": {"type": "string", "description": "วันนี้ควรจับเทรนด์ไหนก่อน และทำมุมไหน ใส่ <b> เน้นได้"},
            },
        },
        "hooks": {
            "type": "array",
            "description": "คลัง hook 8-12 อัน เทมเพลตใส่ [ตัวแปร] ให้เข้ากับธุรกิจนี้",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["text", "uses", "tag", "kind"],
                "properties": {
                    "text": {"type": "string"},
                    "uses": {"type": "string", "description": "ประมาณว่าเคยเห็นใช้บ่อยแค่ไหน เช่น '24×'"},
                    "tag": {"type": "string"},
                    "kind": {"type": "string", "enum": TAG_KINDS},
                },
            },
        },
        "calendar": {
            "type": "array",
            "description": "แผนลงคอนเทนต์ 7-10 ชิ้นในเดือนนี้ เว้นจังหวะให้สม่ำเสมอ ใส่เฉพาะวันที่ยังมาไม่ถึง",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["day", "events", "script"],
                "properties": {
                    "day": {"type": "integer", "description": "วันที่ของเดือนนี้"},
                    "events": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["t", "k"],
                            "properties": {
                                "t": {"type": "string", "description": "เวลาโพสต์ เช่น '7:30a'"},
                                "k": {"type": "string", "description": "ประเภท · แพลตฟอร์ม เช่น 'REEL · IG'"},
                            },
                        },
                    },
                    "script": {
                        "type": "string",
                        "description": (
                            "สคริปต์เต็มที่ถ่ายตามได้เลย รูปแบบ:\n"
                            "HOOK (0:00–0:03) แล้วประโยคเปิดจริง\n"
                            "BODY แล้วประเด็นทีละข้อ\n"
                            "CTA แล้วประโยคปิดจริง\n"
                            "ถ้าเป็น CAROUSEL ให้ไล่เนื้อหาทีละสไลด์"
                        ),
                    },
                },
            },
        },
        "adsAdvice": {
            "type": "string",
            "description": "อ่านตารางแคมเปญแล้วบอกว่าตัวไหนควรเพิ่มงบ ตัวไหนควรหยุด ย้ายงบเท่าไหร่ อ้างตัวเลขจริง ใส่ <b> เน้นได้ ถ้าไม่มีข้อมูลโฆษณาให้ตอบว่ายังไม่ได้ต่อบัญชีโฆษณา",
        },
    },
}


# --------------------------------------------------------------------------
# prompt (ฟังก์ชันบริสุทธิ์ — เทสได้โดยไม่ต้องต่อเน็ต)
# --------------------------------------------------------------------------
def build_research_prompt(profile: dict[str, Any]) -> str:
    bio = profile.get("biography") or "(ไม่มี bio)"
    captions = profile.get("captions") or []
    sample = "\n".join(f"- {c}" for c in captions[:8]) or "- (ยังไม่มีโพสต์)"
    return (
        f"นี่คือบัญชี Instagram ของลูกค้าผม:\n"
        f"ชื่อบัญชี: {profile.get('brand', '(ไม่ทราบ)')}\n"
        f"ผู้ติดตาม: {profile.get('followers', '(ไม่ทราบ)')}\n"
        f"Bio: {bio}\n"
        f"แคปชันโพสต์ล่าสุด:\n{sample}\n\n"
        "ช่วยค้นเว็บให้หน่อยครับ ผมอยากรู้ 2 เรื่องเพื่อเอาไปวางแผนคอนเทนต์สัปดาห์นี้:\n\n"
        "1. เทรนด์/ข่าวใน 7 วันล่าสุด ที่เกี่ยวกับวงการของบัญชีนี้ และเอามาทำคอนเทนต์ได้จริง "
        "เอาที่มีแหล่งอ้างอิงชัดเจน ระบุวันที่ด้วย\n"
        "2. ครีเอเตอร์หรือแบรนด์สายเดียวกันที่กำลังมาแรงตอนนี้ ใครบ้าง ใช้ hook แบบไหน "
        "ถ้าเจอตัวเลขผู้ติดตามให้บอกด้วย ถ้าไม่เจอก็บอกว่าไม่เจอ อย่าเดา\n\n"
        "ตอบเป็นบันทึกย่อภาษาไทย ไม่ต้องจัดรูปแบบสวยงาม ผมจะเอาไปใช้ต่อ "
        "สำคัญมาก: ตัวเลขไหนที่ไม่ได้เจอจากการค้นจริง ให้เขียนว่า 'ไม่ทราบ' ห้ามเดาเด็ดขาด"
    )


def build_plan_prompt(profile: dict[str, Any], facts: dict[str, Any], research: str, today: date) -> str:
    first_next = date(today.year + today.month // 12, today.month % 12 + 1, 1)
    last_day = (first_next - timedelta(days=1)).day
    return (
        "## บัญชีที่ดูแล\n"
        f"{profile.get('brand', '(ไม่ทราบ)')} · ผู้ติดตาม {profile.get('followers', '(ไม่ทราบ)')}\n"
        f"Bio: {profile.get('biography') or '(ไม่มี)'}\n\n"
        "## ตัวเลขจริงที่ดึงมาได้เมื่อเช้านี้\n"
        f"```json\n{json.dumps(facts, ensure_ascii=False, indent=2)}\n```\n\n"
        "## ผลค้นเว็บเรื่องเทรนด์และคู่แข่ง\n"
        f"{research or '(ค้นไม่สำเร็จ — ให้ข้ามส่วนเทรนด์กับคู่แข่งโดยใส่ลิสต์เท่าที่มั่นใจจริง)'}\n\n"
        "## สิ่งที่ต้องทำ\n"
        f"วันนี้คือวันที่ {today.day} เดือน {today.month} ปี {today.year} เดือนนี้มี {last_day} วัน\n"
        "วางแผนคอนเทนต์ให้บัญชีนี้ทั้งชุด ตามโครงที่กำหนดไว้\n\n"
        "กติกา:\n"
        f"- ปฏิทินให้ลงเฉพาะวันที่ {today.day} ถึง {last_day} เท่านั้น (วันที่ผ่านไปแล้วลงไม่ได้)\n"
        "- สคริปต์ทุกอันต้องเขียนจริงให้ครบ ถ่ายตามได้เลย ไม่ใช่โครงร่าง\n"
        "- ตัวเลขในส่วน summary กับ adsAdvice ต้องมาจากตัวเลขจริงข้างบนเท่านั้น\n"
        "- ครีเอเตอร์และเทรนด์ต้องมาจากผลค้นเว็บเท่านั้น ห้ามแต่งชื่อบัญชีขึ้นมาเอง "
        "ถ้าผลค้นไม่พอ ให้ใส่เท่าที่มีจริง ลิสต์สั้นกว่าที่ขอได้"
    )


# --------------------------------------------------------------------------
def _text_of(message: Any) -> str:
    return "".join(b.text for b in message.content if getattr(b, "type", "") == "text")


class Brain:
    """ห่อการเรียก Claude ให้เหลือ 2 เมธอด"""

    def __init__(self, model: str = MODEL):
        self.model = model
        self.client = anthropic.Anthropic()   # อ่าน ANTHROPIC_API_KEY จาก environment

    def research(self, profile: dict[str, Any], max_restarts: int = 3) -> str:
        """ให้ Claude ค้นเว็บเองว่าตอนนี้วงการนี้มีอะไรเกิดขึ้น"""
        messages: list[dict[str, Any]] = [{"role": "user", "content": build_research_prompt(profile)}]
        message = None
        for _ in range(max_restarts + 1):
            with self.client.beta.messages.stream(
                model=self.model,
                max_tokens=16000,
                betas=[FALLBACK_BETA],
                fallbacks=FALLBACKS,
                thinking={"type": "adaptive"},
                output_config={"effort": "medium"},
                tools=[{"type": "web_search_20260209", "name": "web_search", "max_uses": 8}],
                messages=messages,
            ) as stream:
                message = stream.get_final_message()
            # เครื่องมือค้นเว็บทำงานฝั่ง Anthropic — ถ้ารอบนี้ยังไม่จบ ต้องส่งกลับไปให้ทำต่อ
            if message.stop_reason != "pause_turn":
                break
            messages.append({"role": "assistant", "content": message.content})

        if message is None:
            return ""
        if message.stop_reason == "refusal":
            log.warning("  Claude ปฏิเสธคำขอค้นเว็บ: %s", getattr(message.stop_details, "explanation", ""))
            return ""
        return _text_of(message)

    def plan(self, profile: dict[str, Any], facts: dict[str, Any], research: str,
             today: date | None = None) -> dict[str, Any]:
        """เอาตัวเลขจริง + ผลค้น มาออกแบบแผนคอนเทนต์ทั้งชุด"""
        response = self.client.beta.messages.create(
            model=self.model,
            max_tokens=16000,
            betas=[FALLBACK_BETA],
            fallbacks=FALLBACKS,
            system=SYSTEM,
            thinking={"type": "adaptive"},
            output_config={
                "effort": "high",
                "format": {"type": "json_schema", "schema": PLAN_SCHEMA},
            },
            messages=[{
                "role": "user",
                "content": build_plan_prompt(profile, facts, research, today or date.today()),
            }],
        )
        if response.stop_reason == "refusal":
            raise RuntimeError(f"Claude ปฏิเสธคำขอ: {getattr(response.stop_details, 'explanation', '')}")
        if response.stop_reason == "max_tokens":
            raise RuntimeError("คำตอบยาวเกิน max_tokens — ลดจำนวนคอนเทนต์ที่ขอในแต่ละรอบ")
        return json.loads(_text_of(response))


# --------------------------------------------------------------------------
# แปลงผลจาก Claude ให้เป็นโครงที่หน้าเว็บใช้ได้ตรง ๆ
# --------------------------------------------------------------------------
THAI_MONTHS = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
]


def to_sections(plan: dict[str, Any], today: date) -> dict[str, Any]:
    """แปลงผลลัพธ์จาก ``Brain.plan`` เป็น key ต่าง ๆ ของ data.json"""
    days: dict[str, Any] = {}
    platforms: set[str] = set()
    for item in plan.get("calendar", []):
        day = item.get("day")
        if not isinstance(day, int) or not 1 <= day <= 31:
            continue
        events = item.get("events") or []
        days[str(day)] = {"events": events, "script": item.get("script", "")}
        for e in events:
            # "REEL · IG+TT" -> {IG, TT}
            part = (e.get("k") or "").split("·")[-1]
            platforms.update(p.strip() for p in part.split("+") if p.strip())

    sections: dict[str, Any] = {
        "calendar": {
            "year": today.year,
            "month": today.month,
            "label": f"{THAI_MONTHS[today.month - 1]} {today.year} · Claude วางแผนให้แล้ว",
            "platforms": len(platforms) or 1,
            "days": days,
        },
        "hooks": {
            "total": len(plan.get("hooks", [])),
            "items": plan.get("hooks", []),
        },
        "trends": {
            "sourcesLabel": "ค้นเว็บสดเมื่อเช้านี้",
            "sourcesNote": "Claude ค้นเว็บเองทุกเช้า คัดเฉพาะเรื่องที่เอามาทำคอนเทนต์ได้ แล้วติด tag ให้",
            "badge": plan.get("trends", {}).get("badge", ""),
            "items": plan.get("trends", {}).get("items", []),
            "advice": plan.get("trends", {}).get("advice", ""),
        },
        "rivals": plan.get("rivals", {}),
    }
    return sections
