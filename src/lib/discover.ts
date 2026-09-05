import { supabase } from "./supabase/client";
import { getSlotAvailability } from "./schedule";
import type { Database, ParticipantRole, QuestionSlot } from "./supabase/types";

export type Question = Database["public"]["Tables"]["questions"]["Row"];
// R3 (20260906140000_record_answer_authoritative.sql): is_correct is no
// longer selectable by anon/authenticated at the database level (column-
// level REVOKE) -- the client never legitimately has it on a fetched
// option row anymore, so the type reflects that instead of quietly lying
// about a field that would be missing at runtime. The only way to learn
// which option was correct is record_answer()'s own return value
// (submitAnswer below) or getAnsweredCorrectOptions(), both gated on the
// caller already having a response on record for that question.
export type AnswerOption = Omit<Database["public"]["Tables"]["answer_options"]["Row"], "is_correct">;
export type ExploreLink = Database["public"]["Tables"]["explore_links"]["Row"];
export type Extra = Database["public"]["Tables"]["extras"]["Row"];
export type Response = Database["public"]["Tables"]["responses"]["Row"];

export type AnswerSubmissionStatus = "accepted" | "already_recorded" | "conflict";

export interface AnswerSubmissionResult {
  status: AnswerSubmissionStatus;
  response: Response;
  contributedToTeam: boolean;
  correctOptionId: string | null;
}

export interface DiscoverQuestion {
  question: Question;
  options: AnswerOption[];
  exploreLinks: ExploreLink[];
}

// Only published + verified content is ever fetched -- RLS enforces this
// server-side too (docs/DATABASE.md "Content integrity"), this is just
// the client-side mirror of the same rule.
export async function getDiscoverQuestion(
  tripId: string,
  dayNumber: number,
  slot: QuestionSlot,
): Promise<DiscoverQuestion | null> {
  const { data: question, error: questionError } = await supabase
    .from("questions")
    .select("*")
    .eq("trip_id", tripId)
    .eq("kind", "discover")
    .eq("day_number", dayNumber)
    .eq("slot", slot)
    .maybeSingle();

  if (questionError) throw questionError;
  if (!question) return null;

  const [{ data: options, error: optionsError }, { data: exploreLinks, error: exploreError }] =
    await Promise.all([
      supabase
        .from("answer_options")
        .select("id, question_id, order_index, label, created_at")
        .eq("question_id", question.id)
        .order("order_index", { ascending: true }),
      supabase
        .from("explore_links")
        .select("*")
        .eq("question_id", question.id)
        .order("order_index", { ascending: true }),
    ]);

  if (optionsError) throw optionsError;
  if (exploreError) throw exploreError;

  return { question, options: options ?? [], exploreLinks: exploreLinks ?? [] };
}

export async function getMyResponse(
  participantId: string,
  questionId: string,
): Promise<Response | null> {
  const { data, error } = await supabase
    .from("responses")
    .select("*")
    .eq("participant_id", participantId)
    .eq("question_id", questionId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// R3 (20260906140000_record_answer_authoritative.sql): the single
// authoritative write path for every answer -- Discover, Battle, Final
// and Catchup alike (src/components/BattleFlow.tsx calls this directly
// too, there is no separate "battle" submission function anymore).
// Correctness, score, team and team-window eligibility are all derived
// server-side from the question/option/battle rows themselves -- nothing
// about them is trusted from the caller here.
//
// Idempotent: calling this again for a (participantId, questionId) pair
// that already has a saved response never creates a duplicate or
// re-evaluates team eligibility -- see the migration header for the full
// retry contract (`status`: 'accepted' | 'already_recorded' | 'conflict').
// Safe to call on revisit (e.g. re-opening an already-answered question)
// with that response's own selected_option_id to recover
// correctOptionId/contributedToTeam without any side effect.
export async function submitAnswer(
  participantId: string,
  questionId: string,
  selectedOptionId: string,
): Promise<AnswerSubmissionResult> {
  const { data, error } = await supabase.rpc("record_answer", {
    p_participant_id: participantId,
    p_question_id: questionId,
    p_selected_option_id: selectedOptionId,
  });
  if (error) throw error;
  return {
    status: data.status,
    response: data.response,
    contributedToTeam: data.contributed_to_team,
    correctOptionId: data.correct_option_id,
  };
}

// Batch reveal for the post-trip recap ("Întrebări" page): which option
// was correct for every question in `questionIds` this device has
// already legitimately answered (get_answered_correct_options RPC,
// SECURITY DEFINER, only reveals a question if the caller already has a
// response on record for it). Questions not yet answered are simply
// absent from the returned map, same spoiler-avoidance guarantee the
// live flows already have.
export async function getAnsweredCorrectOptions(questionIds: string[]): Promise<Map<string, string>> {
  if (questionIds.length === 0) return new Map();
  const { data, error } = await supabase.rpc("get_answered_correct_options", {
    p_question_ids: questionIds,
  });
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.question_id, row.correct_option_id]));
}

