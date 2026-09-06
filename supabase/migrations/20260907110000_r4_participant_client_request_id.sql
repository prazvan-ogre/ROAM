-- R4 correction (2026-09-06 batch, review round 2): replaces the
-- previous fix's 15-second exact-match dedup window (addChildProfile,
-- src/lib/participant.ts) with a real idempotency key.
--
-- WHY the window was wrong: it recognized "same trip+device+role+name+
-- age, created in the last 15s" as a retry. That has two real bugs --
-- (1) a retry slower than 15s (a genuinely dropped connection retried
-- by hand, or a backgrounded tab) still duplicates the child, and (2) a
-- true idempotency mechanism must be tied to a specific ATTEMPT, not to
-- a coincidence of matching field values within a time window: two
-- honestly-intended identical adds (twins, same name, no age entered)
-- submitted seconds apart would have been wrongly collapsed into one
-- row by the old heuristic.
--
-- FIX: the caller now generates one random id (crypto.randomUUID(),
-- threaded through as `requestId`) per distinct add-child ATTEMPT --
-- kept stable across an automatic/manual retry of that same attempt,
-- and regenerated whenever the person actually changes what they're
-- submitting (a new name/age/role, or starting a fresh add after a
-- prior one succeeded). client_request_id is unique per row: a retry
-- that reuses the same id can never create a second row (the unique
-- index enforces this even under real concurrency -- two literally
-- simultaneous requests for the same id both attempt the insert, one
-- wins, the other gets a 23505 and reconciles onto the winner's row,
-- see addChildProfile); two different ids, however identical their
-- name/age, always get separate rows -- twins stay possible regardless
-- of timing.
--
-- Nullable and unindexed for existing rows (partial index, `where
-- client_request_id is not null`): every row created before this
-- migration simply has no request id and is untouched by it.
alter table participants
  add column client_request_id uuid;

create unique index participants_client_request_id_key
  on participants (client_request_id)
  where client_request_id is not null;
