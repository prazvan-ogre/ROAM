-- Replaces the placeholder generic rating+comment shape with the actual
-- 6-question feedback form from spec section 20.

alter table feedback
  drop column rating,
  add column learned_new smallint check (learned_new between 1 and 5),
  add column generated_conversations smallint check (generated_conversations between 1 and 5),
  add column searched_more boolean,
  add column anticipated_next text check (anticipated_next in ('da', 'uneori', 'nu')),
  add column would_use_again text check (would_use_again in ('sigur', 'probabil', 'probabil_nu', 'nu'));

-- battle_scores rows are team-level, not individually identifying (no
-- per-participant scoring per spec section 17), so -- unlike
-- responses/extra_assignments -- there's no reason to hide raw rows
-- behind an RPC: the whole point is for every device to be able to show
-- "PĂRINȚI 2 — COPII 1" without waiting on a fresh aggregate call.
create policy "battle scores are publicly readable" on battle_scores
  for select using (true);