// Assigns (or returns the already-assigned) Extra for this participant +
// question. Eligible extras are filtered by audience and load-balanced by
// picking whichever eligible extra currently has the fewest assignments,
// so different participants tend to see different Extras (spec section
// 11) without needing a database function for it.
export async function getOrAssignExtra(
  participantId: string,
  participantRole: ParticipantRole,
  questionId: string,
): Promise<Extra | null> {
  const { data: eligible, error: extrasError } = await supabase
    .from("extras")
    .select("*")
    .eq("question_id", questionId)
    .in("audience", ["all", participantRole]);

  if (extrasError) throw extrasError;
  if (!eligible || eligible.length === 0) return null;

  const eligibleIds = eligible.map((e) => e.id);

  const { data: existingAssignment, error: assignmentError } = await supabase
    .from("extra_assignments")
    .select("extra_id")
    .eq("participant_id", participantId)
    .in("extra_id", eligibleIds)
    .maybeSingle();

  if (assignmentError) throw assignmentError;
  if (existingAssignment) {
    const assignedExtra = eligible.find((e) => e.id === existingAssignment.extra_id);
    if (assignedExtra) return assignedExtra;
  }

  const { data: counts, error: countsError } = await supabase
    .from("extra_assignments")
    .select("extra_id")
    .in("extra_id", eligibleIds);

  if (countsError) throw countsError;

  const countByExtra = new Map<string, number>(eligibleIds.map((id) => [id, 0]));
  for (const row of counts ?? []) {
    countByExtra.set(row.extra_id, (countByExtra.get(row.extra_id) ?? 0) + 1);
  }

  const leastAssigned = eligible.reduce((min, e) =>
    (countByExtra.get(e.id) ?? 0) < (countByExtra.get(min.id) ?? 0) ? e : min,
  );

  const { error: insertError } = await supabase.from("extra_assignments").insert({
    extra_id: leastAssigned.id,
    participant_id: participantId,
  });

  if (insertError) throw insertError;
  return leastAssigned;
}

export interface CatchUpQuestion {
  question: Question;
  options: AnswerOption[];
  exploreLinks: ExploreLink[];
}

// Every Discover or Battle question this specific participant hasn't
// answered yet and can no longer answer through the normal flow --
// product owner spec: someone who joins partway through the trip gets an
// extra onboarding-wizard step, right after they're created, that walks
// them through everything they missed one after another (both kinds),
// building up their own personal score. Also reachable any time after
// that, for any already-onboarded participant, via /trip/[slug]/catchup
// (linked from a Dashboard banner) -- joining the wizard is not the only
// moment this is needed: someone who joined on time can just as easily
// miss a window (phone died, fell asleep) and need the same way back.
// This never touches battle_scores (the team submission recorded live
// during BattleFlow) -- it's a plain submitResponse, same as Discover --
// so it can't retroactively change any already-played Battle's result.
//
// Eligible questions are: every past day's (regardless of time of day --
// those windows are long closed), plus *today's* own Discover slot or
// Battle once its time-of-day window has actually closed (product owner
// follow-up: joining today, after lunch or after Battle's 19:00-23:00
// window, needs the same catch-up path, not just joining on a later
// day). A slot still open or not yet open today is the normal Dashboard
// flow's job, not catch-up. The Final Battle is never included --
// everyone plays it live, on the actual last day, regardless of time.
export async function getCatchUpQuestions(
  tripId: string,
  currentDay: number,
  participantId: string,
): Promise<CatchUpQuestion[]> {
  const { data: finalBattle, error: finalBattleError } = await supabase
    .from("battles")
    .select("id")
    .eq("trip_id", tripId)
    .eq("is_final", true)
    .maybeSingle();
  if (finalBattleError) throw finalBattleError;

  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .select("*")
    .eq("trip_id", tripId)
    .in("kind", ["discover", "battle"])
    .lte("day_number", currentDay);
  if (questionsError) throw questionsError;
  if (!questions || questions.length === 0) return [];

  const todayWindowClosed = {
    morning: getSlotAvailability("morning").status === "after",
    lunch: getSlotAvailability("lunch").status === "after",
    battle: getSlotAvailability("battle").status === "after",
  };

  const eligible = questions.filter((q) => {
    if (finalBattle && q.battle_id === finalBattle.id) return false;
    if (q.day_number == null) return false;
    if (q.day_number < currentDay) return true;
    if (q.day_number > currentDay) return false;
    return q.kind === "discover"
      ? q.slot != null && todayWindowClosed[q.slot as "morning" | "lunch"]
      : todayWindowClosed.battle;
  });
  if (eligible.length === 0) return [];

  const { data: answeredRows, error: answeredError } = await supabase
    .from("responses")
    .select("question_id")
    .eq("participant_id", participantId)
    .in(
      "question_id",
      eligible.map((q) => q.id),
    );
  if (answeredError) throw answeredError;
  const answeredIds = new Set((answeredRows ?? []).map((r) => r.question_id));

  const pending = eligible
    .filter((q) => !answeredIds.has(q.id))
    .sort(
      (a, b) =>
        (a.day_number ?? 0) - (b.day_number ?? 0) ||
        (a.slot === "morning" ? -1 : a.slot === "lunch" ? 0 : 1),
    );
  if (pending.length === 0) return [];

  const pendingIds = pending.map((q) => q.id);
  const [{ data: options, error: optionsError }, { data: exploreLinks, error: exploreError }] =
    await Promise.all([
      supabase
        .from("answer_options")
        .select("*")
        .in("question_id", pendingIds)
        .order("order_index", { ascending: true }),
      supabase
        .from("explore_links")
        .select("*")
        .in("question_id", pendingIds)
        .order("order_index", { ascending: true }),
    ]);
  if (optionsError) throw optionsError;
  if (exploreError) throw exploreError;

  return pending.map((q) => ({
    question: q,
    options: (options ?? []).filter((o) => o.question_id === q.id),
    exploreLinks: (exploreLinks ?? []).filter((l) => l.question_id === q.id),
  }));
}

