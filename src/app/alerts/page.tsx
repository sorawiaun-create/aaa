import { Placeholder } from "@/components/Placeholder";

export default function AlertsPage() {
  return (
    <Placeholder
      icon="🔔"
      title="Alerts"
      subtitle="แจ้งเตือนเมื่อผลโฆษณาถึงเงื่อนไข (เช่น ROAS ตก)"
      status="soon"
      points={[
        "ตั้งเงื่อนไขแจ้งเตือน เช่น GMV Max ROAS < เป้า, งบใช้เกิน",
        "ส่งเข้า LINE Notify / อีเมล",
        "เหมาะกับ LIVE GMV Max ที่ปิดผ่าน API ไม่ได้ — เตือนให้ไปปิดเองใน Seller Center",
        "สรุปผลรายวันส่งอัตโนมัติ",
      ]}
    />
  );
}
