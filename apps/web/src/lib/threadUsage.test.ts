import { describe, expect, it } from "vite-plus/test";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@eflob/contracts";

import { deriveThreadUsageSummary, formatUsd } from "./threadUsage";

function makeActivity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt: "2026-07-26T00:00:00.000Z",
  };
}

function turnUsage(id: string, payload: unknown) {
  return makeActivity(id, "turn.usage", payload);
}

describe("deriveThreadUsageSummary", () => {
  it("sums usage across turns and groups by model", () => {
    const summary = deriveThreadUsageSummary([
      turnUsage("a-1", {
        inputTokens: 100,
        outputTokens: 200,
        cacheReadInputTokens: 1_000,
        cacheCreationInputTokens: 50,
        totalCostUsd: 0.1,
        models: [{ model: "opus", inputTokens: 100, outputTokens: 200, costUsd: 0.1 }],
      }),
      makeActivity("a-2", "tool.started", {}),
      turnUsage("a-3", {
        inputTokens: 30,
        outputTokens: 70,
        cacheReadInputTokens: 500,
        cacheCreationInputTokens: 10,
        totalCostUsd: 0.05,
        models: [
          { model: "opus", inputTokens: 20, outputTokens: 50, costUsd: 0.04 },
          { model: "haiku", inputTokens: 10, outputTokens: 20, costUsd: 0.01 },
        ],
      }),
    ]);

    expect(summary).toEqual({
      totalInputTokens: 130,
      totalOutputTokens: 270,
      totalCacheReadTokens: 1_500,
      totalCacheCreationTokens: 60,
      totalCostUsd: 0.15000000000000002,
      turnCount: 2,
      models: [
        {
          model: "opus",
          inputTokens: 120,
          outputTokens: 250,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUsd: 0.14,
        },
        {
          model: "haiku",
          inputTokens: 10,
          outputTokens: 20,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUsd: 0.01,
        },
      ],
    });
  });

  it("sorts models by total tokens descending", () => {
    const summary = deriveThreadUsageSummary([
      turnUsage("a-1", {
        inputTokens: 1,
        models: [
          { model: "small", inputTokens: 5, outputTokens: 5 },
          { model: "large", inputTokens: 500, outputTokens: 500 },
        ],
      }),
    ]);

    expect(summary?.models.map((model) => model.model)).toEqual(["large", "small"]);
  });

  it("dedupes activities by id so a retried turn cannot double-count", () => {
    const payload = {
      inputTokens: 100,
      outputTokens: 50,
      models: [{ model: "opus", inputTokens: 100, outputTokens: 50 }],
    };
    const summary = deriveThreadUsageSummary([
      turnUsage("duplicate", payload),
      turnUsage("duplicate", payload),
    ]);

    expect(summary?.turnCount).toBe(1);
    expect(summary?.totalInputTokens).toBe(100);
    expect(summary?.models[0]?.inputTokens).toBe(100);
  });

  it("reports a null cost when no turn provided one", () => {
    const summary = deriveThreadUsageSummary([
      turnUsage("a-1", {
        inputTokens: 10,
        outputTokens: 20,
        models: [{ model: "gpt-5-codex", inputTokens: 10, outputTokens: 20 }],
      }),
    ]);

    expect(summary?.totalCostUsd).toBeNull();
    expect(summary?.models[0]?.costUsd).toBeNull();
  });

  it("ignores malformed payloads and non-usage activities", () => {
    const summary = deriveThreadUsageSummary([
      turnUsage("a-1", null),
      turnUsage("a-2", { inputTokens: "lots", outputTokens: 5, models: [{ model: "" }, "junk"] }),
    ]);

    // The null payload is not a countable turn; the malformed-but-object one is.
    expect(summary?.turnCount).toBe(1);
    expect(summary?.totalInputTokens).toBe(0);
    expect(summary?.totalOutputTokens).toBe(5);
    expect(summary?.models).toEqual([]);
  });

  it("returns null when the thread has no usage activities", () => {
    expect(deriveThreadUsageSummary([])).toBeNull();
    expect(deriveThreadUsageSummary([makeActivity("a-1", "tool.started", {})])).toBeNull();
  });
});

describe("formatUsd", () => {
  it("renders sub-cent amounts without claiming they are free", () => {
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(formatUsd(0)).toBeNull();
    expect(formatUsd(null)).toBeNull();
  });
});
