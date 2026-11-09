import type { Metadata, Viewport } from "next";
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/newsreader";
import "./globals.css";
import { TabBar } from "@/components/TabBar";

export const metadata: Metadata = {
  title: "FINN",
  description: "What changed in your portfolio, and whether it matters.",
  appleWebApp: { capable: true, title: "FINN", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#f2f3ef",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh antialiased">
        <div className="mx-auto max-w-[520px] px-4 pb-28 pt-[max(env(safe-area-inset-top),12px)]">{children}</div>
        <TabBar />
      </body>
    </html>
  );
}
