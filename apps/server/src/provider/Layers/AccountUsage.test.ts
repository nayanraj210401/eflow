import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@eflob/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";

import { AccountUsage, type AccountUsageShape } from "../Services/AccountUsage.ts";
import { AccountUsageLive } from "./AccountUsage.ts";

const CLAUDE = ProviderDriverKind.make("claudeAgent");
const CODEX = ProviderDriverKind.make("codex");
const INSTANCE = ProviderInstanceId.make("claude_work");

/** Fixed epoch seconds either side of any plausible test clock. */
const FUTURE_SECONDS = 4_102_444_800; // 2100-01-01
const PAST_SECONDS = 946_684_800; // 2000-01-01
const CREATED_AT = "2026-07-26T00:00:00.000Z";

let eventCounter = 0;

function claudeRateLimitEvent(
  info: Record<string, unknown>,
  overrides: { instanceId?: ProviderInstanceId } = {},
): ProviderRuntimeEvent {
  eventCounter += 1;
  return {
    type: "account.rate-limits.updated",
    eventId: EventId.make(`evt-${eventCounter}`),
    provider: CLAUDE,
    createdAt: CREATED_AT,
    threadId: ThreadId.make("thread-1"),
    providerInstanceId: overrides.instanceId ?? INSTANCE,
    payload: { rateLimits: { type: "rate_limit_event", rate_limit_info: info } },
    providerRefs: {},
  } as ProviderRuntimeEvent;
}

function claudeGetUsageEvent(response: Record<string, unknown>): ProviderRuntimeEvent {
  eventCounter += 1;
  return {
    type: "account.rate-limits.updated",
    eventId: EventId.make(`evt-${eventCounter}`),
    provider: CLAUDE,
    createdAt: CREATED_AT,
    threadId: ThreadId.make("thread-1"),
    providerInstanceId: INSTANCE,
    payload: { rateLimits: { source: "claude-get-usage", data: response } },
    providerRefs: {},
  } as ProviderRuntimeEvent;
}

function codexRateLimitEvent(snapshot: Record<string, unknown>): ProviderRuntimeEvent {
  eventCounter += 1;
  return {
    type: "account.rate-limits.updated",
    eventId: EventId.make(`evt-${eventCounter}`),
    provider: CODEX,
    createdAt: CREATED_AT,
    threadId: ThreadId.make("thread-2"),
    providerInstanceId: ProviderInstanceId.make("codex_default"),
    payload: { rateLimits: { rateLimits: snapshot } },
    providerRefs: {},
  } as ProviderRuntimeEvent;
}

function run<A>(body: (usage: AccountUsageShape) => Effect.Effect<A>): Promise<A> {
  return Effect.gen(function* () {
    const usage = yield* AccountUsage;
    return yield* body(usage);
  }).pipe(Effect.provide(AccountUsageLive), Effect.scoped, Effect.runPromise);
}

