// Hand-written types matching supabase/migrations. Regenerate with
// `supabase gen types typescript --linked > src/lib/supabase/types.ts`
// and keep this file's shape as the source of truth in the meantime.
//
// Safe to regenerate as of 20260901090000_enum_types.sql: every
// "enum-like" column below (QuestionSlot, BattleTeam, ParticipantRole,
// etc.) is now a real Postgres enum, not a text column with a check
// constraint, so `supabase gen types` produces the same literal unions
// as here instead of widening them to plain `string`.

export type ParticipantRole = "adult" | "child";
export type QuestionKind = "discover" | "battle";
export type QuestionType = "single_choice" | "multi_choice" | "text";
export type QuestionSlot = "morning" | "lunch";
export type ExtraType = "know" | "think" | "connect" | "ask" | "explore";
export type ExtraAudience = "all" | "adult" | "child";
export type AssignmentStatus = "assigned" | "viewed" | "completed";
export type BattleTeam = "adults" | "kids";
export type TripContentStatus = "pending" | "generating" | "ready" | "failed";

type TableDef<Row, InsertRequired extends keyof Row> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, InsertRequired>;
  Update: Partial<Row>;
  Relationships: [];
};

// A Postgres view (e.g. trips_public, 20260906091000_account_hardening.sql)
// is select-only from the client -- no Insert/Update shape.
type ViewDef<Row> = {
  Row: Row;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      trips: TableDef<
        {
          id: string;
          slug: string;
          name: string;
          language: string;
          start_date: string | null;
          duration_days: number;
          destination: string | null;
          location_info: string | null;
          prize: string | null;
          created_by_device_id: string | null;
          created_by_account_id: string | null;
          content_status: TripContentStatus;
          is_active: boolean;
          is_demo: boolean;
          created_at: string;
        },
        "slug" | "name" | "duration_days"
      >;
      battles: TableDef<
        {
          id: string;
          trip_id: string;
          day_number: number | null;
          title: string;
          is_final: boolean;
          order_index: number;
          is_active: boolean;
          created_at: string;
        },
        "trip_id" | "title"
      >;
      questions: TableDef<
        {
          id: string;
          trip_id: string;
          battle_id: string | null;
          kind: QuestionKind;
          day_number: number | null;
          slot: QuestionSlot | null;
          order_index: number;
          prompt: string;
          question_type: QuestionType;
          media_url: string | null;
          points: number;
          common_core: string | null;
          one_thing: string | null;
          correct_reveal_message: string | null;
          alternative_reveal_message: string | null;
          sources: unknown[];
          verified: boolean;
          published: boolean;
          is_active: boolean;
          created_at: string;
        },
        "trip_id" | "kind" | "prompt"
      >;
      answer_options: TableDef<
        {
          id: string;
          question_id: string;
          order_index: number;
          label: string;
          is_correct: boolean;
          created_at: string;
        },
        "question_id" | "label"
      >;
      extras: TableDef<
        {
          id: string;
          trip_id: string;
          question_id: string | null;
          day_number: number | null;
          title: string;
          description: string | null;
          media_url: string | null;
          order_index: number;
          extra_type: ExtraType | null;
          audience: ExtraAudience;
          sources: unknown[];
          verified: boolean;
          published: boolean;
          is_active: boolean;
          created_at: string;
        },
        "trip_id" | "title"
      >;
      explore_links: TableDef<
        {
          id: string;
          trip_id: string;
          extra_id: string | null;
          question_id: string | null;
          title: string;
          url: string;
          description: string | null;
          order_index: number;
          created_at: string;
        },
        "trip_id" | "title" | "url"
      >;
      participants: TableDef<
        {
          id: string;
          trip_id: string;
          device_id: string;
          display_name: string;
          role: ParticipantRole;
          age: number | null;
          managed_by_participant_id: string | null;
          account_id: string | null;
          // R1 (20260906090000_auth_ownership.sql): which Supabase Auth
          // session (supabase.auth.signInAnonymously(), src/lib/device.ts)
          // created this row -- null for rows created before that
          // migration, deliberately never backfilled (see the migration's
          // own comments: matching on device_id alone to claim a legacy
          // row would be exactly the "trust a public/localStorage
          // identifier" mistake R1 fixes).
          auth_user_id: string | null;
          created_at: string;
          last_seen_at: string;
        },
        "trip_id" | "device_id" | "display_name" | "role"
      >;
      extra_assignments: TableDef<
        {
          id: string;
          extra_id: string;
          participant_id: string;
          status: AssignmentStatus;
          assigned_at: string;
          viewed_at: string | null;
        },
        "extra_id" | "participant_id"
      >;
      responses: TableDef<
        {
          id: string;
          question_id: string;
          participant_id: string;
          selected_option_id: string | null;
          response_text: string | null;
          is_correct: boolean | null;
          response_time_ms: number | null;
          created_at: string;
        },
        "question_id" | "participant_id"
      >;
      battle_scores: TableDef<
        {
          id: string;
          battle_id: string;
          participant_id: string | null;
          team: BattleTeam | null;
          score: number;
          created_at: string;
        },
        "battle_id"
      >;
      feedback: TableDef<
        {
          id: string;
          trip_id: string;
          participant_id: string | null;
          learned_new: number | null;
          generated_conversations: number | null;
          searched_more: boolean | null;
          anticipated_next: "da" | "uneori" | "nu" | null;
          would_use_again: "sigur" | "probabil" | "probabil_nu" | "nu" | null;
          comment: string | null;
          created_at: string;
        },
        "trip_id"
      >;
      prize_options: TableDef<
        {
          id: string;
          trip_id: string;
          title: string;
          description: string | null;
          order_index: number;
          created_at: string;
        },
        "trip_id" | "title"
      >;
      prize_votes: TableDef<
        {
          id: string;
          trip_id: string;
          prize_option_id: string;
          participant_id: string;
          created_at: string;
        },
        "trip_id" | "prize_option_id" | "participant_id"
      >;
      analytics_events: TableDef<
        {
          id: string;
          trip_id: string;
          participant_id: string | null;
          event_name: string;
          event_props: Record<string, unknown>;
          created_at: string;
        },
        "trip_id" | "event_name"
      >;
      creator_accounts: TableDef<
        {
          id: string;
          phone_number: string;
          pin_hash: string;
          is_admin: boolean;
          display_name: string | null;
          created_at: string;
        },
        "phone_number" | "pin_hash"
      >;
      // R1 (20260906091000_account_hardening.sql): service-role only (RLS
      // enabled, zero policies) -- app/api/account/route.ts's login rate
      // limiter, same "reachable only via the service-role key" pattern
      // as creator_accounts itself.
      account_login_attempts: TableDef<
        {
          phone_number: string;
          failed_count: number;
          first_failed_at: string;
          locked_until: string | null;
        },
        "phone_number"
      >;
    };
    Views: {
      // R1 (20260906091000_account_hardening.sql): the public-facing
      // projection of `trips` -- excludes created_by_account_id/
      // created_by_device_id, which anon/authenticated can no longer
      // SELECT from the base table at all. Ordinary trip reads (join
      // flow, Discover/Battle content lookups, etc.) should read this
      // view, not the base table (src/lib/trip.ts).
      trips_public: ViewDef<{
        id: string;
        slug: string;
        name: string;
        language: string;
        start_date: string | null;
        duration_days: number;
        destination: string | null;
        location_info: string | null;
        content_status: TripContentStatus;
        is_active: boolean;
        is_demo: boolean;
        created_at: string;
      }>;
    };
    Functions: {
      battle_team_score: {
        Args: { p_battle_id: string };
        Returns: { team: BattleTeam; score: number }[];
      };
      trip_battle_win_tally: {
        Args: { p_trip_id: string };
        Returns: { team: BattleTeam; wins: number }[];
      };
      // Superseded by record_answer below -- no app code calls this
      // anymore, kept only because supabase/tests/
      // record_battle_answer_atomicity.test.sql still exercises it as a
      // historical regression fixture for hypothesis B.
      record_battle_answer: {
        Args: {
          p_participant_id: string;
          p_question_id: string;
          p_selected_option_id: string;
          p_is_correct: boolean;
          p_battle_id: string;
          p_team: BattleTeam;
          p_score: number;
        };
        Returns: {
          id: string;
          question_id: string;
          participant_id: string;
          selected_option_id: string | null;
          response_text: string | null;
          is_correct: boolean | null;
          response_time_ms: number | null;
          created_at: string;
        };
      };
      // R3 (20260906140000_record_answer_authoritative.sql): the single
      // authoritative write path for Discover, Battle, Final and Catchup
      // alike -- see that migration's header for the full contract.
      record_answer: {
        Args: {
          p_participant_id: string;
          p_question_id: string;
          p_selected_option_id: string;
        };
        Returns: {
          status: "accepted" | "already_recorded" | "conflict";
          response: {
            id: string;
            question_id: string;
            participant_id: string;
            selected_option_id: string | null;
            response_text: string | null;
            is_correct: boolean | null;
            response_time_ms: number | null;
            created_at: string;
          };
          contributed_to_team: boolean;
          correct_option_id: string | null;
        };
      };
      get_answered_correct_options: {
        Args: { p_question_ids: string[] };
        Returns: { question_id: string; correct_option_id: string }[];
      };
    };
  };
}
