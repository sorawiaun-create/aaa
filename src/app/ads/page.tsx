import { Placeholder } from "@/components/Placeholder";

export default function AdsPage() {
  return (
    <Placeholder
      icon="🎬"
      title="Ads"
      subtitle="โฆษณารายชิ้น (ad) — ผลลัพธ์ + เปิด-ปิดรายตัว"
      status="partial"
      points={[
        "ตอนนี้ดูโฆษณาระดับ ad + เปิด-ปิดได้แล้วที่หน้า Dashboard",
        "หน้านี้จะรวมมุมมองรายชิ้นแบบละเอียด (creative, ครีเอเตอร์, ผลต่อชิ้น)",
        "กรอง/ค้นหา และจัดการหลายชิ้นพร้อมกัน (bulk)",
      ]}
    />
  );
}
