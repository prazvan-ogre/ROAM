-- Supports the Home-screen dashboard (product owner request): a short
-- blurb about where the trip is, shown alongside participant counts,
-- day counter, and battle scores.

alter table trips
  add column destination text,
  add column location_info text;
