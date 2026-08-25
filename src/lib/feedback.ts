import { supabase } from "./supabase/client";
import type { Database } from "./supabase/types";

export type FeedbackInput = Omit<
  Database["public"]["Tables"]["feedback"]["Row"],
  "id" | "created_at"
>;

export async function submitFeedback(input: FeedbackInput): Promise<void> {
  const { error } = await supabase.from("feedback").insert(input);
  if (error) throw error;
}
