// R9: Setări > "Generare" tab (GenerateSection in app/trip/[slug]/
// settings/page.tsx). Renders the real SettingsPage component; only
// network-backed lib functions and useTrip/useProfiles are mocked --
// same pattern as settings-brief-section.test.tsx. src/lib/
// questionGeneration.ts's own fetch wrappers are mocked here (the real
// API routes are covered by tests/unit/api-trips-generate.test.ts
// instead) -- these tests prove what the UI itself shows and calls.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import type { GenerationStatus, GeneratedDraft } from "@/lib/questionGeneration";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "trip-1" }),
  usePathname: () => "/trip/trip-1/settings",
}));

let trip: {
  id: string;
  slug: string;
  name: string;
  duration_days: number;
  start_date: string | null;
  content_status: "pending" | "generating" | "ready" | "failed";
  destination: string;
};
let profiles: unknown[];
const mutateProfiles = vi.fn(async () => profiles);

vi.mock("@/lib/hooks", () => ({
  useTrip: () => ({ data: trip, error: undefined }),
  useProfiles: () => ({ data: profiles, error: undefined, mutate: mutateProfiles }),
}));

const getStoredAccountId = vi.fn<[], string | null>(() => "account-1");
const getAccountDetails = vi.fn();
const getTripsForCurrentAccount = vi.fn();
const updateAccountDetails = vi.fn();

vi.mock("@/lib/creatorAccount", () => ({
  getStoredAccountId: (...args: unknown[]) => getStoredAccountId(...(args as [])),
  getAccountDetails: (...args: unknown[]) => getAccountDetails(...args),
  getTripsForCurrentAccount: (...args: unknown[]) => getTripsForCurrentAccount(...args),
  updateAccountDetails: (...args: unknown[]) => updateAccountDetails(...args),
}));

vi.mock("@/lib/prize", () => ({
  getPrizeStatus: vi.fn().mockResolvedValue({ options: [], votingOpen: false, winner: null, closesAt: null }),
}));
vi.mock("@/lib/participant", () => ({
  addChildProfile: vi.fn(),
  updateParticipant: vi.fn(),
  deleteParticipant: vi.fn(),
}));
vi.mock("@/lib/adminContent", () => ({
  validateTripContent: vi.fn().mockResolvedValue({ contentStatus: "pending", issues: [] }),
  publishTrip: vi.fn(),
}));
vi.mock("@/lib/editorialBrief", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/editorialBrief")>();
  return {
    ...actual,
    getTripEditorialBrief: vi.fn().mockResolvedValue({ brief: null, readOnly: false }),
    saveTripEditorialBrief: vi.fn(),
  };
});

const getGenerationStatus = vi.fn<[string], Promise<GenerationStatus>>();
const startGeneration = vi.fn();
const acceptGeneratedDraft = vi.fn();
const rejectGeneratedDraft = vi.fn();
const regenerateGeneratedDraft = vi.fn();

vi.mock("@/lib/questionGeneration", () => ({
  getGenerationStatus: (...args: [string]) => getGenerationStatus(...args),
  startGeneration: (...args: [string, number]) => startGeneration(...args),
  acceptGeneratedDraft: (...args: unknown[]) => acceptGeneratedDraft(...args),
  rejectGeneratedDraft: (...args: unknown[]) => rejectGeneratedDraft(...args),
  regenerateGeneratedDraft: (...args: unknown[]) => regenerateGeneratedDraft(...args),
}));

