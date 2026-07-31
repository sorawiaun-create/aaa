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
        <div className="flex min-h-screen">
          <NavBar />
          <main className="flex-1 overflow-x-hidden px-6 py-6">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
