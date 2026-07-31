# Facebook Ads Automation — ตัวรันกฎอัตโนมัติหลายบัญชี

สคริปต์ Python ที่อ่าน "กฎ" (rules) ของแต่ละบัญชีโฆษณา แล้วทำงานให้อัตโนมัติ:

1. ดึงสถิติแคมเปญ **ของวันนี้** จาก Facebook Marketing API (spend / ROAS / ซื้อ / ทัก ฯลฯ)
2. ประเมินเงื่อนไขของทุกกฎ
3. สั่งงานตามผล: **ปิด (PAUSE) · เปิด (ACTIVATE) · เพิ่มงบ · รีเซ็ตงบ**

ออกแบบให้รัน **ทุก N นาทีบน GitHub Actions** (ฟรี ไม่ต้องเปิดคอมทิ้งไว้) หรือจะรันบนเครื่อง/VPS เองก็ได้

> พัฒนาต่อจากไฟล์ config ที่ส่งออกมาจากหน้าเว็บสร้างกฎ — โครงสร้าง `rules`/`conditions` เดิมใช้ได้ทันที

---

## ⚠️ เรื่องความปลอดภัย (อ่านก่อน)

- **อย่าใส่ access token ลงในโค้ดหรือ commit ขึ้น Git** — โปรเจกต์นี้ตัด token ออกจาก `config.json` แล้ว
  (แทนด้วย `"token": "env:FB_ACCESS_TOKEN"` = ให้ไปอ่านจาก environment / GitHub Secret)
