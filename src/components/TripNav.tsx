"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, BookOpen, Users } from "lucide-react";

const TABS = [
  { path: "", label: "Acasă", icon: Home },
  { path: "/questions", label: "Întrebări", icon: BookOpen },
  { path: "/users", label: "Utilizatori", icon: Users },
];

// Shared bottom tab bar for the 3 hub pages. More may be added later --
// keep this the single place that lists them (product owner's own
// framing: "momentan rămânem la cele 3").
export function TripNav({ slug }: { slug: string }) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-4 bottom-6 z-50 mx-auto flex max-w-md justify-center">
      <div className="flex h-16 w-full items-center gap-1 rounded-[24px] bg-white/85 px-2 shadow-[0_8px_40px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-xl">
        {TABS.map((tab) => {
          const href = `/trip/${slug}${tab.path}`;
          const active = pathname === href;
          const Icon = tab.icon;
          return (
            <Link
              key={href}
              href={href}
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
