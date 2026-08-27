import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ROAM",
  description: "ROAM — interactive trip companion",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ROAM",
  },
  // The app's content is entirely in Romanian (see `lang` below), but
  // Chrome's auto-translate feature would still occasionally offer to
  // translate it -- and when it does, its DOM rewriting collides with
  // React's own DOM updates, throwing "NotFoundError: The object can not
  // be found here" (a well-known React/Chrome-Translate incompatibility)
  // right in the middle of a normal interaction, like the onboarding
  // wizard's name -> role step. This tells Chrome not to offer at all.
  other: { google: "notranslate" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#F7F7F5",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ro" translate="no" className="notranslate">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
