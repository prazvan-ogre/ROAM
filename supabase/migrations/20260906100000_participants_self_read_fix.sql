-- R1 hotfix: the participants SELECT policy from 20260906090000_
-- auth_ownership.sql let a caller read a row via `auth_user_id is null`
-- (legacy) or `is_trip_member(trip_id)` (an existing sibling row on the
-- same trip proves membership) -- but never let a session read back its
-- own row directly.
--
-- That broke the very first participant a brand-new anonymous session
-- ever creates: the app's insert is `.insert(...).select().single()`,
-- which compiles to `INSERT ... RETURNING ...` -- and RETURNING
-- re-checks the table's SELECT policy against the just-inserted row.
-- For a session's first-ever participant on a trip, is_trip_member(trip_id)
-- has no OTHER row yet to find, so that read-back failed -- and Postgres
-- reports the whole statement as "new row violates row-level security
-- policy for table participants", indistinguishable from an actual
-- INSERT rejection (confirmed by reproducing it directly in SQL: the
-- INSERT's own WITH CHECK, auth_user_id = auth.uid(), evaluated true;
-- the read-back is what failed).
--
-- A first attempt at this fix added participant_is_self_or_legacy(id) --
-- the same helper the update/delete policies use -- as an extra
-- disjunct here too. That still failed, for a subtler reason: that
-- helper does its own SECURITY DEFINER *subquery* (`select ... from
-- participants where id = ...`), and a nested subquery evaluated as
-- part of RETURNING's policy re-check does not reliably see the row
-- the very same command is still in the middle of inserting. The direct
-- column comparison below has no subquery at all -- it's evaluated
-- against the row's own values already in hand, the exact same way the
-- INSERT policy's own WITH CHECK is (which we confirmed works) -- so it
-- has no such visibility gap.
drop policy if exists "trip members (or legacy rows) can read participants" on participants;

create policy "trip members (or legacy rows) can read participants" on participants
  for select using (
    auth_user_id is null
    or auth_user_id = auth.uid()
    or is_trip_member(trip_id)
  );
