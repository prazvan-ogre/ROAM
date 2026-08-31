"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, UserRoundPlus, UsersRound } from "lucide-react";
import { getTripBySlug } from "@/lib/trip";
import {
  listProfilesForDevice,
  getStoredActiveProfileId,
  setStoredActiveProfileId,
  type Participant,
} from "@/lib/participant";

type View = "menu" | "switch";

// Global, top-right profile control for every trip-scoped screen --
// mounted once in app/trip/[slug]/layout.tsx instead of being
// reimplemented per page. Supersedes the old ActiveProfileSwitcher that
// used to live only on the Home page's own header row.
//
// "Avatar" here is the same initials-circle Home always used -- the
// participants table has no photo/avatar field (no upload feature
// exists anywhere in the app), so that circle *is* this app's avatar,
// not a placeholder for a future one.
export function ProfileMenu({ slug }: { slug: string }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const [tripId, setTripId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Participant[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");

  const load = useCallback(async () => {
    const trip = await getTripBySlug(slug);
    if (!trip) return;
    setTripId(trip.id);
    const list = await listProfilesForDevice(trip.id);
    setProfiles(list);
    if (list.length > 0) {
      const stored = getStoredActiveProfileId(trip.id);
      setActiveId((list.find((p) => p.id === stored) ?? list[0]).id);
    }
  }, [slug]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setView("menu");
  }, []);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) closeMenu();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open, closeMenu]);

  // Nothing to show before this device has joined the trip (onboarding
  // wizard handles that case on Home) -- no profile exists yet.
  if (profiles.length === 0) return null;

  const active = profiles.find((p) => p.id === activeId) ?? profiles[0];
  const hasChildProfile = profiles.some((p) => p.role === "child");

  function handleSwitchProfile(participantId: string) {
    if (!tripId) return;
    setStoredActiveProfileId(tripId, participantId);
    setActiveId(participantId);
    closeMenu();
  }

  function handleCreateAccount() {
    closeMenu();
    router.push(`/trips?link=${slug}`);
  }

  return (
    // Constrained to the same centered max-w-md column as TripNav (not
    // the raw viewport edge), so it lines up with page content instead
    // of floating off to the side on a wide/desktop viewport.
    <div className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-md justify-end">
      <div ref={containerRef} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Profil"
          aria-expanded={open}
          className="flex items-center gap-2 rounded-full border border-border bg-card/90 py-1.5 pl-1.5 pr-1.5 shadow-[0_2px_12px_rgba(0,0,0,0.08)] backdrop-blur-xl transition-transform active:scale-[0.97] sm:pr-3"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground">
            {active.display_name.charAt(0).toUpperCase()}
          </span>
          <span className="hidden max-w-[100px] truncate text-[13px] font-medium text-foreground sm:inline">
            {active.display_name}
          </span>
        </button>

        {open && (
          <div className="absolute right-0 top-[calc(100%+8px)] w-56 overflow-hidden rounded-2xl border border-border bg-card py-1 shadow-[0_8px_30px_rgba(0,0,0,0.14)]">
            {view === "menu" ? (
              <>
                {hasChildProfile && (
                  <button
                    onClick={() => setView("switch")}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-[14px] font-medium text-foreground transition-colors hover:bg-secondary active:bg-secondary"
                  >
                    <UsersRound size={17} className="shrink-0 text-muted-foreground" />
                    Schimbă profilul
                  </button>
                )}
                <button
                  onClick={handleCreateAccount}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-[14px] font-medium text-foreground transition-colors hover:bg-secondary active:bg-secondary"
                >
                  <UserRoundPlus size={17} className="shrink-0 text-muted-foreground" />
                  Creează cont
                </button>
              </>
            ) : (
              profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSwitchProfile(p.id)}
                  className={`flex w-full items-center justify-between px-4 py-3 text-left text-[14px] transition-colors hover:bg-secondary active:bg-secondary ${
                    p.id === active.id ? "font-semibold text-primary" : "text-foreground"
                  }`}
                >
                  <span className="truncate">{p.display_name}</span>
                  {p.id === active.id && <Check size={14} className="shrink-0" />}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