function draft(overrides: Partial<GeneratedDraft> = {}): GeneratedDraft {
  return {
    id: "draft-1",
    dayNumber: 1,
    slot: "morning",
    themeCategory: "history",
    difficulty: "medium",
    prompt: "Ce insulă găzduiește Achilleion?",
    explanation: "Achilleion a fost construit pentru împărăteasa Sisi.",
    options: [
      { label: "Corfu", is_correct: true },
      { label: "Rodos", is_correct: false },
    ],
    status: "pending_review",
    edited: false,
    resultingQuestionId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function statusWithBrief(overrides: Partial<GenerationStatus> = {}): GenerationStatus {
  return {
    contentStatus: "pending",
    brief: {
      difficulty: "medium",
      style: "fun",
      narratorCharacterName: null,
      theme: { history: 25, places: 25, food: 25, curiosities: 25 },
      updatedAt: "2026-01-01T00:00:00Z",
    },
    drafts: [],
    lastRun: null,
    ...overrides,
  };
}

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

beforeEach(() => {
  trip = {
    id: "trip-1",
    slug: "trip-1",
    name: "Test Trip",
    duration_days: 5,
    start_date: null,
    content_status: "pending",
    destination: "Corfu",
  };
  profiles = [];
  mutateProfiles.mockClear();
  getStoredAccountId.mockReset().mockReturnValue("account-1");
  getAccountDetails.mockReset().mockResolvedValue({ phoneNumber: "", displayName: null, isAdmin: false });
  getTripsForCurrentAccount.mockReset().mockResolvedValue({ isAdmin: false, trips: [trip] });
  updateAccountDetails.mockReset();
  getGenerationStatus.mockReset();
  startGeneration.mockReset();
  acceptGeneratedDraft.mockReset();
  rejectGeneratedDraft.mockReset();
  regenerateGeneratedDraft.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("R9: Setări > Generare tab visibility", () => {
  it("is shown for the trip's own creator", async () => {
    getGenerationStatus.mockResolvedValue(statusWithBrief());
    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    expect(await screen.findByRole("button", { name: "Generare" })).toBeTruthy();
  });

  it("is hidden for an account that neither created this trip nor is admin", async () => {
    getTripsForCurrentAccount.mockResolvedValue({ isAdmin: false, trips: [] });
    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await waitFor(() => expect(getTripsForCurrentAccount).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Generare" })).toBeNull();
    expect(getGenerationStatus).not.toHaveBeenCalled();
  });
});

describe("R9: Generare tab -- no brief / brief summary / state badge", () => {
  it("shows a message when the trip has no brief yet, and no Generează button", async () => {
    getGenerationStatus.mockResolvedValue({ ...statusWithBrief(), brief: null });
    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Generare" }));
    expect(await screen.findByText("Brief editorial nespecificat")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Generează întrebări" })).toBeNull();
  });

  it("shows the brief used (difficulty/style/theme) when one exists", async () => {
    getGenerationStatus.mockResolvedValue(statusWithBrief());
    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Generare" }));
    expect(await screen.findByText("Mediu")).toBeTruthy();
    expect(screen.getByText("Amuzant")).toBeTruthy();
  });

  it("shows a published notice and no Generează button once the trip is ready", async () => {
    getGenerationStatus.mockResolvedValue(statusWithBrief({ contentStatus: "ready" }));
    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Generare" }));
    expect(await screen.findByText(/generarea nu mai este permisă/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Generează întrebări" })).toBeNull();
  });
});

describe("R9: Generare tab -- starting generation", () => {
  it("asks for confirmation before starting, and does nothing if declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    getGenerationStatus.mockResolvedValue(statusWithBrief());
    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Generare" }));
    await click(await screen.findByRole("button", { name: "Generează întrebări" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(startGeneration).not.toHaveBeenCalled();
  });

  it("a successful generation shows a summary message with draft/rejected counts", async () => {
    getGenerationStatus.mockResolvedValue(statusWithBrief());
    startGeneration.mockResolvedValue({ status: "succeeded", draftCount: 3, rejectedCount: 1 });
    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Generare" }));
    await click(await screen.findByRole("button", { name: "Generează întrebări" }));
    expect(startGeneration).toHaveBeenCalledWith("trip-1", 5);
    expect(await screen.findByText(/3 întrebări noi/)).toBeTruthy();
    expect(screen.getByText(/1 respinse de validare/)).toBeTruthy();
  });

  it("a failed generation shows the failure reason, and the button remains usable for retry", async () => {
    getGenerationStatus.mockResolvedValue(statusWithBrief());
    startGeneration.mockResolvedValue({ status: "failed", reason: "Furnizorul AI nu a răspuns la timp. Încearcă din nou." });
    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Generare" }));
    await click(await screen.findByRole("button", { name: "Generează întrebări" }));
    expect(await screen.findByText(/nu a răspuns la timp/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generează întrebări" })).toBeTruthy();
  });

  it("an already_running response shows that message", async () => {
    getGenerationStatus.mockResolvedValue(statusWithBrief());
    startGeneration.mockResolvedValue({ status: "already_running", error: "O generare este deja în desfășurare pentru această călătorie." });
    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Generare" }));
    await click(await screen.findByRole("button", { name: "Generează întrebări" }));
    expect(await screen.findByText(/deja în desfășurare/i)).toBeTruthy();
  });
});

describe("R9: Generare tab -- draft review (accept/edit/reject/regenerate)", () => {
  it("shows a pending draft marked explicitly as a draft, with its options and explanation", async () => {
    getGenerationStatus.mockResolvedValue(statusWithBrief({ drafts: [draft()] }));
    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Generare" }));
    expect(await screen.findByText("DRAFT")).toBeTruthy();
    expect(screen.getByText("Ce insulă găzduiește Achilleion?")).toBeTruthy();
    expect(screen.getByText(/Corfu/)).toBeTruthy();
    expect(screen.getByText(/Achilleion a fost construit/)).toBeTruthy();
  });

  it("never shows a message implying content was already generated or auto-adapted for an unresolved draft", async () => {
    getGenerationStatus.mockResolvedValue(statusWithBrief({ drafts: [draft()] }));
    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Generare" }));
    await screen.findByText("DRAFT");
    expect(screen.queryByText(/verificat automat/i)).toBeNull();
    expect(screen.queryByText(/adaptat automat/i)).toBeNull();
  });

  it("accepting a draft calls acceptGeneratedDraft with no overrides", async () => {
    getGenerationStatus.mockResolvedValue(statusWithBrief({ drafts: [draft()] }));
    acceptGeneratedDraft.mockResolvedValue({ status: "accepted" });
    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Generare" }));
    await click(await screen.findByRole("button", { name: "Acceptă" }));
    expect(acceptGeneratedDraft).toHaveBeenCalledWith("trip-1", "draft-1", undefined);
  });

  it("editing a draft's prompt before accepting sends the edited prompt", async () => {
    getGenerationStatus.mockResolvedValue(statusWithBrief({ drafts: [draft()] }));
    acceptGeneratedDraft.mockResolvedValue({ status: "accepted" });
    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Generare" }));
    await click(await screen.findByRole("button", { name: "Editează" }));

    const promptBox = screen.getByDisplayValue("Ce insulă găzduiește Achilleion?");
    fireEvent.change(promptBox, { target: { value: "Prompt editat?" } });
    await click(screen.getByRole("button", { name: "Salvează și acceptă" }));

    expect(acceptGeneratedDraft).toHaveBeenCalledWith(
      "trip-1",
      "draft-1",
      expect.objectContaining({ prompt: "Prompt editat?" }),
    );
  });

  it("rejecting a draft calls rejectGeneratedDraft", async () => {
    getGenerationStatus.mockResolvedValue(statusWithBrief({ drafts: [draft()] }));
    rejectGeneratedDraft.mockResolvedValue(draft({ status: "rejected" }));
    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Generare" }));
    await click(await screen.findByRole("button", { name: "Respinge" }));
    expect(rejectGeneratedDraft).toHaveBeenCalledWith("trip-1", "draft-1");
  });

  it("regenerating a draft calls regenerateGeneratedDraft without losing other drafts (a second unrelated draft stays untouched)", async () => {
    const other = draft({ id: "draft-2", prompt: "A second question?" });
    getGenerationStatus.mockResolvedValue(statusWithBrief({ drafts: [draft(), other] }));
    regenerateGeneratedDraft.mockResolvedValue({ status: "succeeded", draftCount: 1, rejectedCount: 0 });
    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Generare" }));
    await screen.findByText("A second question?");

    const regenerateButtons = screen.getAllByRole("button", { name: "Regenerează" });
    await click(regenerateButtons[0]);

    expect(regenerateGeneratedDraft).toHaveBeenCalledWith("trip-1", "draft-1");
    expect(regenerateGeneratedDraft).not.toHaveBeenCalledWith("trip-1", "draft-2");
  });

  it("a resolved draft (accepted) shows its status but no action buttons", async () => {
    getGenerationStatus.mockResolvedValue(statusWithBrief({ drafts: [draft({ status: "accepted" })] }));
    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Generare" }));
    expect(await screen.findByText("Acceptat")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Acceptă" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Respinge" })).toBeNull();
  });
});
