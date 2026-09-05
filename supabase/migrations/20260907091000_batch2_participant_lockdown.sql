-- Batch 2 (2026-09-05 review, R1 continued): the participants UPDATE
-- policy R1 wrote (20260906090000_auth_ownership.sql, "a session can
-- update its own (or a legacy) participant") only ever checked *row*
-- ownership (participant_is_self_or_legacy(id)) -- it never restricted
-- *which columns* an owner could change. Postgres RLS's USING/WITH CHECK
-- clauses gate whether a row may be touched at all, not which of its
-- columns a given UPDATE statement sets -- so any session that owns (or
-- legacy-owns) a participant row could, via a direct anon-key call (not
-- through the app's own updateParticipant(), which only ever sends
-- display_name/role/age), reassign that row to a different trip
-- (trip_id), a different device (device_id), a different auth identity
-- (auth_user_id), a different managing adult (managed_by_participant_id),
-- or -- the concrete privilege-escalation case -- link itself to ANY
-- "Călătoriile mele" account at all (account_id), not just its own.
-- Exactly the "client grants itself ownership/membership/admin rights"
-- failure mode the review calls out.
--
-- Fixed with Postgres column-level privileges, not another RLS clause:
-- an UPDATE naming a column it has no privilege on fails outright at the
-- grant-check layer, before RLS is even evaluated, and unlike a
-- USING/WITH CHECK subquery this can't run into the same-statement MVCC
-- visibility gap 20260906100000_participants_self_read_fix.sql hit.
-- anon/authenticated can still SELECT/INSERT/DELETE the whole row (the
-- existing RLS policies keep gating INSERT/DELETE); this narrows only
-- what an *existing* row's UPDATE may touch, to exactly the columns
-- Setări > Utilizatori actually edits: display_name, role, age (edit),
-- last_seen_at (heartbeat). trip_id/device_id/auth_user_id/
-- managed_by_participant_id/account_id become immutable after insert for
-- anon/authenticated -- service_role (which bypasses grants entirely)
-- is the only path left for src/lib/creatorAccount.ts's account-linking
-- flow, moved server-side in the same batch (see
-- app/api/account/link-participant/route.ts).
revoke update on participants from anon, authenticated;
grant update (display_name, role, age, last_seen_at) on participants to anon, authenticated;

-- account_id was already settable at INSERT time too (getOrCreateAdultParticipant's
-- create branch passed accountId straight through) -- same escalation,
-- one step earlier: a forged INSERT could claim to belong to any
-- account from the moment the row is created, no UPDATE needed at all.
-- account_id is now only ever set by the service-role linking route
-- above; a client-side insert must always leave it null.
drop policy if exists "a session can only create participants for itself" on participants;

create policy "a session can only create participants for itself" on participants
  for insert with check (
    auth_user_id = auth.uid()
    and account_id is null
    and (
      managed_by_participant_id is null
      or exists (
        -- Explicitly qualified as participants.managed_by_participant_id
        -- (the row being inserted), not mgr.managed_by_participant_id --
        -- a bare `managed_by_participant_id` here resolves to the
        -- subquery's own `mgr` alias per normal SQL scoping (both
        -- `participants` and its `mgr` alias have a column of that exact
        -- name), which silently became a nonsensical
        -- "mgr.id = mgr.managed_by_participant_id" self-check that could
        -- never pass for a real manager row -- caught by
        -- supabase/tests/batch2_participant_lockdown.test.sql's scenario
        -- 5 (a legitimate managed-child insert), not by manual testing,
        -- which only happened to exercise the managed_by_participant_id
        -- IS NULL branch.
        select 1 from participants mgr
        where mgr.id = participants.managed_by_participant_id
          and mgr.auth_user_id = auth.uid()
      )
    )
  );
