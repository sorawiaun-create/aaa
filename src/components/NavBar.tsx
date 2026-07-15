"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/rules", label: "Automation Rules" },
  { href: "/logs", label: "Logs" },
  { href: "/settings", label: "Settings" },
];

export function NavBar() {
  const pathname = usePathname();
  return (
    <header className="flex items-center justify-between gap-4 border-b border-neutral-800 py-4">
      <Link href="/" className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm font-bold text-white">
          T
        </span>
        <span className="text-sm font-semibold">TikTok Ads Automation</span>
      </Link>
      <nav className="flex items-center gap-1">
        {LINKS.map((l) => {
          const active =
            l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
