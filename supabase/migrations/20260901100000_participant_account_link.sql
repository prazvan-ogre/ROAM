-- Links a participant profile to the "Călătoriile mele" account it
-- actually belongs to, fixing a real bug: Setări > Utilizatori
-- (EditProfileForm) showed the device's logged-in account phone/PIN
-- under *any* adult profile being edited, with no check that the
-- account genuinely belonged to that specific profile -- just "this
-- device has some account, and this happens to be an adult". A device
-- with more than one adult participant (e.g. an admin account plus an
-- unrelated test/participant profile on the same browser) would show
-- the wrong account's phone number under the wrong profile.
--
-- One creator_account can only ever have one linked participant per
-- trip in practice (the account auto-joins as its first adult, product
-- owner spec) -- nullable and no uniqueness constraint here since an
-- account is free to exist without ever joining a trip as a participant
-- (e.g. the admin account), and existing participants predating this
-- column simply start out unlinked.

alter table participants
  add column account_id uuid references creator_accounts (id) on delete set null;

create index participants_account_id_idx on participants (account_id);
