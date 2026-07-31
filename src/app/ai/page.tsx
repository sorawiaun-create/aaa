import { Placeholder } from "@/components/Placeholder";

export default function AiPage() {
  return (
    <Placeholder
      icon="🤖"
      title="AI Analysis"
      subtitle="ให้ AI ช่วยวิเคราะห์ผลโฆษณา + แนะนำการปรับ"
      status="soon"
      points={[
        "สรุปว่าแคมเปญไหนกำลังปัง/แป้ก จาก GMV, ROAS, ออร์เดอร์",
        "แนะนำการปรับงบ/เป้า ROAS ต่อแคมเปญแบบอ่านง่าย",
        "ชี้จุดที่ควรหยุด/ขยาย พร้อมเหตุผล",
        "ทำงานร่วมกับ Automated Rules เพื่อลงมือให้อัตโนมัติ",
      ]}
    />
  );
}
