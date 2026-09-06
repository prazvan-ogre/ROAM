-- R4 correction (2026-09-06 batch, review round 2): replaces
-- 20260907100000_r4_feedback_participant_unique.sql's `unique (trip_id,
-- participant_id)` with the same client_request_id idempotency-key
-- pattern used for participants (20260907110000_r4_participant_client_
-- request_id.sql). That constraint was wrong and is dropped here rather
-- than kept alongside this one.
--
-- WHY IT WAS WRONG: its justification leaned on app/trip/[slug]/final/
-- page.tsx's `roam_feedback_submitted_${tripId}` localStorage flag as
-- evidence of "one feedback per participant, ever" being the intended
-- product rule. That's the wrong inference on inspection -- the flag is
-- keyed ONLY by trip id, per browser, and gates whether the form is
-- shown at all; it says nothing about which participant answers (the
-- form is always submitted as `profiles.find(p => p.role === 'adult')
-- ?? profiles[0]`, not whoever is actually answering), and multiple
-- participants can share a device. A per-device UI convenience is not a
-- server-enforceable per-participant business rule, and a real
-- unique(trip_id, participant_id) constraint is a genuine product
-- decision (does the product ever want to let someone redo the survey?)
-- that was never actually asked for or confirmed -- R4's actual
-- requirement was retry-safety (don't duplicate a lost-confirmation
-- resend), not "block every second submission forever".
--
-- FIX: client_request_id, exactly like addChildProfile -- the caller
-- generates one id per distinct submission attempt, kept stable across
-- a retry of that same attempt (see FeedbackForm's requestIdRef), reset
-- whenever an answer actually changes. This gives retry-safety without
-- asserting a new "once ever per participant" rule: two genuinely
-- separate submissions (different request ids) both succeed, and
-- whether that should ever be blocked at the product level is left
-- open, not decided here.
--
-- NULL participant_id (anonymous feedback) is unaffected either way --
-- untouched by both the dropped constraint (NULLs are never equal to
-- each other in a unique constraint) and this one (client_request_id is
-- independent of participant_id entirely). A retry of an anonymous
-- submission is now ALSO protected against duplication by the same
-- request id, which the dropped constraint could never do (it had
-- nothing to key an anonymous row on).
--
-- SAFE TO APPLY OVER EXISTING DATA, including any duplicates the
-- previous constraint already created: dropping a constraint never
-- fails, and adding a nullable column + a partial unique index (`where
-- client_request_id is not null`) can't conflict with rows that don't
-- have a value yet -- every pre-existing feedback row, exact duplicates
-- included, is left exactly as it is. This migration does not delete or
-- merge any row.
alter table feedback
  drop constraint if exists feedback_trip_participant_unique;

alter table feedback
  add column client_request_id uuid;

create unique index feedback_client_request_id_key
  on feedback (client_request_id)
  where client_request_id is not null;
