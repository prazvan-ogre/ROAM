"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, UserRoundPlus, UsersRound } from "lucide-react";
import { setStoredActiveProfileId } from "@/lib/participant";
import { useTrip, useProfiles, useActiveProfile } from "@/lib/hooks";

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

  const { data: trip } = useTrip(slug);
  const tripId = trip?.id ?? null;
  const { data: profiles = [] } = useProfiles(tripId ?? undefined);
  const active = useActiveProfile(tripId ?? undefined, profiles);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");

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
  // wizard handles that case on Home) -- no profile exists yet. Also
  // narrows `active` for TS below: useActiveProfile only returns null
  // when profiles is empty, which this already ruled out.
  if (profiles.length === 0 || !active) return null;

  const hasChildProfile = profiles.some((p) => p.role === "child");

  function handleSwitchProfile(participantId: string) {
    if (!tripId) return;
    // setStoredActiveProfileId writes localStorage and broadcasts the
    // new id via SWR's global mutate() on the same key useActiveProfile
    // reads -- this component's own `active` above updates from that,
    // same as every other mounted consumer, so no local state to set
    // here.
    setStoredActiveProfileId(tripId, participantId);
    closeMenu();
  }

  function handleCreateAccount() {
    closeMenu();
    // name= skips the "Ai deja cont?" chooser on /trips straight to the
    // name+phone+PIN form, pre-filled with this profile's name -- we
    // already know who's asking, no need to ask twice.
    // Non-null: TS doesn't carry the `if (!active) return null` narrowing
    // above into this function declaration's closure, but this can only
    // ever run from a click on the already-rendered menu below, which
    // never renders without `active` being non-null.
    router.push(`/trips?link=${slug}&name=${encodeURIComponent(active!.display_name)}`);
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