export interface LeaderboardEntry {
  participantId: string;
  displayName: string;
  role: ParticipantRole;
  age: number | null;
  answered: number;
  score: number;
}

// Trip-wide (every device, not just this one). This is a deliberate,
// explicit product-owner addition on top of the spec, which lists
// individual leaderboards as out of scope; keep it secondary to the
// Parents-vs-Kids score, not a replacement for it.
//
// Sums every question a participant has an individual `responses` row
// for, Discover or Battle alike -- Battle is a team submission during
// live play (battle_scores, no individual `responses` row), so in
// practice only catch-up answers (getCatchUpQuestions, answered
// individually by someone who joined partway through the trip) ever add
// Battle points here; a live Battle's team result is untouched either
// way. The Final Battle is never catch-up-able (everyone plays it live
// on the actual last day), so it never contributes here either.
//
// Pass `day` to scope to a single trip day (the "Scor zilnic" toggle on
// the Scor page); omit it for the cumulative "Scor total" view.
export async function getParticipantLeaderboard(
  tripId: string,
  day?: number,
): Promise<LeaderboardEntry[]> {
  const { data: participantRows, error: participantsError } = await supabase
    .from("participants")
    .select("id, display_name, role, age")
    .eq("trip_id", tripId);
  if (participantsError) throw participantsError;

  let questionQuery = supabase.from("questions").select("id, points").eq("trip_id", tripId);
  if (day != null) questionQuery = questionQuery.eq("day_number", day);
  const { data: questionRows, error: questionsError } = await questionQuery;
  if (questionsError) throw questionsError;

  const pointsByQuestion = new Map((questionRows ?? []).map((q) => [q.id, q.points]));
  const questionIds = (questionRows ?? []).map((q) => q.id);

  let responseRows: Pick<Response, "participant_id" | "question_id" | "is_correct">[] = [];
  if (questionIds.length > 0) {
    const { data, error: responsesError } = await supabase
      .from("responses")
      .select("participant_id, question_id, is_correct")
      .in("question_id", questionIds);
    if (responsesError) throw responsesError;
    responseRows = data ?? [];
  }

  const statsByParticipant = new Map<string, { answered: number; score: number }>();
  for (const r of responseRows) {
    const stats = statsByParticipant.get(r.participant_id) ?? { answered: 0, score: 0 };
    stats.answered += 1;
    if (r.is_correct) stats.score += pointsByQuestion.get(r.question_id) ?? 0;
    statsByParticipant.set(r.participant_id, stats);
  }

  const leaderboard: LeaderboardEntry[] = (participantRows ?? []).map((p) => {
    const stats = statsByParticipant.get(p.id) ?? { answered: 0, score: 0 };
    return {
      participantId: p.id,
      displayName: p.display_name,
      role: p.role,
      age: p.age,
      answered: stats.answered,
      score: stats.score,
    };
  });

  leaderboard.sort((a, b) => b.score - a.score || b.answered - a.answered);
  return leaderboard;
}
