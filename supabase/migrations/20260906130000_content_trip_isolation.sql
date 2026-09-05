-- R1 follow-up (2026-09-05 architecture/security review, batch 2): scopes
-- content reads to a trip's own members, closing the cross-tenant gap
-- documented in docs/DATABASE.md "Security model" point 11.
--
-- WHY: questions/answer_options/extras/explore_links SELECT policies
-- (20260825120000_profiles_and_content_model.sql, 20260825090000_
-- initial_schema.sql) only ever checked verified/published -- never
-- trip_id. That was never a gap while ROAM was one private pilot
-- (content was never meant to be secret between families on the *same*
-- trip); app/api/trips/create's public trip creation made it a real one,
-- since any published trip's Discover/Extras content became readable by
-- any *other* trip's participants, or anyone with the anon key. Initially
-- deferred (kept cross-readable, accepted risk) because Kassandra 2026's
-- pilot was still live and a naive is_trip_member(trip_id) gate would
-- have locked out its legacy (pre-R1, no auth_user_id) participants the
-- moment the trip picked up even one newly-authenticated member --
-- product-owner call now that the pilot has ended: ship the isolation.
--
-- HOW: reuse is_trip_member(trip_id) from 20260906090000_auth_ownership.sql
-- -- the same "caller has an authenticated participants row on this trip"
-- check already used for participants/responses/battle_scores. Verified
-- safe against every current content-reading call site (src/lib/discover.ts,
-- battle.ts, history.ts, and every app/trip/[slug]/**/page.tsx): each one
-- only fetches content after profiles.length > 0 (a participant already
-- exists, and thus already has an auth_user_id -- see getOrCreateAdultParticipant
-- in src/lib/participant.ts), so there is no live "read content before
-- joining" flow to preserve.
--
-- ACCEPTED, KNOWN GAP (same posture as R1 itself): a trip with only
-- legacy (auth_user_id is null) participants -- Kassandra included, for
-- anyone who joined before the R1 deploy and never re-joined afterward --
-- has no member who passes is_trip_member, so nobody can read that trip's
-- content via the anon key anymore, including its own former
-- participants revisiting a recap page. This is the same "grandfather
-- pre-R1 identity, no retroactive claim via device_id" tradeoff R1 made
-- for participants/responses/battle_scores, now extended to content --
-- backfilling auth_user_id onto existing legacy rows is a separate,
-- bigger identity decision (flagged, not made, in R1's own header) and
-- out of scope here.
--
-- NOT COVERED: `battles` (title/day_number/is_final) stays `using (true)`
-- -- lower sensitivity (no question/answer content), not in this batch's
-- reported scope, left for a follow-up if wanted.

drop policy if exists "published and verified questions are publicly readable" on questions;
create policy "trip members can read published questions" on questions
  for select using (verified and published and is_trip_member(trip_id));

drop policy if exists "options for published questions are publicly readable" on answer_options;
create policy "trip members can read options for published questions" on answer_options
  for select using (
    exists (
      select 1 from questions q
      where q.id = answer_options.question_id
        and q.verified and q.published
        and is_trip_member(q.trip_id)
    )
  );

drop policy if exists "published and verified extras are publicly readable" on extras;
create policy "trip members can read published extras" on extras
  for select using (verified and published and is_trip_member(trip_id));

-- explore_links has no verified/published of its own (same as before this
-- migration) -- only the trip_id scope is added here.
drop policy if exists "explore_links are publicly readable" on explore_links;
create policy "trip members can read explore links" on explore_links
  for select using (is_trip_member(trip_id));