describe("AccountUsage", () => {
  it("keeps 5h and 7d windows from separate Claude events", async () => {
    const snapshots = await run((usage) =>
      Effect.gen(function* () {
        yield* usage.recordRuntimeEvent(
          claudeRateLimitEvent({
            rateLimitType: "five_hour",
            utilization: 0.4,
            resetsAt: FUTURE_SECONDS,
          }),
        );
        yield* usage.recordRuntimeEvent(
          claudeRateLimitEvent({
            rateLimitType: "seven_day",
            utilization: 0.12,
            resetsAt: FUTURE_SECONDS,
          }),
        );
        return yield* usage.getSnapshots;
      }),
    );

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.windows.map((window) => window.key)).toEqual(["five_hour", "seven_day"]);
    expect(snapshots[0]?.windows.map((window) => window.usedPercent)).toEqual([40, 12]);
  });

  it("replaces only the window key an update carries", async () => {
    const snapshots = await run((usage) =>
      Effect.gen(function* () {
        yield* usage.recordRuntimeEvent(
          claudeRateLimitEvent({ rateLimitType: "five_hour", utilization: 0.4 }),
        );
        yield* usage.recordRuntimeEvent(
          claudeRateLimitEvent({ rateLimitType: "seven_day", utilization: 0.12 }),
        );
        yield* usage.recordRuntimeEvent(
          claudeRateLimitEvent({ rateLimitType: "five_hour", utilization: 0.65 }),
        );
        return yield* usage.getSnapshots;
      }),
    );

    const windows = snapshots[0]?.windows ?? [];
    expect(windows.find((window) => window.key === "five_hour")?.usedPercent).toBe(65);
    expect(windows.find((window) => window.key === "seven_day")?.usedPercent).toBe(12);
  });

  it("prunes windows whose reset time has passed", async () => {
    const snapshots = await run((usage) =>
      Effect.gen(function* () {
        yield* usage.recordRuntimeEvent(
          claudeRateLimitEvent({
            rateLimitType: "five_hour",
            utilization: 0.9,
            resetsAt: PAST_SECONDS,
          }),
        );
        yield* usage.recordRuntimeEvent(
          claudeRateLimitEvent({
            rateLimitType: "seven_day",
            utilization: 0.2,
            resetsAt: FUTURE_SECONDS,
          }),
        );
        return yield* usage.getSnapshots;
      }),
    );

    expect(snapshots[0]?.windows.map((window) => window.key)).toEqual(["seven_day"]);
  });

  it("separates snapshots by provider instance", async () => {
    const snapshots = await run((usage) =>
      Effect.gen(function* () {
        yield* usage.recordRuntimeEvent(
          claudeRateLimitEvent({ rateLimitType: "five_hour", utilization: 0.1 }),
        );
        yield* usage.recordRuntimeEvent(
          claudeRateLimitEvent(
            { rateLimitType: "five_hour", utilization: 0.8 },
            { instanceId: ProviderInstanceId.make("claude_personal") },
          ),
        );
        return yield* usage.getSnapshots;
      }),
    );

    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((snapshot) => snapshot.instanceId).toSorted()).toEqual([
      "claude_personal",
      "claude_work",
    ]);
  });

  it("merges sparse Codex updates and retains the plan label", async () => {
    const snapshots = await run((usage) =>
      Effect.gen(function* () {
        yield* usage.recordRuntimeEvent(
          codexRateLimitEvent({
            planType: "pro",
            primary: { usedPercent: 20, windowDurationMins: 300 },
            secondary: { usedPercent: 5, windowDurationMins: 10_080 },
          }),
        );
        // Sparse follow-up: only `primary`, and no plan type.
        yield* usage.recordRuntimeEvent(
          codexRateLimitEvent({ primary: { usedPercent: 55, windowDurationMins: 300 } }),
        );
        return yield* usage.getSnapshots;
      }),
    );

    const snapshot = snapshots[0];
    expect(snapshot?.planLabel).toBe("pro");
    expect(snapshot?.windows.find((window) => window.key === "primary")?.usedPercent).toBe(55);
    expect(snapshot?.windows.find((window) => window.key === "secondary")?.usedPercent).toBe(5);
  });

  it("prefers the get_usage payload over the streamed event, which can lack utilization", async () => {
    const snapshots = await run((usage) =>
      Effect.gen(function* () {
        // Streamed event with no utilization at all — the exact shape seen
        // live on an account with overage disabled at the org level. On its
        // own this contributes nothing.
        yield* usage.recordRuntimeEvent(
          claudeRateLimitEvent({
            status: "allowed",
            rateLimitType: "five_hour",
            overageStatus: "rejected",
            overageDisabledReason: "org_level_disabled_until",
          }),
        );
        const snapshotsAfterStreamedEvent = yield* usage.getSnapshots;

        // The get_usage fallback carries the real percentage.
        yield* usage.recordRuntimeEvent(
          claudeGetUsageEvent({
            subscription_type: "pro",
            rate_limits: {
              five_hour: { utilization: 33, resets_at: "2026-08-01T00:00:00.000Z" },
            },
          }),
        );

        return { snapshotsAfterStreamedEvent, final: yield* usage.getSnapshots };
      }),
    );

    expect(snapshots.snapshotsAfterStreamedEvent).toEqual([]);
    expect(snapshots.final[0]?.planLabel).toBe("pro");
    expect(snapshots.final[0]?.windows[0]?.usedPercent).toBe(33);
  });

  it("ignores unrelated events and unrecognized payloads", async () => {
    const snapshots = await run((usage) =>
      Effect.gen(function* () {
        yield* usage.recordRuntimeEvent(claudeRateLimitEvent({ rateLimitType: "five_hour" }));
        yield* usage.recordRuntimeEvent({
          type: "turn.completed",
          eventId: EventId.make("evt-turn"),
          provider: CLAUDE,
          createdAt: CREATED_AT,
          threadId: ThreadId.make("thread-1"),
          payload: { state: "completed" },
          providerRefs: {},
        } as ProviderRuntimeEvent);
        return yield* usage.getSnapshots;
      }),
    );

    expect(snapshots).toEqual([]);
  });
});
