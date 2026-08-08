# Live Studio — โคลน TikTok Live Studio (เปิดได้หลายช่องต่อเครื่อง)

โปรแกรมไลฟ์สตรีมมิ่งบนเดสก์ท็อป หน้าตา/การใช้งานเลียนแบบ **TikTok Live Studio**
แต่**ปลดล็อกข้อจำกัด "1 โปรแกรม 1 เครื่อง"** — เปิดหลายหน้าต่างเพื่อไลฟ์หลายช่องพร้อมกันได้บนเครื่องเดียว

สร้างด้วย **Electron + React + FFmpeg** ต่อ RTMP เข้า TikTok (หรือปลายทางอื่นที่รับ RTMP) ได้จริง

---

## ฟีเจอร์

- 🎬 **Scene / Sources แบบ OBS** — เพิ่มได้: กล้อง, จับหน้าจอ/หน้าต่าง, รูปภาพ, ข้อความ, ไมโครโฟน
- 🖼️ **Preview สด** — เห็นภาพที่จะออกไลฟ์จริง ๆ (canvas เดียวกับที่ push ออกไป)
- 🎚️ **มิกเซอร์เสียง** — ปิด/เปิดเสียง และปรับระดับเสียงแต่ละแหล่ง
- 🔴 **Go Live ด้วย RTMP** — ใส่ Server URL + Stream Key จาก TikTok LIVE แล้วกดเริ่มไลฟ์
- 🧩 **หลายช่องพร้อมกัน** — สลับแท็บช่อง หรือกด "หน้าต่างใหม่" เพื่อไลฟ์หลายช่องพร้อมกันบนเครื่องเดียว
- 💾 **จำการตั้งค่า** — เก็บ RTMP/คีย์/ความละเอียด/บิตเรตของแต่ละช่องไว้ใน localStorage
- ⚙️ **ปรับได้** — ความละเอียด (รวมแนวตั้ง 1080x1920 สำหรับมือถือ), FPS, บิตเรต

---

## สถาปัตยกรรม

```
Renderer (React)                    Main (Electron)
┌─────────────────────────┐         ┌────────────────────────────┐
│ Compositor (canvas)      │         │ StreamManager              │
│  กล้อง+จอ+รูป+ข้อความ     │         │  ├─ ffmpeg (ช่อง A) → RTMP  │
│  → canvas.captureStream  │         │  ├─ ffmpeg (ช่อง B) → RTMP  │
│ + Web Audio (มิกซ์เสียง)  │  chunk  │  └─ ...                     │
│ → MediaRecorder (webm)   │ ──IPC──▶│  อ่าน webm จาก stdin        │
└─────────────────────────┘         │  transcode → H.264/AAC/FLV  │
                                     └────────────────────────────┘
```

- **Compositor** (`src/renderer/src/lib/capture.js`) รวมทุกแหล่งวาดลง canvas + มิกซ์เสียงด้วย Web Audio
- **StreamPump** (`src/renderer/src/lib/recorder.js`) ใช้ `MediaRecorder` แปลง canvas เป็น webm chunk ส่งผ่าน IPC
- **StreamManager** (`src/main/streamer.js`) เปิด `ffmpeg` หนึ่งตัวต่อช่อง อ่าน webm จาก stdin แล้ว push RTMP
- แต่ละหน้าต่าง = ช่องอิสระ 1 ช่อง → เปิดหลายหน้าต่าง = ไลฟ์หลายช่องพร้อมกัน

---

## การติดตั้งและรัน

ต้องมี Node.js 18+ (โปรเจกต์นี้ทดสอบบน Node 22)

```bash
cd live-studio
npm install          # ดาวน์โหลด electron + ffmpeg-static ให้อัตโนมัติ
npm run dev          # เปิดโปรแกรมแบบ dev (hot reload)
```

สร้างไฟล์ติดตั้ง (.exe / .dmg / AppImage):

```bash
npm run dist:win     # Windows (NSIS installer)
npm run dist:mac     # macOS (dmg)
npm run dist         # ตาม OS ปัจจุบัน
```

---

## วิธีไลฟ์เข้า TikTok

1. เปิด **TikTok LIVE** (ต้องมีสิทธิ์ LIVE) แล้วเลือกไลฟ์ผ่าน **ซอฟต์แวร์สตรีมมิ่ง / OBS**
2. TikTok จะให้ **Server URL** (เช่น `rtmp://live.tiktok.com/live`) และ **Stream Key** มา
3. ในโปรแกรม กด **ตั้งค่า** → วาง Server URL และ Stream Key ของช่องนั้น
4. เพิ่มแหล่งภาพ (กล้อง/จอ/รูป/ข้อความ) แล้วกด **เริ่มไลฟ์**
5. ทำซ้ำกับช่องอื่นในอีกหน้าต่าง เพื่อไลฟ์พร้อมกันหลายช่อง

> หมายเหตุ: Server URL/Stream Key ต้องได้จาก TikTok ให้ถูกต้องตามบัญชีที่มีสิทธิ์ LIVE
> โปรแกรมนี้เป็นเครื่องมือ encode/push RTMP เท่านั้น ไม่ได้ bypass การยืนยันตัวตนหรือสิทธิ์ใด ๆ ของแพลตฟอร์ม

---

## แผนพัฒนาต่อ (Roadmap)

- ลาก/ย่อ-ขยาย source บน preview ด้วยเมาส์ (ตอนนี้จัด layout ผ่านโค้ด/เต็มจอ)
- ระบบ Scene หลายฉากพร้อมสลับ (transition)
- ดึงแชท/ของขวัญจาก TikTok LIVE มาแสดง (overlay)
- Virtual camera / บันทึกวิดีโอลงไฟล์ควบคู่การไลฟ์
- ตั้ง encoder ฮาร์ดแวร์ (NVENC/QuickSync) เพื่อลดภาระ CPU เวลาไลฟ์หลายช่อง

---

## โครงสร้างไฟล์

```
live-studio/
├─ electron.vite.config.js
├─ package.json
└─ src/
   ├─ main/
   │  ├─ index.js        # หน้าต่าง + IPC + อนุญาตจับหน้าจอ
   │  └─ streamer.js     # StreamManager: ffmpeg หลายช่อง → RTMP
   ├─ preload/
   │  └─ index.js        # bridge ปลอดภัย (window.studio)
   └─ renderer/
      ├─ index.html
      └─ src/
         ├─ App.jsx      # หน้าหลัก (layout แบบ TikTok Live Studio)
         ├─ styles.css
         ├─ components/  # Preview, SourceRow, ChannelSettings
         └─ lib/         # capture (compositor), recorder (pump), store
```
