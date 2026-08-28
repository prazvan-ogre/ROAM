import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// Service-role client for the few server-only writes the public trip
// creation flow needs (app/api/trips/create/route.ts): the trip row
// itself, then all its generated Discover/Battle content -- none of
// which anon/authenticated can insert (see initial_schema.sql's "content
// changes go through the service-role key only"). Never import this from
// a "use client" component or anything bundled to the browser; the throw
// below only catches that at runtime, not build time.
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient() must never run in the browser.");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY -- required for server-side trip creation.",
    );
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