- token ที่เคยแปะไว้ในไฟล์ Gemini เดิม **ถือว่ารั่วแล้ว** — ควรไป **สร้าง/รีเซ็ต token ใหม่**
  ที่ [Business Settings → System Users](https://business.facebook.com/settings/system-users)
  แล้วเก็บเป็น Secret เท่านั้น
- แนะนำใช้ **System User token** (อายุยาว) สิทธิ์ `ads_management`, `ads_read`

---

## ตั้งค่าให้รันบน GitHub Actions (แนะนำ)

1. **ใส่ Secret**: ไปที่ repo → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `FB_ACCESS_TOKEN`
   - Value: token จริงของคุณ
2. Workflow อยู่ที่ [`.github/workflows/facebook-ads-automation.yml`](../.github/workflows/facebook-ads-automation.yml)
   ตั้งไว้รัน **ทุก 10 นาที** (แก้ `cron` ได้ ต่ำสุดที่ GitHub รองรับคือ 5 นาที)
3. ทดสอบก่อนของจริง: แท็บ **Actions → Facebook Ads Automation → Run workflow** แล้วติ๊ก **dry_run = true**
   → จะแสดง log ว่ากฎไหนจะทำงานบ้าง **โดยไม่แก้ไขจริง**
4. พอมั่นใจแล้วปล่อยให้รันตามตารางเวลาได้เลย

> **state (จำเวลาเพิ่มงบ):** GitHub Actions ไม่มีดิสก์ถาวร โปรเจกต์จึงเก็บ `state.json` ผ่าน
> **actions/cache** อัตโนมัติ (ใช้จำกัดความถี่ `frequencyMins` ของการเพิ่มงบข้ามรอบ)

---

## รันบนเครื่อง/VPS เอง

```bash
cd facebook-ads-automation
pip install -r requirements.txt

cp .env.example .env          # ใส่ FB_ACCESS_TOKEN ในไฟล์ .env
export $(grep -v '^#' .env | xargs)   # โหลด env (หรือ set เอง)

python main.py --dry-run      # ลองก่อน (ไม่แก้จริง)
python main.py                # รัน 1 รอบจริง
python main.py --loop --interval 10   # วนทุก 10 นาที
```

รันซ้ำอัตโนมัติด้วย cron ของเครื่อง (ตัวอย่าง ทุก 10 นาที):

```cron
*/10 * * * * cd /path/to/facebook-ads-automation && FB_ACCESS_TOKEN=xxx /usr/bin/python3 main.py >> run.log 2>&1
```

---

## รูปแบบ config (`config.json`)

```jsonc
{
  "settings": {
    "timezone": "Asia/Bangkok",     // ใช้คำนวณ time_of_day
    "dry_run": false,
    "campaign_name_filter": null     // regex กรองชื่อแคมเปญ (null = ทุกแคมเปญ)
  },
  "accounts": [
    {
      "name": "ชื่อบัญชี",
      "token": "env:FB_ACCESS_TOKEN", // หรือ "env:ชื่อ_ENV_อื่น" ถ้าแต่ละบัญชีคนละ token
      "account_id": "258579337038986",
      "target_level": "campaign",
      "metrics": {                    // (ไม่บังคับ) ปรับ mapping metric ต่อบัญชี
        "purchase_action_types": ["omni_purchase", "purchase"],
        "result_action_types": ["onsite_conversion.messaging_conversation_started_7d"]
      },
      "rules": [ /* ... */ ]
    }
  ]
}
```

### กฎ (rule) และเงื่อนไข (condition)

```jsonc
{
  "name": "จ่าย 50 ไม่ทัก ปิด",
  "action": "PAUSE",
  "conditions": [
    { "metric": "spend",   "operator": ">", "value": 50 },
    { "metric": "results", "operator": "<", "value": 1 }
  ]
}
```

- **ทุกเงื่อนไขในกฎต้องเป็นจริงพร้อมกัน (AND)** กฎถึงจะทำงาน
- ถ้าหลายกฎเปลี่ยน "สถานะ" ตรงกันในรอบเดียว → **กฎท้ายสุดในลิสต์ชนะ**

### action ที่รองรับ

| action | params | ทำอะไร |
|---|---|---|
| `PAUSE` | — | ปิดแคมเปญ |
| `ACTIVATE` | — | เปิดแคมเปญ |
| `RESET_BUDGET` | `resetAmount` | ตั้งงบรายวันเป็นค่านี้ (บาท) |
| `INCREASE_BUDGET` | `percent`, `maxBudget?`, `frequencyMins?` | เพิ่มงบเป็น % (มีเพดาน/จำกัดความถี่ได้) |
| `DECREASE_BUDGET` | `percent`, `minBudget?`, `frequencyMins?` | ลดงบเป็น % (มีขั้นต่ำได้) *(เพิ่มให้เผื่อใช้)* |

- `frequencyMins`: เพิ่ม/ลดงบซ้ำได้ไม่เกิน 1 ครั้งต่อ N นาที (null/0 = ไม่จำกัด)
- งบทั้งหมดเป็น **บาท** สคริปต์แปลงเป็นหน่วยของ API ให้เอง (ตามสกุลเงินบัญชี)

### metric ที่ใช้ได้

| metric | ความหมาย |
|---|---|
| `time_of_day` | เวลาปัจจุบันเป็นชั่วโมงทศนิยม เช่น 22:30 = `22.5` (ตาม timezone ใน settings) |
| `spend` | ยอดใช้จ่ายวันนี้ (บาท) |
| `purchases` | จำนวนการซื้อ (จาก `purchase_action_types`) |
| `results` | จำนวน "ผลลัพธ์" เช่นทักแชต (จาก `result_action_types`) |
| `roas` | ROAS จากการซื้อ |
| `cost_per_purchase` | ต้นทุนต่อการซื้อ = spend / purchases (ไม่มีซื้อ = อนันต์) |
| `cost_per_result` | ต้นทุนต่อผลลัพธ์ = spend / results (ไม่มีผล = อนันต์) |
| `impressions`, `clicks`, `reach`, `frequency`, `ctr`, `cpc`, `cpm` | สถิติพื้นฐานเพิ่มเติม |

> **สำคัญ — `results` คืออะไร?** ค่าเริ่มต้นถือว่า results = **"ทักแชต"**
> (`onsite_conversion.messaging_conversation_started_7d`)
> ถ้าบัญชีไหนวัดผลเป็นอย่างอื่น (เช่นยอดวิว/ลงทะเบียน) ให้ตั้ง `result_action_types` ใน `metrics` ของบัญชีนั้น

### งบระดับแคมเปญ (CBO) vs. ระดับ ad set (ABO)

- ถ้าแคมเปญตั้งงบไว้ที่ **แคมเปญ (CBO)** → ปรับที่แคมเปญ
- ถ้าตั้งงบไว้ที่ **ad set (ABO)** → สคริปต์จะไล่ปรับ **ทุก ad set** ที่มีงบรายวันใต้แคมเปญนั้น

---

## โครงสร้างโค้ด

```
facebook-ads-automation/
  main.py                 # จุดเริ่ม / วนทุกบัญชี-แคมเปญ
  config.json             # บัญชี + กฎ (ไม่มี token)
  requirements.txt
  .env.example
  fb_automation/
    config.py             # โหลด/ตรวจ config + resolve token จาก env
    fb_client.py          # ห่อ facebook_business SDK (network อยู่ที่นี่ที่เดียว)
    metrics.py            # แปลง insight -> ค่า metric (pure, เทสได้)
    rules.py              # ประเมินเงื่อนไข -> แผนงาน (pure, เทสได้)
    actions.py            # ลงมือทำ (หรือ dry-run) + จัดการงบ/สถานะ
    state.py              # จำเวลาเพิ่มงบข้ามรอบ (frequencyMins)
    logging_setup.py
  tests/test_rules.py     # unit tests ตรรกะหลัก
```

## รันเทส

```bash
cd facebook-ads-automation
python -m unittest tests.test_rules -v
```

(เทสตรรกะล้วน ไม่ต้องต่อเน็ต/ไม่ต้องมี token)
