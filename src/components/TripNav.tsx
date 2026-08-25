"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { path: "", label: "Dashboard" },
  { path: "/questions", label: "Întrebări" },
  { path: "/users", label: "Utilizatori" },
];

// Shared bottom tab bar for the 3 hub pages. More may be added later --
// keep this the single place that lists them (product owner's own
// framing: "momentan rămânem la cele 3").
export function TripNav({ slug }: { slug: string }) {
  const pathname = usePathname();

  return (
    <nav className="mt-auto flex border-t border-slate-200 pt-3">
      {TABS.map((tab) => {
        const href = `/trip/${slug}${tab.path}`;
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 py-2 text-center text-sm font-medium ${
              active ? "text-slate-900" : "text-slate-400"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
