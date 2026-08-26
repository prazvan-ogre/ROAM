-- Product owner request: a first-visit onboarding wizard (theme intro ->
-- name -> "adult sau copil" -> how it works -> prize) that creates the
-- participant right after the role step. If a child is the very first
-- person to open the trip link on their own device, there is no adult
-- participant yet to set as managed_by_participant_id -- so the
-- child_needs_manager check (profiles_and_content_model migration) is
-- relaxed: a child profile may now exist without a manager. This is a
-- deliberate product decision (not every child shares the parent's
-- device/phone), not an oversight.

alter table participants drop constraint if exists child_needs_manager;
