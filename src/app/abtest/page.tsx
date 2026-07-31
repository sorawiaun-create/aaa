import { Placeholder } from "@/components/Placeholder";

export default function AbTestPage() {
  return (
    <Placeholder
      icon="🧪"
      title="A/B Testing"
      subtitle="ทดสอบเปรียบเทียบครีเอทีฟ / งบ / กลุ่มเป้าหมาย"
      status="soon"
      points={[
        "สร้างการทดสอบ A/B (split test) ผ่าน API (/campaign/ab_test/)",
        "เปรียบเทียบผล 2 ชุด แบบเห็นตัวเลขชัด",
        "ประกาศผู้ชนะอัตโนมัติตามเกณฑ์ที่ตั้ง",
      ]}
    />
  );
}
