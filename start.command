#!/bin/bash
# Double-click this file on macOS to run the TikTok Ads Automation tool.
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "──────────────────────────────────────────────"
  echo " ไม่พบ Node.js"
  echo " กรุณาติดตั้งก่อนที่ https://nodejs.org (เลือกปุ่ม LTS)"
  echo "──────────────────────────────────────────────"
  read -p "กด Enter เพื่อปิด"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "กำลังติดตั้งส่วนประกอบครั้งแรก (อาจใช้เวลา 2-3 นาที)..."
  npm install || { read -p "ติดตั้งไม่สำเร็จ กด Enter เพื่อปิด"; exit 1; }
fi

echo "กำลังเตรียมระบบ..."
npm run build || { read -p "build ไม่สำเร็จ กด Enter เพื่อปิด"; exit 1; }

echo ""
echo "──────────────────────────────────────────────"
echo " ระบบพร้อมแล้ว! เปิดเบราว์เซอร์ไปที่:"
echo "    http://localhost:3000"
echo " (ปิดหน้าต่างนี้ = หยุดระบบ)"
echo "──────────────────────────────────────────────"
echo ""
npm start
