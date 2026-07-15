# FB Ads Studio

เว็บแอปสำหรับ **วิเคราะห์โฆษณา Facebook**, **ทำสื่อ/แคปชั่นอัตโนมัติ** และ **ร่าง/โพสต์โฆษณา** ในที่เดียว
สร้างด้วย Vite + React + Tailwind + Recharts (ทำงานฝั่งเบราว์เซอร์ทั้งหมด ข้อมูลไม่ถูกส่งขึ้นเซิร์ฟเวอร์)

## ฟีเจอร์

### 1. วิเคราะห์ Ads (`วิเคราะห์ Ads`)
- อัปโหลดไฟล์ CSV ที่ export จาก **Facebook Ads Manager → Reports → Export**
- ตรวจจับคอลัมน์อัตโนมัติ (รองรับหัวตารางไทย/อังกฤษ และหลายสกุลเงิน)
- คำนวณ KPI: `Spend, ROAS, CTR, CPC, CPM, CPA, Frequency`
- กราฟแนวโน้มรายวัน (งบ vs รายได้, CTR vs CPC)
- สรุปแยกตามแคมเปญ + คำแนะนำเชิงกลยุทธ์อัตโนมัติ
- ไม่มีข้อมูลจริง? กด **"ลองด้วยข้อมูลตัวอย่าง"** ได้ทันที

### 2. ทำสื่อ (`ทำสื่อ`)
- สร้างแคปชั่นโฆษณา 3 แบบจากชื่อสินค้า/จุดเด่น/กลุ่มเป้าหมาย/โทน
- แนะนำ hashtag อัตโนมัติ
- สร้างภาพโฆษณาขนาด 1080×1080 (พาดหัว + ข้อความ + ปุ่ม CTA) ดาวน์โหลดเป็น PNG
- ส่งแคปชั่นไปหน้า "ขึ้น Ads / โพสต์" ได้ทันที

### 3. ขึ้น Ads / โพสต์ (`ขึ้น Ads / โพสต์`)
- เขียนโพสต์ ตั้งเวลา และเก็บฉบับร่าง (เก็บใน localStorage)
- **โหมดทดสอบ (ค่าเริ่มต้น):** บันทึกโพสต์โดยไม่ยิง API จริง ปลอดภัย
- **โหมดจริง (Live):** เชื่อม Meta Graph API เพื่อโพสต์ลงเพจจริง

## การรัน

```bash
npm install
npm run dev      # เปิด http://localhost:5173
npm run build    # สร้างไฟล์ production ในโฟลเดอร์ dist/
```

## การเชื่อมต่อ Facebook แบบจริง (ขั้นสูง)

การโพสต์จริงและการยิงโฆษณาที่มีค่าใช้จ่ายต้องใช้ **Meta Graph / Marketing API**:

1. สร้างแอปที่ [developers.facebook.com](https://developers.facebook.com)
2. เพิ่ม **Facebook Login** และ **Marketing API**
3. ขอสิทธิ์ `pages_manage_posts`, `pages_read_engagement` ผ่าน Graph API Explorer
4. แลกเป็น **Long-lived Page Access Token**
5. ใส่ Page ID + Token ในหน้า "ขึ้น Ads / โพสต์" แล้วเปิดโหมด Live

> ⚠️ **ข้อควรระวัง**
> - โหมด Live โพสต์ลงเพจจริงทันที ตรวจข้อความให้ดีก่อนกด
> - เก็บ token ในเบราว์เซอร์เหมาะกับใช้งานส่วนตัวเท่านั้น ระบบใช้งานหลายคนควรทำ OAuth ฝั่งเซิร์ฟเวอร์
> - การรันโฆษณาที่มีค่าใช้จ่ายจริงต้องผ่าน **App Review** ของ Meta

## โครงสร้าง

```
src/
  App.jsx                 # โครง + แท็บนำทาง
  lib/
    csv.js                # อ่าน & ตรวจจับคอลัมน์ CSV ของ Facebook Ads
    metrics.js            # คำนวณ KPI, จัดกลุ่ม, สร้าง insight
    creative.js           # เจนแคปชั่น/hashtag (ออฟไลน์) + จุดเสียบ AI
    sample.js             # ข้อมูลตัวอย่าง
  components/
    AnalyzeTab.jsx        # หน้าวิเคราะห์
    CreativeTab.jsx       # หน้าทำสื่อ + สร้างภาพ (canvas)
    PublishTab.jsx        # หน้าโพสต์ + เชื่อม Graph API
    ui.jsx                # การ์ด/แบดจ์/ฟอร์มที่ใช้ร่วมกัน
```

`reference-expenses-tracker.jsx` คือเครื่องมือเดิม (วิเคราะห์ค่าใช้จ่าย Shopee/TikTok จาก PDF) เก็บไว้อ้างอิง
