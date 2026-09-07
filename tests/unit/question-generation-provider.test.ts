// R9: src/lib/ai/questionGenerationProvider.ts -- the fake provider's
// deterministic output, the factory's provider selection (never assumes
// a key is configured), and the real Anthropic provider's own
// timeout/rate-limit/generic-error mapping (via a mocked SDK -- no real
// network call).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  FakeQuestionGenerationProvider,
  getQuestionGenerationProvider,
  AiProviderError,
  AnthropicQuestionGenerationProvider,
  type GenerationRequest,
} from "@/lib/ai/questionGenerationProvider";

const baseRequest: GenerationRequest = {
  destination: "Corfu",
  style: "fun",
  narratorCharacterName: null,
  slots: [
    { dayNumber: 1, slot: "morning", themeCategory: "history", difficulty: "medium" },
    { dayNumber: 1, slot: "lunch", themeCategory: "food", difficulty: "medium" },
  ],
};

describe("FakeQuestionGenerationProvider", () => {
  it("returns one valid-shaped JSON item per requested slot, in the same order", async () => {
    const provider = new FakeQuestionGenerationProvider();
    const result = await provider.generateQuestions(baseRequest);
    const items = JSON.parse(result.raw);
    expect(items).toHaveLength(2);
    expect(items[0].dayNumber).toBe(1);
    expect(items[0].slot).toBe("morning");
    expect(items[0].themeCategory).toBe("history");
    expect(items[1].slot).toBe("lunch");
    expect(items[1].themeCategory).toBe("food");
    for (const item of items) {
      expect(typeof item.prompt).toBe("string");
      expect(item.prompt.length).toBeGreaterThan(0);
      expect(Array.isArray(item.options)).toBe(true);
      expect(item.options.filter((o: { is_correct: boolean }) => o.is_correct)).toHaveLength(1);
    }
  });

  it("is deterministic -- the same request produces the same output", async () => {
    const provider = new FakeQuestionGenerationProvider();
    const a = await provider.generateQuestions(baseRequest);
    const b = await provider.generateQuestions(baseRequest);
    expect(a.raw).toBe(b.raw);
  });

  it("mentions the narrator character when style is narrated_by_character", async () => {
    const provider = new FakeQuestionGenerationProvider();
    const result = await provider.generateQuestions({
      ...baseRequest,
      style: "narrated_by_character",
      narratorCharacterName: "Ștefan cel Mare",
    });
    expect(result.raw).toContain("Ștefan cel Mare");
  });
});

describe("getQuestionGenerationProvider", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_PROVIDER;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns the fake provider when no API key is configured -- never blocks local dev/tests", () => {
    const provider = getQuestionGenerationProvider();
    expect(provider.name).toBe("fake");
  });

  it("returns the fake provider when AI_PROVIDER=fake, even with a key present", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.AI_PROVIDER = "fake";
    const provider = getQuestionGenerationProvider();
    expect(provider.name).toBe("fake");
  });

  it("returns the real Anthropic provider when a key is configured", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const provider = getQuestionGenerationProvider();
    expect(provider.name).toBe("anthropic");
  });
});

describe("AnthropicQuestionGenerationProvider -- error mapping (mocked SDK, no real network call)", () => {
  it("maps a connection timeout to AiProviderError(kind='timeout')", async () => {
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = {
          create: vi.fn().mockRejectedValue(Object.assign(new Error("timeout"), { name: "APIConnectionTimeoutError" })),
        };
      },
    }));
    const { AnthropicQuestionGenerationProvider: FreshProvider } = await import("@/lib/ai/questionGenerationProvider");
    const provider = new FreshProvider("sk-ant-test");
    await expect(provider.generateQuestions(baseRequest)).rejects.toMatchObject({ kind: "timeout" });
    vi.doUnmock("@anthropic-ai/sdk");
  });

  it("maps a 429 to AiProviderError(kind='rate_limited')", async () => {
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = {
          create: vi.fn().mockRejectedValue(Object.assign(new Error("rate limited"), { status: 429 })),
        };
      },
    }));
    const { AnthropicQuestionGenerationProvider: FreshProvider } = await import("@/lib/ai/questionGenerationProvider");
    const provider = new FreshProvider("sk-ant-test");
    await expect(provider.generateQuestions(baseRequest)).rejects.toMatchObject({ kind: "rate_limited" });
    vi.doUnmock("@anthropic-ai/sdk");
  });

  it("maps any other SDK error to a generic AiProviderError(kind='provider_error')", async () => {
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = {
          create: vi.fn().mockRejectedValue(new Error("something else broke")),
        };
      },
    }));
    const { AnthropicQuestionGenerationProvider: FreshProvider } = await import("@/lib/ai/questionGenerationProvider");
    const provider = new FreshProvider("sk-ant-test");
    await expect(provider.generateQuestions(baseRequest)).rejects.toMatchObject({ kind: "provider_error" });
    vi.doUnmock("@anthropic-ai/sdk");
  });

  it("AiProviderError never carries the raw SDK error message -- only a safe, generic reason", async () => {
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = {
          create: vi.fn().mockRejectedValue(new Error("SENSITIVE INTERNAL DETAIL")),
        };
      },
    }));
    const { AnthropicQuestionGenerationProvider: FreshProvider } = await import("@/lib/ai/questionGenerationProvider");
    const provider = new FreshProvider("sk-ant-test");
    try {
      await provider.generateQuestions(baseRequest);
      throw new Error("expected generateQuestions to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(AiProviderError);
      expect((err as Error).message).not.toContain("SENSITIVE INTERNAL DETAIL");
    }
    vi.doUnmock("@anthropic-ai/sdk");
  });
});
