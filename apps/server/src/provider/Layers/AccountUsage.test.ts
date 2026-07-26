import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@eflob/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";

import { AccountUsage } from "../Services/AccountUsage.ts";
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

function run<A>(body: (usage: AccountUsage) => Effect.Effect<A>): Promise<A> {
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
            utilization: 40,
            resetsAt: FUTURE_SECONDS,
          }),
        );
        yield* usage.recordRuntimeEvent(
          claudeRateLimitEvent({
            rateLimitType: "seven_day",
            utilization: 12,
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
          claudeRateLimitEvent({ rateLimitType: "five_hour", utilization: 40 }),
        );
        yield* usage.recordRuntimeEvent(
          claudeRateLimitEvent({ rateLimitType: "seven_day", utilization: 12 }),
        );
        yield* usage.recordRuntimeEvent(
          claudeRateLimitEvent({ rateLimitType: "five_hour", utilization: 65 }),
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
            utilization: 90,
            resetsAt: PAST_SECONDS,
          }),
        );
        yield* usage.recordRuntimeEvent(
          claudeRateLimitEvent({
            rateLimitType: "seven_day",
            utilization: 20,
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
          claudeRateLimitEvent({ rateLimitType: "five_hour", utilization: 10 }),
        );
        yield* usage.recordRuntimeEvent(
          claudeRateLimitEvent(
            { rateLimitType: "five_hour", utilization: 80 },
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
