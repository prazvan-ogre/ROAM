-- Product owner request: whoever creates a public trip should be able to
-- become its first participant automatically, right when they set up
-- (or log into) their "Călătoriile mele" account -- app/trips/page.tsx,
-- app/api/account/route.ts -- instead of separately joining later
-- through the onboarding wizard (app/trip/[slug]/page.tsx) with the same
-- name all over again.
--
-- That auto-join calls the existing client-side
-- getOrCreateAdultParticipant(tripId, displayName) (src/lib/
-- participant.ts), which needs a name. A brand-new account now collects
-- one (enforced in app/api/account/route.ts, only when creating an
-- account as part of linking a freshly-created trip -- the plain
-- /trips login flow is untouched and never requires one). Nullable at
-- the schema level so existing accounts (created before this migration)
-- aren't broken; those simply don't auto-join until they set a name.
alter table creator_accounts
  add column display_name text;
