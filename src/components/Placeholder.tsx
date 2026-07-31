export function Placeholder({
  icon,
  title,
  subtitle,
  status,
  points,
}: {
  icon: string;
  title: string;
  subtitle: string;
  status: "available" | "partial" | "soon";
  points: string[];
}) {
  const badge =
    status === "available"
      ? { text: "พร้อมใช้งาน", cls: "bg-emerald-500/15 text-emerald-400" }
      : status === "partial"
      ? { text: "ใช้ได้บางส่วน", cls: "bg-amber-500/15 text-amber-400" }
      : { text: "กำลังพัฒนา — เฟสถัดไป", cls: "bg-sky-500/15 text-sky-400" };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-neutral-900 text-2xl">
          {icon}
        </span>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{title}</h1>
            <span className={`badge ${badge.cls}`}>{badge.text}</span>
          </div>
          <p className="text-sm text-neutral-400">{subtitle}</p>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 text-sm font-medium text-neutral-300">
          สิ่งที่หน้านี้จะทำ
        </div>
        <ul className="space-y-2">
          {points.map((p, i) => (
            <li key={i} className="flex gap-2 text-sm text-neutral-300">
              <span className="text-brand">›</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>

      {status !== "available" && (
        <div className="card border-sky-900 bg-sky-950/20 text-sm text-sky-300">
          หน้านี้เป็นโครงที่วางไว้ตามแผน — เราจะไล่ทำให้ใช้งานได้จริงทีละสเต็ป
          บอกผมได้เลยว่าอยากเริ่มหน้าไหนก่อน
        </div>
      )}
    </div>
  );
}
