import { describe, expect, it } from "vite-plus/test";

import { normalizeClaudeTurnUsage, normalizeCodexTurnUsage } from "./normalizeTurnUsage.ts";

describe("normalizeClaudeTurnUsage", () => {
  it("normalizes totals and a multi-model breakdown", () => {
    const snapshot = normalizeClaudeTurnUsage({
      total_cost_usd: 0.42,
      duration_ms: 12_345,
      usage: {
        input_tokens: 100,
        output_tokens: 250,
        cache_read_input_tokens: 9_000,
        cache_creation_input_tokens: 1_200,
      },
      modelUsage: {
        "claude-opus-4-8": {
          inputTokens: 80,
          outputTokens: 200,
          cacheReadInputTokens: 8_000,
          cacheCreationInputTokens: 1_000,
          webSearchRequests: 0,
          costUSD: 0.4,
        },
        "claude-haiku-4-5": {
          inputTokens: 20,
          outputTokens: 50,
          cacheReadInputTokens: 1_000,
          cacheCreationInputTokens: 200,
          webSearchRequests: 2,
          costUSD: 0.02,
        },
      },
    });

    expect(snapshot).toEqual({
      inputTokens: 100,
      outputTokens: 250,
      cacheReadInputTokens: 9_000,
      cacheCreationInputTokens: 1_200,
      totalCostUsd: 0.42,
      durationMs: 12_345,
      models: [
        {
          model: "claude-opus-4-8",
          inputTokens: 80,
          outputTokens: 200,
          cacheReadInputTokens: 8_000,
          cacheCreationInputTokens: 1_000,
          costUsd: 0.4,
        },
        {
          model: "claude-haiku-4-5",
          inputTokens: 20,
          outputTokens: 50,
          cacheReadInputTokens: 1_000,
          cacheCreationInputTokens: 200,
          webSearchRequests: 2,
          costUsd: 0.02,
        },
      ],
    });
  });

  it("prefers canonicalModel over the modelUsage key", () => {
    const snapshot = normalizeClaudeTurnUsage({
      usage: { input_tokens: 5, output_tokens: 5 },
      modelUsage: {
        "anthropic/claude-opus-4.6": {
          inputTokens: 5,
          outputTokens: 5,
          canonicalModel: "opus-4.6",
        },
      },
    });

    expect(snapshot?.models[0]?.model).toBe("opus-4.6");
  });

  it("omits cost when the result did not report one", () => {
    const snapshot = normalizeClaudeTurnUsage({
      usage: { input_tokens: 10, output_tokens: 20 },
      modelUsage: { "claude-sonnet-5": { inputTokens: 10, outputTokens: 20 } },
    });

    expect(snapshot?.totalCostUsd).toBeUndefined();
    expect(snapshot?.models[0]?.costUsd).toBeUndefined();
  });

  it("returns nothing for empty or unrecognized results", () => {
    expect(normalizeClaudeTurnUsage(null)).toBeUndefined();
    expect(normalizeClaudeTurnUsage({})).toBeUndefined();
    expect(
      normalizeClaudeTurnUsage({ usage: { input_tokens: 0, output_tokens: 0 }, modelUsage: {} }),
    ).toBeUndefined();
  });
});

describe("normalizeCodexTurnUsage", () => {
  it("produces a single-model breakdown with no cost", () => {
    const snapshot = normalizeCodexTurnUsage({
      lastUsage: { inputTokens: 1_500, outputTokens: 300, cachedInputTokens: 1_200 },
      model: "gpt-5-codex",
    });

    expect(snapshot).toEqual({
      inputTokens: 1_500,
      outputTokens: 300,
      cacheReadInputTokens: 1_200,
      models: [
        {
          model: "gpt-5-codex",
          inputTokens: 1_500,
          outputTokens: 300,
          cacheReadInputTokens: 1_200,
        },
      ],
    });
    expect(snapshot?.totalCostUsd).toBeUndefined();
  });

  it("still reports totals when the model is unknown", () => {
    const snapshot = normalizeCodexTurnUsage({
      lastUsage: { inputTokens: 10, outputTokens: 4 },
      model: undefined,
    });

    expect(snapshot?.models).toEqual([]);
    expect(snapshot?.inputTokens).toBe(10);
  });

  it("returns nothing when there is no usage", () => {
    expect(normalizeCodexTurnUsage({ lastUsage: null, model: "gpt-5-codex" })).toBeUndefined();
    expect(
      normalizeCodexTurnUsage({ lastUsage: { inputTokens: 0, outputTokens: 0 }, model: "x" }),
    ).toBeUndefined();
  });
});
