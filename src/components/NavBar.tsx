"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/campaigns", label: "Campaigns", icon: "📣" },
  { href: "/adgroups", label: "Ad Groups", icon: "🗂️" },
  { href: "/ads", label: "Ads", icon: "🎬" },
  { href: "/gmvmax", label: "GMV Max+", icon: "🚀" },
  { href: "/ai", label: "AI Analysis", icon: "🤖" },
  { href: "/abtest", label: "A/B Testing", icon: "🧪" },
  { href: "/scaling", label: "Scaling Tools", icon: "📈" },
  { href: "/rules", label: "Automated Rules", icon: "⚙️" },
  { href: "/alerts", label: "Alerts", icon: "🔔" },
  { href: "/logs", label: "Logs", icon: "🧾" },
  { href: "/settings", label: "Settings", icon: "🔧" },
];

export function NavBar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950/60">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand to-[#c9224a] text-sm font-bold text-white">
          T
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold">TikTok Ads</div>
          <div className="text-[11px] text-neutral-500">Automation</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2">
        {LINKS.map((l) => {
          const active =
            l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
              }`}
            >
              <span className="text-base">{l.icon}</span>
              <span>{l.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 text-[11px] text-neutral-600">
        rule-based auto on/off
      </div>
    </aside>
  );
}
