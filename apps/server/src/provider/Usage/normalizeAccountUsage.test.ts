import { describe, expect, it } from "vite-plus/test";

import {
  formatWindowLabel,
  normalizeAccountLabels,
  normalizeClaudeGetUsageResponse,
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
  it("normalizes a five_hour window, scaling the 0-1 utilization fraction", () => {
    const window = normalizeClaudeRateLimitEvent(
      claudeEvent({
        status: "allowed",
        rateLimitType: "five_hour",
        utilization: 0.425,
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

  it("reports a nearly-exhausted window as ~100%, not ~1%", () => {
    // Captured verbatim from a live session whose `/usage` reported the 5h
    // window as 100% consumed. Treating `utilization` as a percentage rendered
    // this as "1%", claiming headroom right before a cutoff.
    const window = normalizeClaudeRateLimitEvent(
      claudeEvent({
        status: "allowed_warning",
        resetsAt: 1_785_054_000,
        rateLimitType: "five_hour",
        utilization: 0.99,
        isUsingOverage: false,
        overageInUse: true,
        surpassedThreshold: 0.9,
      }),
      OBSERVED_AT,
    );

    expect(window?.usedPercent).toBeCloseTo(99, 6);
    expect(window?.status).toBe("warning");
    expect(window?.resetsAt).toBe("2026-07-26T08:20:00.000Z");
  });

  it("labels seven_day windows in days", () => {
    const window = normalizeClaudeRateLimitEvent(
      claudeEvent({ status: "allowed_warning", rateLimitType: "seven_day", utilization: 0.91 }),
      OBSERVED_AT,
    );

    expect(window?.label).toBe("7d");
    expect(window?.windowMinutes).toBe(10_080);
    expect(window?.status).toBe("warning");
    expect(window?.resetsAt).toBeUndefined();
  });

  it("passes unknown rateLimitType values through instead of dropping the window", () => {
    const window = normalizeClaudeRateLimitEvent(
      claudeEvent({ status: "rejected", rateLimitType: "thirty_day_future", utilization: 1 }),
      OBSERVED_AT,
    );

    expect(window?.key).toBe("thirty_day_future");
    expect(window?.label).toBeUndefined();
    expect(window?.status).toBe("exhausted");
  });

  it("falls back to an unknown key when rateLimitType is absent", () => {
    const window = normalizeClaudeRateLimitEvent(
      claudeEvent({ status: "allowed", utilization: 0.1 }),
      OBSERVED_AT,
    );

    expect(window?.key).toBe("unknown");
  });

  it("clamps utilization into 0..100", () => {
    const over = normalizeClaudeRateLimitEvent(
      claudeEvent({ rateLimitType: "five_hour", utilization: 1.4 }),
      OBSERVED_AT,
    );
    const under = normalizeClaudeRateLimitEvent(
      claudeEvent({ rateLimitType: "five_hour", utilization: -0.05 }),
      OBSERVED_AT,
    );

    expect(over?.usedPercent).toBe(100);
    expect(under?.usedPercent).toBe(0);
  });

  it("accepts the raw SDK message without the runtime envelope", () => {
    const window = normalizeClaudeRateLimitEvent(
      {
        type: "rate_limit_event",
        rate_limit_info: { rateLimitType: "five_hour", utilization: 0.07 },
      },
      OBSERVED_AT,
    );

    expect(window?.usedPercent).toBeCloseTo(7, 6);
  });

  it("returns nothing when utilization is missing or the payload is unrecognized", () => {
    // Observed live on an account with overage disabled at the org level: the
    // event still fires (status/resetsAt/overage fields present) but omits
    // `utilization` entirely. Dropping the window here is intentional — the
    // fallback is `normalizeClaudeGetUsageResponse`, which always has a percent.
    expect(
      normalizeClaudeRateLimitEvent(
        claudeEvent({
          status: "allowed",
          rateLimitType: "five_hour",
          overageStatus: "rejected",
          overageDisabledReason: "org_level_disabled_until",
          isUsingOverage: false,
        }),
        OBSERVED_AT,
      ),
    ).toBeUndefined();
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

describe("normalizeClaudeGetUsageResponse", () => {
  it("normalizes every window at once, already 0-100, with ISO reset times", () => {
    const result = normalizeClaudeGetUsageResponse(
      {
        subscription_type: "pro",
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 33, resets_at: "2026-07-26T18:50:00.000Z" },
          seven_day: { utilization: 12, resets_at: "2026-08-01T18:29:00.000Z" },
        },
      },
      OBSERVED_AT,
    );

    expect(result.planLabel).toBe("pro");
    expect(result.windows).toEqual([
      {
        key: "five_hour",
        label: "5h",
        usedPercent: 33,
        resetsAt: "2026-07-26T18:50:00.000Z",
        windowMinutes: 300,
        observedAt: OBSERVED_AT,
      },
      {
        key: "seven_day",
        label: "7d",
        usedPercent: 12,
        resetsAt: "2026-08-01T18:29:00.000Z",
        windowMinutes: 10_080,
        observedAt: OBSERVED_AT,
      },
    ]);
  });

  it("is the fallback for the case the streamed event can't cover: no utilization, org overage disabled", () => {
    // This is the exact shape observed live from `rate_limit_event` on an
    // account with overage disabled at the org level (no `utilization`
    // field at all). `normalizeClaudeGetUsageResponse` is queried
    // separately via the `/usage` control request, which always reports a
    // percentage, so the account still gets a bar.
    const result = normalizeClaudeGetUsageResponse(
      {
        subscription_type: "max",
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 33, resets_at: "2026-07-26T18:50:00.000Z" },
        },
      },
      OBSERVED_AT,
    );

    expect(result.windows).toHaveLength(1);
    expect(result.windows[0]?.usedPercent).toBe(33);
  });

  it("skips windows with a null utilization or reset time", () => {
    const result = normalizeClaudeGetUsageResponse(
      {
        rate_limits: {
          five_hour: { utilization: null, resets_at: null },
          seven_day: { utilization: 5, resets_at: null },
        },
      },
      OBSERVED_AT,
    );

    expect(result.windows).toHaveLength(1);
    expect(result.windows[0]?.key).toBe("seven_day");
    expect(result.windows[0]?.resetsAt).toBeUndefined();
  });

  it("includes per-model windows, labelled by their display name", () => {
    const result = normalizeClaudeGetUsageResponse(
      {
        rate_limits: {
          model_scoped: [
            { display_name: "Fable", utilization: 50, resets_at: "2026-08-01T00:00:00.000Z" },
          ],
        },
      },
      OBSERVED_AT,
    );

    expect(result.windows).toEqual([
      {
        key: "model:Fable",
        label: "Fable",
        usedPercent: 50,
        resetsAt: "2026-08-01T00:00:00.000Z",
        observedAt: OBSERVED_AT,
      },
    ]);
  });

  it("returns no windows when rate limits are unavailable (API-key sessions)", () => {
    expect(
      normalizeClaudeGetUsageResponse(
        { rate_limits_available: false, rate_limits: null },
        OBSERVED_AT,
      ).windows,
    ).toEqual([]);
    expect(normalizeClaudeGetUsageResponse(null, OBSERVED_AT).windows).toEqual([]);
    expect(normalizeClaudeGetUsageResponse({ nonsense: true }, OBSERVED_AT).windows).toEqual([]);
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
