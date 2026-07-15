# TikTok Ads Automation

เว็บแอปสำหรับควบคุมโฆษณา TikTok แบบอัตโนมัติ — **เปิด / ปิดโฆษณาตามเงื่อนไข (rules) ที่ตั้งไว้** เชื่อมต่อ TikTok Marketing API v1.3 จริง

## ฟีเจอร์

- **Dashboard** — ดูสถิติโฆษณา (Spend, ROAS, CPA, Conversions, CTR) แบบตาราง + กราฟ เลือกช่วงเวลาได้
- **Automation Rules** — ตั้งเงื่อนไขหลายชั้น (AND) ให้ระบบ **ปิด (DISABLE)** หรือ **เปิด (ENABLE)** โฆษณาอัตโนมัติ
  - ตัวอย่าง: `ROAS < 1` และ `Spend > 500` → ปิดโฆษณา
- **Scheduler** — ตัวจับเวลา (node-cron) รันประเมิน rules อัตโนมัติทุก N นาที (ตั้งค่าได้)
- **Manual toggle** — เปิด/ปิดโฆษณาเองจาก Dashboard
- **Logs** — บันทึกทุกการกระทำ (อัตโนมัติ + manual) พร้อมเหตุผล

## Tech stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Recharts · node-cron
เก็บข้อมูล rules/logs/settings เป็นไฟล์ JSON ใน `./data` (สลับไปใช้ DB จริงได้ง่าย)

## เริ่มใช้งาน

```bash
npm install
cp .env.example .env        # (ไม่บังคับ) ใส่ credentials ที่นี่ หรือกรอกในหน้า Settings
npm run dev                 # dev: http://localhost:3000
# production:
npm run build && npm start
```

> Scheduler ทำงานในโปรเซส Node ตัวเดียว จึงควรรันแบบ long-running (`npm start` บน VPS/เซิร์ฟเวอร์)
> ไม่เหมาะกับ serverless ที่ปิดโปรเซสเมื่อไม่มี request

## การตั้งค่า TikTok API

1. สมัคร Developer app ที่ https://ads.tiktok.com/marketing_api/
2. รับ **App ID** และ **App Secret**
3. ทำ OAuth เพื่อรับ **Access Token** (ต้องมี scope จัดการโฆษณา)
4. คัดลอก **Advertiser ID** จาก TikTok Ads Manager
5. กรอกค่าทั้งหมดในหน้า **Settings** แล้วกด "ทดสอบการเชื่อมต่อ"

## โครงสร้าง

```
src/
  app/
    page.tsx              Dashboard
    rules/page.tsx        จัดการ automation rules
    logs/page.tsx         ประวัติการทำงาน
    settings/page.tsx     ตั้งค่า API + scheduler
    api/                  route handlers (ads, rules, logs, settings, scheduler)
  lib/
    tiktok.ts             TikTok Marketing API client
    rules-engine.ts       ตรรกะประเมินเงื่อนไข + สั่งเปิด/ปิด
    scheduler.ts          node-cron
    db.ts                 JSON file store
    types.ts / labels.ts / validate.ts
  components/NavBar.tsx
instrumentation.ts        boot scheduler ตอนเซิร์ฟเวอร์เริ่ม
```

## API ที่ใช้ (TikTok Marketing API v1.3)

| งาน | Endpoint |
|-----|----------|
| รายการโฆษณา | `GET /ad/get/` |
| รายงานสถิติ | `GET /report/integrated/get/` (data_level `AUCTION_AD`) |
| เปิด/ปิดโฆษณา | `POST /ad/status/update/` |
| ตรวจสอบ credentials | `GET /advertiser/info/` |

## หมายเหตุ

- เวอร์ชันนี้โฟกัสที่ระดับ **โฆษณา (ad)** — ระดับ adgroup/campaign เตรียม type ไว้แล้ว ต่อยอดได้
- "ขึ้นโฆษณาใหม่ / สร้าง ad" (creation) และการปรับงบ (scaling) เป็นงานถัดไป — โครงสร้าง client รองรับการเพิ่ม endpoint ได้
- credentials ถูกเก็บใน `./data/settings.json` (อยู่ใน `.gitignore`) — ควรจำกัดสิทธิ์เข้าถึงเซิร์ฟเวอร์
