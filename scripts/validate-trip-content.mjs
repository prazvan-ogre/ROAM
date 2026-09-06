#!/usr/bin/env node
// R7 operator CLI: run the real content validator (and, optionally,
// publish) for one trip from the command line -- for whoever prefers a
// terminal to the UI, or wants this in a pre-deploy checklist/CI step.
// Calls the exact same SQL functions the app itself uses
// (validate_trip_content()/publish_trip(),
// supabase/migrations/20260908090000_r7_content_publishing_pipeline.sql,
// also reachable from Setări > Publicare -- app/api/admin/trips/[slug]/
// {validate,publish}) -- there is only ever one set of validation rules,
// never a second copy that could drift from what the app itself enforces.
//
// Usage:
//   node scripts/validate-trip-content.mjs <slug>            # report only
//   node scripts/validate-trip-content.mjs <slug> --publish  # then publish if clean
//
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
// environment -- the same two variables app/api/trips/create/route.ts's
// own createAdminClient() needs (never the anon key: both RPCs are
// revoked from anon/authenticated at the database level). Exits non-zero
// on any error-severity issue (or a rejected publish), zero when clean --
// safe to wire into a pre-deploy check. See docs/DATABASE.md's R7
// section for the full operator walkthrough, and this repo's R7 report
// for what "ready" actually means before you run this with --publish
// against a production project.

import { createClient } from "@supabase/supabase-js";

export function formatIssueLine(issue) {
  const where = issue.day_number != null ? ` (day ${issue.day_number})` : issue.entity_id ? ` (${issue.entity_id})` : "";
  return `[${issue.severity}] ${issue.check_key}${where}: ${issue.message}`;
}

export function countErrors(issues) {
  return (issues ?? []).filter((issue) => issue.severity === "error").length;
}

async function main() {
  const [, , slug, ...rest] = process.argv;
  const shouldPublish = rest.includes("--publish");

  if (!slug) {
    console.error("Usage: node scripts/validate-trip-content.mjs <slug> [--publish]");
    process.exitCode = 2;
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.");
    process.exitCode = 2;
    return;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { data: trip, error: tripError } = await admin
    .from("trips")
    .select("id, slug, content_status")
    .eq("slug", slug)
    .maybeSingle();
  if (tripError) throw tripError;
  if (!trip) {
    console.error(`No trip found with slug "${slug}".`);
    process.exitCode = 1;
    return;
  }

  console.log(`Trip: ${trip.slug} (content_status: ${trip.content_status})`);

  const { data: issues, error: validateError } = await admin.rpc("validate_trip_content", { p_trip_id: trip.id });
  if (validateError) throw validateError;

  if (!issues || issues.length === 0) {
    console.log("No issues found.");
  } else {
    for (const issue of issues) console.log(formatIssueLine(issue));
  }
  const errorCount = countErrors(issues);

  if (!shouldPublish) {
    process.exitCode = errorCount > 0 ? 1 : 0;
    return;
  }

  if (errorCount > 0) {
    console.error(`\n${errorCount} error(s) -- not publishing.`);
    process.exitCode = 1;
    return;
  }

  const { data: result, error: publishError } = await admin.rpc("publish_trip", { p_trip_id: trip.id });
  if (publishError) throw publishError;
  console.log(`\npublish_trip: ${result.status} (errors: ${result.error_count}, warnings: ${result.warning_count})`);
  process.exitCode = result.status === "rejected" ? 1 : 0;
}

// Only run when invoked directly (`node scripts/validate-trip-content.mjs
// ...`), not when imported -- tests/unit/validate-trip-content-script.test.ts
// imports formatIssueLine/countErrors above without triggering a live
// Supabase call.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Script failed:", err);
    process.exitCode = 1;
  });
}
