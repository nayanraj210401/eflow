import { describe, expect, it } from "vite-plus/test";

import {
  formatWindowLabel,
  normalizeAccountLabels,
  normalizeClaudeRateLimitEvent,
  normalizeCodexRateLimitsSnapshot,
} from "./normalizeAccountUsage.ts";

const OBSERVED_AT = "2026-07-26T00:00:00.000Z";

// Epoch seconds — both SDKs report seconds, not millis. The expected ISO value
// is written out literally so a unit mix-up in the normalizer cannot be
// mirrored by the same mistake in the test.
const RESETS_AT_SECONDS = 1_785_042_000;
const RESETS_AT_ISO = "2026-07-26T05:00:00.000Z";

function claudeEvent(info: Record<string, unknown>) {
  return { rateLimits: { type: "rate_limit_event", rate_limit_info: info } };
}

describe("normalizeClaudeRateLimitEvent", () => {
  it("normalizes a five_hour window", () => {
    const window = normalizeClaudeRateLimitEvent(
      claudeEvent({
        status: "allowed",
        rateLimitType: "five_hour",
        utilization: 42.5,
        resetsAt: RESETS_AT_SECONDS,
      }),
      OBSERVED_AT,
    );

    expect(window).toEqual({
      key: "five_hour",
      label: "5h",
      usedPercent: 42.5,
      resetsAt: RESETS_AT_ISO,
      windowMinutes: 300,
      status: "ok",
      observedAt: OBSERVED_AT,
    });
  });

  it("labels seven_day windows in days", () => {
    const window = normalizeClaudeRateLimitEvent(
      claudeEvent({ status: "allowed_warning", rateLimitType: "seven_day", utilization: 91 }),
      OBSERVED_AT,
    );

    expect(window?.label).toBe("7d");
    expect(window?.windowMinutes).toBe(10_080);
    expect(window?.status).toBe("warning");
    expect(window?.resetsAt).toBeUndefined();
  });

  it("passes unknown rateLimitType values through instead of dropping the window", () => {
    const window = normalizeClaudeRateLimitEvent(
      claudeEvent({ status: "rejected", rateLimitType: "thirty_day_future", utilization: 100 }),
      OBSERVED_AT,
    );

    expect(window?.key).toBe("thirty_day_future");
    expect(window?.label).toBeUndefined();
    expect(window?.status).toBe("exhausted");
  });

  it("falls back to an unknown key when rateLimitType is absent", () => {
    const window = normalizeClaudeRateLimitEvent(
      claudeEvent({ status: "allowed", utilization: 10 }),
      OBSERVED_AT,
    );

    expect(window?.key).toBe("unknown");
  });

  it("clamps utilization into 0..100", () => {
    const over = normalizeClaudeRateLimitEvent(
      claudeEvent({ rateLimitType: "five_hour", utilization: 140 }),
      OBSERVED_AT,
    );
    const under = normalizeClaudeRateLimitEvent(
      claudeEvent({ rateLimitType: "five_hour", utilization: -5 }),
      OBSERVED_AT,
    );

    expect(over?.usedPercent).toBe(100);
    expect(under?.usedPercent).toBe(0);
  });

  it("accepts the raw SDK message without the runtime envelope", () => {
    const window = normalizeClaudeRateLimitEvent(
      { type: "rate_limit_event", rate_limit_info: { rateLimitType: "five_hour", utilization: 7 } },
      OBSERVED_AT,
    );

    expect(window?.usedPercent).toBe(7);
  });

  it("returns nothing when utilization is missing or the payload is unrecognized", () => {
    expect(
      normalizeClaudeRateLimitEvent(claudeEvent({ rateLimitType: "five_hour" }), OBSERVED_AT),
    ).toBeUndefined();
    expect(normalizeClaudeRateLimitEvent({ nonsense: true }, OBSERVED_AT)).toBeUndefined();
    expect(normalizeClaudeRateLimitEvent(null, OBSERVED_AT)).toBeUndefined();
  });
});

describe("normalizeCodexRateLimitsSnapshot", () => {
  it("normalizes primary and secondary windows and the plan label", () => {
    const result = normalizeCodexRateLimitsSnapshot(
      {
        rateLimits: {
          rateLimits: {
            planType: "pro",
            primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: RESETS_AT_SECONDS },
            secondary: { usedPercent: 12, windowDurationMins: 10_080 },
          },
        },
      },
      OBSERVED_AT,
    );

    expect(result.planLabel).toBe("pro");
    expect(result.windows).toEqual([
      {
        key: "primary",
        label: "5h",
        usedPercent: 30,
        resetsAt: RESETS_AT_ISO,
        windowMinutes: 300,
        observedAt: OBSERVED_AT,
      },
      {
        key: "secondary",
        label: "7d",
        usedPercent: 12,
        windowMinutes: 10_080,
        observedAt: OBSERVED_AT,
      },
    ]);
  });

  it("returns only the windows present in a sparse update", () => {
    const result = normalizeCodexRateLimitsSnapshot(
      { rateLimits: { rateLimits: { primary: { usedPercent: 55, windowDurationMins: 300 } } } },
      OBSERVED_AT,
    );

    expect(result.windows).toHaveLength(1);
    expect(result.windows[0]?.key).toBe("primary");
    expect(result.planLabel).toBeUndefined();
  });

  it("returns no windows for an unrecognized payload", () => {
    expect(normalizeCodexRateLimitsSnapshot(null, OBSERVED_AT).windows).toEqual([]);
    expect(normalizeCodexRateLimitsSnapshot({ rateLimits: {} }, OBSERVED_AT).windows).toEqual([]);
  });
});

describe("formatWindowLabel", () => {
  it("prefers days, then hours, then minutes", () => {
    expect(formatWindowLabel(10_080)).toBe("7d");
    expect(formatWindowLabel(300)).toBe("5h");
    expect(formatWindowLabel(90)).toBe("90m");
    expect(formatWindowLabel(0)).toBeUndefined();
    expect(formatWindowLabel(undefined)).toBeUndefined();
  });
});

describe("normalizeAccountLabels", () => {
  it("reads Codex account notifications", () => {
    expect(normalizeAccountLabels({ account: { authMode: "chatgpt", planType: "pro" } })).toEqual({
      accountLabel: "chatgpt",
      planLabel: "pro",
    });
  });

  it("prefers an email when present and tolerates unknown payloads", () => {
    expect(
      normalizeAccountLabels({ account: { email: "a@b.com", subscriptionType: "Claude Max 5x" } }),
    ).toEqual({ accountLabel: "a@b.com", planLabel: "Claude Max 5x" });
    expect(normalizeAccountLabels(null)).toEqual({});
  });
});
