// Type declarations for validate-trip-content.mjs's pure, exported
// helpers -- allowJs is off project-wide (tsconfig.json), so this JS
// script needs its own .d.ts for tests/unit/validate-trip-content-script.test.ts
// (a plain TS import) to typecheck.
export interface ContentValidationIssueLike {
  check_key: string;
  severity: string;
  message: string;
  day_number: number | null;
  entity_id: string | null;
}

export function formatIssueLine(issue: ContentValidationIssueLike): string;
export function countErrors(issues: ContentValidationIssueLike[] | null | undefined): number;
