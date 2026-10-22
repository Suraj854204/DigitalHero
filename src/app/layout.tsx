import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Digital Heroes - turn every round into giving", template: "%s | Digital Heroes" },
  description: "A subscription that turns your scores into monthly prize draws and funds the charity you choose. Every rupee is shown, nothing is hidden.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
};
export const viewport: Viewport = { themeColor: "#f6f1e9", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
