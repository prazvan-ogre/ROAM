-- Correction to 20260830100000_admin_account.sql: the admin phone number
-- was wrong. Demote it back to a normal account and promote the correct
-- one instead -- exactly one admin account at a time, same is_admin flag
-- and app/api/account/route.ts login flow as before.

update creator_accounts
set is_admin = false
where phone_number = '0721345678';

insert into creator_accounts (phone_number, pin_hash, is_admin)
values (
  '0721234567',
  '63d24499da3dea0f2ae2ddc94ab564f1:488b361495cf26134e3f1cb965ea85c895d53eeecef61f26e23dbfe7876c099c6a8da240a0f16b7d0abef4ac08ed4795df2d70bc647091c041bd35ac6315d021',
  true
)
on conflict (phone_number) do update
  set is_admin = true,
      pin_hash = excluded.pin_hash;
