import { Placeholder } from "@/components/Placeholder";

export default function AdGroupsPage() {
  return (
    <Placeholder
      icon="🗂️"
      title="Ad Groups"
      subtitle="จัดการกลุ่มโฆษณา (adgroup) — งบ, การกำหนดเป้าหมาย, เปิด-ปิด"
      status="soon"
      points={[
        "ดึงรายการ ad group ทั้งหมดของแคมเปญ (/adgroup/get/)",
        "แสดงงบ, สถานะ, และผลลัพธ์ต่อกลุ่ม",
        "เปิด-ปิด ad group และปรับงบได้ (ระดับ adgroup ปกติทำได้ผ่าน API)",
        "ตั้ง rule อัตโนมัติระดับ ad group",
      ]}
    />
  );
}
