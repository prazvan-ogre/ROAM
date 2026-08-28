import type { createAdminClient } from "@/lib/supabase/admin";
import type {
  GeneratedBattleQuestion,
  GeneratedDay,
  GeneratedDiscoverQuestion,
  GeneratedTripContent,
} from "./generateTripContent";

type AdminClient = ReturnType<typeof createAdminClient>;

async function insertDiscoverQuestion(
  admin: AdminClient,
  tripId: string,
  dayNumber: number,
  slot: "morning" | "lunch",
  q: GeneratedDiscoverQuestion,
): Promise<void> {
  const { data: question, error: questionError } = await admin
    .from("questions")
    .insert({
      trip_id: tripId,
      kind: "discover",
      day_number: dayNumber,
      slot,
      prompt: q.prompt,
      common_core: q.commonCore,
      one_thing: q.oneThing,
    })
    .select()
    .single();
  if (questionError) throw questionError;

  await Promise.all([
    admin.from("answer_options").insert(
      q.options.map((o, i) => ({
        question_id: question.id,
        order_index: i,
        label: o.label,
        is_correct: o.isCorrect,
      })),
    ),
    admin.from("extras").insert({
      trip_id: tripId,
      question_id: question.id,
      day_number: dayNumber,
      extra_type: q.extra.type,
      audience: "all",
      title: q.extra.title,
      description: q.extra.description,
    }),
    q.exploreLinks.length > 0
      ? admin.from("explore_links").insert(
          q.exploreLinks.map((l, i) => ({
            trip_id: tripId,
            question_id: question.id,
            title: l.title,
            url: l.url,
            order_index: i,
          })),
        )
      : Promise.resolve({ error: null }),
  ]).then(([optionsResult, extraResult, linksResult]) => {
    if (optionsResult.error) throw optionsResult.error;
    if (extraResult.error) throw extraResult.error;
    if (linksResult.error) throw linksResult.error;
  });
}

async function insertBattleQuestion(
  admin: AdminClient,
  tripId: string,
  battleId: string,
  dayNumber: number,
  q: GeneratedBattleQuestion,
): Promise<void> {
  const { data: question, error: questionError } = await admin
    .from("questions")
    .insert({
      trip_id: tripId,
      battle_id: battleId,
      kind: "battle",
      day_number: dayNumber,
      prompt: q.prompt,
    })
    .select()
    .single();
  if (questionError) throw questionError;

  const [optionsResult, extraResult] = await Promise.all([
    admin.from("answer_options").insert(
      q.options.map((o, i) => ({
        question_id: question.id,
        order_index: i,
        label: o.label,
        is_correct: o.isCorrect,
      })),
    ),
    admin.from("extras").insert({
      trip_id: tripId,
      question_id: question.id,
      day_number: dayNumber,
      extra_type: q.extra.type,
      audience: "all",
      title: q.extra.title,
      description: q.extra.description,
    }),
  ]);
  if (optionsResult.error) throw optionsResult.error;
  if (extraResult.error) throw extraResult.error;
}

async function insertBattleRow(
  admin: AdminClient,
  tripId: string,
  dayNumber: number,
  title: string,
  isFinal: boolean,
  orderIndex: number,
) {
  const { data, error } = await admin
    .from("battles")
    .insert({ trip_id: tripId, day_number: dayNumber, title, is_final: isFinal, order_index: orderIndex })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function insertDay(admin: AdminClient, tripId: string, dayIndex: number, day: GeneratedDay): Promise<void> {
  const dayNumber = dayIndex + 1;
  const [battle] = await Promise.all([
    insertBattleRow(admin, tripId, dayNumber, day.battleTitle, false, dayIndex),
    insertDiscoverQuestion(admin, tripId, dayNumber, "morning", day.morning),
    insertDiscoverQuestion(admin, tripId, dayNumber, "lunch", day.lunch),
  ]);

  await Promise.all(day.battleQuestions.map((q) => insertBattleQuestion(admin, tripId, battle.id, dayNumber, q)));
}

// Everything lands with the schema's own defaults -- verified=false,
// published=false -- so none of this is visible to participants until a
// human reviews and flips those flags, same as Kassandra's seed content.
export async function insertGeneratedContent(
  admin: AdminClient,
  tripId: string,
  content: GeneratedTripContent,
): Promise<void> {
  const { error: prizeError } = await admin.from("prize_options").insert(
    content.prizeOptions.map((p, i) => ({
      trip_id: tripId,
      title: p.title,
      description: p.description,
      order_index: i,
    })),
  );
  if (prizeError) throw prizeError;

  await Promise.all(content.days.map((day, i) => insertDay(admin, tripId, i, day)));

  const finalBattle = await insertBattleRow(
    admin,
    tripId,
    content.days.length,
    content.finalBattleTitle,
    true,
    content.days.length,
  );
  await Promise.all(
    content.finalBattleQuestions.map((q) => insertBattleQuestion(admin, tripId, finalBattle.id, content.days.length, q)),
  );
}
