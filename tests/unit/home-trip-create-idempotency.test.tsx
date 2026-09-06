// R5 regression: Home's trip-creation form manages a real idempotency
// key (client_request_id, threaded through src/lib/publicTripCreation.ts
// to POST /api/trips/create) -- stable across a bare retry of a failed
// submission, reset when the person actually edits the form (a
// correction is a new attempt, not the old one repeated). Also: a slow
// submit can't be double-fired by an impatient double-click.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

const push = vi.fn();
const routerMock = { push };
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

const createPublicTrip = vi.fn();
vi.mock("@/lib/publicTripCreation", () => ({
  createPublicTrip: (...args: unknown[]) => createPublicTrip(...args),
}));

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

function fillForm() {
  fireEvent.change(screen.getByLabelText("Destinație"), { target: { value: "Corfu, Grecia" } });
}

beforeEach(() => {
  push.mockClear();
  createPublicTrip.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("R5: Home trip creation -- request id stable across a bare retry, fresh after an edit", () => {
  it("retrying without changing anything reuses the same request id", async () => {
    createPublicTrip.mockRejectedValueOnce(new Error("network down"));
    const { default: HomePage } = await import("../../app/page");
    render(<HomePage />);

    fillForm();
    await click(screen.getByRole("button", { name: /Creează călătoria/i }));
    await screen.findByText("network down");

    createPublicTrip.mockResolvedValueOnce({ slug: "corfu-2027-ab12" });
    await click(screen.getByRole("button", { name: /Creează călătoria/i }));

    expect(createPublicTrip).toHaveBeenCalledTimes(2);
    const [firstArgs] = createPublicTrip.mock.calls[0];
    const [secondArgs] = createPublicTrip.mock.calls[1];
    expect(secondArgs.requestId).toBe(firstArgs.requestId);
    expect(push).toHaveBeenCalledWith("/trips?link=corfu-2027-ab12");
  });

  it("editing the destination before retrying gets a NEW request id", async () => {
    createPublicTrip.mockRejectedValueOnce(new Error("network down"));
    const { default: HomePage } = await import("../../app/page");
    render(<HomePage />);

    fillForm();
    await click(screen.getByRole("button", { name: /Creează călătoria/i }));
    await screen.findByText("network down");

    fireEvent.change(screen.getByLabelText("Destinație"), { target: { value: "Santorini, Grecia" } });
    createPublicTrip.mockResolvedValueOnce({ slug: "santorini-2027-cd34" });
    await click(screen.getByRole("button", { name: /Creează călătoria/i }));

    expect(createPublicTrip).toHaveBeenCalledTimes(2);
    const [firstArgs] = createPublicTrip.mock.calls[0];
    const [secondArgs] = createPublicTrip.mock.calls[1];
    expect(secondArgs.requestId).not.toBe(firstArgs.requestId);
  });

  it("a slow submit disables re-submission until it resolves", async () => {
    let resolveCreate!: (v: { slug: string }) => void;
    createPublicTrip.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const { default: HomePage } = await import("../../app/page");
    render(<HomePage />);

    fillForm();
    const submitButton = screen.getByRole("button", { name: /Creează călătoria/i });
    await click(submitButton);
    await click(submitButton);

    expect(createPublicTrip).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate({ slug: "corfu-2027-ab12" });
      await Promise.resolve();
    });
  });
});
