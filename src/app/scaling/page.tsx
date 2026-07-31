import { Placeholder } from "@/components/Placeholder";

export default function ScalingPage() {
  return (
    <Placeholder
      icon="📈"
      title="Scaling Tools"
      subtitle="ขยายตัวปัง / หรี่ตัวแป้ก อัตโนมัติด้วยการปรับงบ"
      status="soon"
      points={[
        "เพิ่มงบแคมเปญที่ ROAS ดีอัตโนมัติ (เช่น ROAS > เป้า → +20%)",
        "ลดงบแคมเปญที่ ROAS ต่ำ",
        "ใช้ได้กับทั้งแคมเปญปกติและ GMV Max (ปรับงบ/เป้า ROAS)",
        "ตั้งเพดานงบสูงสุด/ต่ำสุด กันพลาด",
      ]}
    />
  );
}
