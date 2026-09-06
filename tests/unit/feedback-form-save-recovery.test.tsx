// R4 interaction test (2026-09-06 batch): FeedbackForm must preserve
// answers on a failed submit, never show the "sent" confirmation before
// the save actually completes, and not double-submit on a slow request.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { FeedbackForm } from "@/components/FeedbackForm";

const submitFeedback = vi.fn();
vi.mock("@/lib/feedback", () => ({
  submitFeedback: (...args: unknown[]) => submitFeedback(...args),
}));

const trackEvent = vi.fn();
vi.mock("@/lib/analytics", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

beforeEach(() => {
  submitFeedback.mockReset();
  trackEvent.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

function fillRequiredAnswers() {
  // Both ScaleQuestion sections render buttons 1-5 -- the first group is
  // "learned new things", the second is "generated conversations".
  fireEvent.click(screen.getAllByRole("button", { name: "4" })[0]);
  fireEvent.click(screen.getAllByRole("button", { name: "5" })[1]);
  // "Da" is also an option label in both the "searched more" (yes/no) and
  // "anticipated next" (da/uneori/nu) choice groups -- index 0 is the
  // former, index 1 the latter.
  const daButtons = screen.getAllByRole("button", { name: "Da" });
  fireEvent.click(daButtons[0]);
  fireEvent.click(daButtons[1]);
  fireEvent.click(screen.getByRole("button", { name: "Cu siguranță" }));
  fireEvent.change(screen.getByPlaceholderText("Opțional"), { target: { value: "Mai multe hărți" } });
}

describe("R4: FeedbackForm -- error preserves answers, no premature confirmation, no double submit", () => {
  it("a failed submit shows an error, keeps the typed comment, and does not call onSubmitted", async () => {
    submitFeedback.mockRejectedValueOnce(new Error("network down"));
    const onSubmitted = vi.fn();
    render(<FeedbackForm tripId="trip-1" participantId="participant-1" onSubmitted={onSubmitted} />);

    fillRequiredAnswers();
    await click(screen.getByRole("button", { name: "TRIMITE" }));

    await screen.findByText(/Nu am putut trimite răspunsurile/i);
    expect(onSubmitted).not.toHaveBeenCalled();
    expect((screen.getByPlaceholderText("Opțional") as HTMLTextAreaElement).value).toBe("Mai multe hărți");

    const retryButton = screen.getByRole("button", { name: "ÎNCEARCĂ DIN NOU" });
    submitFeedback.mockResolvedValueOnce(undefined);
    await click(retryButton);

    expect(submitFeedback).toHaveBeenCalledTimes(2);
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it("a slow submit disables re-submission until it resolves", async () => {
    let resolveSubmit!: () => void;
    submitFeedback.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    const onSubmitted = vi.fn();
    render(<FeedbackForm tripId="trip-1" participantId="participant-1" onSubmitted={onSubmitted} />);

    fillRequiredAnswers();
    const submitButton = screen.getByRole("button", { name: "TRIMITE" });
    await click(submitButton);
    // Still pending -- a second click must not fire a second call, and the
    // "sent" callback must not have run yet either.
    await click(submitButton);

    expect(submitFeedback).toHaveBeenCalledTimes(1);
    expect(onSubmitted).not.toHaveBeenCalled();

    await act(async () => {
      resolveSubmit();
      await Promise.resolve();
    });
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });
});

describe("R4-fix3: FeedbackForm's request id -- stable across a bare retry, fresh after an actual edit", () => {
  it("retrying without changing anything reuses the same request id", async () => {
    submitFeedback.mockRejectedValueOnce(new Error("network down"));
    render(<FeedbackForm tripId="trip-1" participantId="participant-1" onSubmitted={vi.fn()} />);
    fillRequiredAnswers();
    await click(screen.getByRole("button", { name: "TRIMITE" }));
    await screen.findByText(/Nu am putut trimite răspunsurile/i);

    submitFeedback.mockResolvedValueOnce(undefined);
    await click(screen.getByRole("button", { name: "ÎNCEARCĂ DIN NOU" }));

    expect(submitFeedback).toHaveBeenCalledTimes(2);
    const [, firstRequestId] = submitFeedback.mock.calls[0];
    const [, secondRequestId] = submitFeedback.mock.calls[1];
    expect(secondRequestId).toBe(firstRequestId);
  });

  it("changing an answer before retrying gets a NEW request id -- a correction is a new attempt, not the old one repeated", async () => {
    submitFeedback.mockRejectedValueOnce(new Error("network down"));
    render(<FeedbackForm tripId="trip-1" participantId="participant-1" onSubmitted={vi.fn()} />);
    fillRequiredAnswers();
    await click(screen.getByRole("button", { name: "TRIMITE" }));
    await screen.findByText(/Nu am putut trimite răspunsurile/i);

    // Corrects the comment before retrying.
    fireEvent.change(screen.getByPlaceholderText("Opțional"), { target: { value: "De fapt, altceva" } });
    submitFeedback.mockResolvedValueOnce(undefined);
    await click(screen.getByRole("button", { name: "ÎNCEARCĂ DIN NOU" }));

    expect(submitFeedback).toHaveBeenCalledTimes(2);
    const [, firstRequestId] = submitFeedback.mock.calls[0];
    const [, secondRequestId] = submitFeedback.mock.calls[1];
    expect(secondRequestId).not.toBe(firstRequestId);
  });
});

describe("R4-fix4: FeedbackForm -- a slow/hanging analytics call never delays the confirmation", () => {
  it("calls onSubmitted even while trackEvent is still pending", async () => {
    submitFeedback.mockResolvedValueOnce(undefined);
    trackEvent.mockReset().mockReturnValue(new Promise(() => {})); // never resolves
    const onSubmitted = vi.fn();
    render(<FeedbackForm tripId="trip-1" participantId="participant-1" onSubmitted={onSubmitted} />);

    fillRequiredAnswers();
    await click(screen.getByRole("button", { name: "TRIMITE" }));

    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });
});
