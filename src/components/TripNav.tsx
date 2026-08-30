"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Home, Trophy, BookOpen, Settings, Plane } from "lucide-react";
import { getStoredAccountId } from "@/lib/creatorAccount";

const TABS = [
  { path: "", label: "Acasă", icon: Home },
  { path: "/leaderboard", label: "Scor", icon: Trophy },
  { path: "/questions", label: "Întrebări", icon: BookOpen },
  { path: "/settings", label: "Setări", icon: Settings },
];

// Shared bottom tab bar for the hub pages -- keep this the single place
// that lists them.
export function TripNav({ slug }: { slug: string }) {
  const pathname = usePathname();

  // Only shown to whoever is logged into "Călătoriile mele" on this
  // device (app/trips/page.tsx) -- most participants just join a trip by
  // device id and never create that account, so this stays hidden for
  // them. Gated behind an effect (not read directly at render time) so
  // server and first client render agree -- localStorage doesn't exist
  // on the server.
  const [showTrips, setShowTrips] = useState(false);
  useEffect(() => {
    setShowTrips(Boolean(getStoredAccountId()));
  }, []);

  const tabs = [
    ...TABS.map((t) => ({ label: t.label, icon: t.icon, href: `/trip/${slug}${t.path}` })),
    ...(showTrips ? [{ label: "Călătorii", icon: Plane, href: "/trips" }] : []),
  ];

  return (
    <nav className="fixed inset-x-4 bottom-6 z-50 mx-auto flex max-w-md justify-center">
      <div className="flex h-16 w-full items-center gap-1 rounded-[24px] bg-white/85 px-2 shadow-[0_8px_40px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-xl">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-[18px] py-2 transition-colors duration-200 ${
                active ? "bg-accent text-primary" : "text-disabled"
              }`}
            >
              <Icon size={21} strokeWidth={1.75} />
              <span className="text-[10px] font-semibold">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
