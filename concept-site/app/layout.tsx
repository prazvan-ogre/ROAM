import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Worth — Build what matters",
  description:
    "It’s easy to build anything today. Worth helps teams decide what is worth building, track the real cost of AI initiatives, and measure whether they deliver value.",
  openGraph: {
    title: "Worth — Build what matters",
    description: "Decide what is worth building. Track what it costs. Measure what it delivers.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#FAFAF7",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
