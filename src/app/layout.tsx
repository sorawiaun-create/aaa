import type { Metadata } from "next";
import "./globals.css";
import { NavBar } from "@/components/NavBar";

export const metadata: Metadata = {
  title: "TikTok Ads Automation",
  description: "Automatically enable and pause TikTok ads based on your rules.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>
        <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4">
          <NavBar />
          <main className="flex-1 py-6">{children}</main>
          <footer className="py-6 text-center text-xs text-neutral-600">
            TikTok Ads Automation · rule-based auto on/off
          </footer>
        </div>
      </body>
    </html>
  );
}
