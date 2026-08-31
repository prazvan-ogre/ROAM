-- Enables Postgres logical replication for `responses` and
-- `battle_scores` on the `supabase_realtime` publication that every
-- Supabase project creates by default. Without this, the client-side
-- `.channel(...).on("postgres_changes", ...)` subscriptions added in
-- app/trip/[slug]/questions/page.tsx and app/trip/[slug]/leaderboard/
-- page.tsx (replacing their 30-second poll) would just sit there and
-- never receive an event -- Realtime only broadcasts changes for tables
-- explicitly added to this publication.
--
-- Both tables already have a public "is readable" select policy
-- (20260825120000_profiles_and_content_model.sql,
-- 20260825140000_feedback_form.sql), which Realtime's authorization
-- also relies on: a client only receives postgres_changes events for
-- rows its RLS policies would let it select anyway.

alter publication supabase_realtime add table responses;
alter publication supabase_realtime add table battle_scores;
