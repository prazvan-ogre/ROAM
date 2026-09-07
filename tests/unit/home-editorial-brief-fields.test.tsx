// Trip editorial brief (20260909090000_trip_editorial_brief.sql):
// app/page.tsx's creation form now also collects difficulty, thematic
// distribution, and writing style, with visible/editable default
// proposals (medium/fun/equal 25-25-25-25 split) -- validated client-side
// via validateEditorialBrief before ever calling createPublicTrip
// (src/lib/publicTripCreation.ts), same real validation the server
// re-runs. Renders the real HomePage component; only createPublicTrip
// itself is mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const createPublicTrip = vi.fn();
vi.mock("@/lib/publicTripCreation", () => ({
  createPublicTrip: (...args: unknown[]) => createPublicTrip(...args),
}));

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

function fillRequiredBaseFields() {
  fireEvent.change(screen.getByLabelText("Destinație"), { target: { value: "Corfu" } });
  fireEvent.change(screen.getByLabelText("Fusul orar al destinației"), { target: { value: "Europe/Athens" } });
}

beforeEach(() => {
  push.mockClear();
  createPublicTrip.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("R9: HomePage creation form shows editable default editorial brief proposals", () => {
  it("pre-fills medium/fun/equal-25 split, all editable, and the total reads 100%", async () => {
    const { default: HomePage } = await import("../../app/page");
    render(<HomePage />);

    expect(screen.getByRole("button", { name: "Mediu" })).toBeTruthy();
    expect((screen.getByLabelText("Istorie") as HTMLInputElement).value).toBe("25");
    expect((screen.getByLabelText("Locuri de vizitat") as HTMLInputElement).value).toBe("25");
    expect((screen.getByLabelText("Gastronomie locală") as HTMLInputElement).value).toBe("25");
    expect((screen.getByLabelText("Curiozități locale") as HTMLInputElement).value).toBe("25");
    expect(screen.getByText("Total: 100%")).toBeTruthy();
  });

  it("a valid submission with the untouched defaults reaches createPublicTrip", async () => {
    createPublicTrip.mockResolvedValueOnce({ slug: "trip-xyz" });
    const { default: HomePage } = await import("../../app/page");
    render(<HomePage />);
    fillRequiredBaseFields();

    await click(screen.getByRole("button", { name: /Creează călătoria/i }));

    expect(createPublicTrip).toHaveBeenCalledTimes(1);
    const [submitted] = createPublicTrip.mock.calls[0];
    expect(submitted.brief).toEqual({
      difficulty: "medium",
      style: "fun",
      narratorCharacterName: null,
      themeHistory: 25,
      themePlaces: 25,
      themeFood: 25,
      themeCuriosities: 25,
    });
  });
});

describe("R9: HomePage creation form -- theme distribution errors", () => {
  it("a total different from 100% shows an error and never submits", async () => {
    const { default: HomePage } = await import("../../app/page");
    render(<HomePage />);
    fillRequiredBaseFields();
    fireEvent.change(screen.getByLabelText("Istorie"), { target: { value: "40" } });

    await click(screen.getByRole("button", { name: /Creează călătoria/i }));

    expect(createPublicTrip).not.toHaveBeenCalled();
    expect(screen.getByText(/Suma procentelor trebuie să fie exact 100%/i)).toBeTruthy();
  });

  it("correcting the total after a failed submit allows it through", async () => {
    createPublicTrip.mockResolvedValueOnce({ slug: "trip-xyz" });
    const { default: HomePage } = await import("../../app/page");
    render(<HomePage />);
    fillRequiredBaseFields();
    fireEvent.change(screen.getByLabelText("Istorie"), { target: { value: "40" } });
    await click(screen.getByRole("button", { name: /Creează călătoria/i }));
    expect(createPublicTrip).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Istorie"), { target: { value: "25" } });
    await click(screen.getByRole("button", { name: /Creează călătoria/i }));

    expect(createPublicTrip).toHaveBeenCalledTimes(1);
  });

  it("a 0% category is accepted as long as the total is still exactly 100", async () => {
    createPublicTrip.mockResolvedValueOnce({ slug: "trip-xyz" });
    const { default: HomePage } = await import("../../app/page");
    render(<HomePage />);
    fillRequiredBaseFields();
    fireEvent.change(screen.getByLabelText("Istorie"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Locuri de vizitat"), { target: { value: "50" } });

    await click(screen.getByRole("button", { name: /Creează călătoria/i }));

    expect(createPublicTrip).toHaveBeenCalledTimes(1);
    expect(createPublicTrip.mock.calls[0][0].brief.themeHistory).toBe(0);
  });
});

describe("R9: HomePage creation form -- narrated_by_character style", () => {
  it("selecting it reveals the character-name field, with an explanatory note", async () => {
    const { default: HomePage } = await import("../../app/page");
    render(<HomePage />);

    expect(screen.queryByLabelText("Numele personajului istoric")).toBeNull();
    await click(screen.getByRole("button", { name: "Narat de un personaj istoric" }));

    expect(screen.getByLabelText("Numele personajului istoric")).toBeTruthy();
    expect(screen.getByText(/interpretare creativă inspirată de personaj/i)).toBeTruthy();
  });

  it("submitting without a character name is rejected, with a clear field error", async () => {
    const { default: HomePage } = await import("../../app/page");
    render(<HomePage />);
    fillRequiredBaseFields();
    await click(screen.getByRole("button", { name: "Narat de un personaj istoric" }));

    await click(screen.getByRole("button", { name: /Creează călătoria/i }));

    expect(createPublicTrip).not.toHaveBeenCalled();
    expect(screen.getByText(/Introdu numele personajului istoric/i)).toBeTruthy();
  });

  it("a valid character name submits, normalized (trimmed, collapsed whitespace)", async () => {
    createPublicTrip.mockResolvedValueOnce({ slug: "trip-xyz" });
    const { default: HomePage } = await import("../../app/page");
    render(<HomePage />);
    fillRequiredBaseFields();
    await click(screen.getByRole("button", { name: "Narat de un personaj istoric" }));
    fireEvent.change(screen.getByLabelText("Numele personajului istoric"), {
      target: { value: "  Ștefan   cel  Mare " },
    });

    await click(screen.getByRole("button", { name: /Creează călătoria/i }));

    expect(createPublicTrip).toHaveBeenCalledTimes(1);
    expect(createPublicTrip.mock.calls[0][0].brief.narratorCharacterName).toBe("Ștefan cel Mare");
    expect(createPublicTrip.mock.calls[0][0].brief.style).toBe("narrated_by_character");
  });
});
