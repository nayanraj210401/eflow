import type {
  ProviderAccountUsageSnapshot,
  ProviderAccountUsageWindow,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderRuntimeEvent,
} from "@eflob/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import {
  normalizeAccountLabels,
  normalizeClaudeRateLimitEvent,
  normalizeCodexRateLimitsSnapshot,
} from "../Usage/normalizeAccountUsage.ts";
import { AccountUsage, type AccountUsageShape } from "../Services/AccountUsage.ts";

/** Driver kinds whose rate-limit payloads follow the Claude SDK shape. */
const CLAUDE_DRIVERS = new Set(["claudeAgent", "claude"]);

/**
 * Runtime events carry `providerInstanceId` only once an adapter binds one.
 * Fall back to the driver kind so a snapshot still appears; the consequence is
 * that two accounts on the same driver would share a bar, which is why the
 * adapters populate the instance id on their event bases.
 */
function usageKeyFor(event: ProviderRuntimeEvent): ProviderInstanceId {
  return (event.providerInstanceId ?? event.provider) as unknown as ProviderInstanceId;
}

function isExpired(window: ProviderAccountUsageWindow, nowMs: number): boolean {
  if (!window.resetsAt) return false;
  const resetsAtMs = Date.parse(window.resetsAt);
  return Number.isFinite(resetsAtMs) && resetsAtMs <= nowMs;
}

/**
 * Merge freshly observed windows over the accumulated set, keyed by window key,
 * and drop any previously observed window that has since reset and was not
 * refreshed by this update. Without the prune, a window that rolls over while
 * nothing is running would keep displaying its final pre-reset percentage.
 */
function mergeWindows(
  existing: ReadonlyArray<ProviderAccountUsageWindow>,
  incoming: ReadonlyArray<ProviderAccountUsageWindow>,
  nowMs: number,
): ReadonlyArray<ProviderAccountUsageWindow> {
  const merged = new Map<string, ProviderAccountUsageWindow>();
  for (const window of existing) {
    if (isExpired(window, nowMs)) continue;
    merged.set(window.key, window);
  }
  for (const window of incoming) {
    merged.set(window.key, window);
  }
  return Array.from(merged.values());
}

function pruneSnapshot(
  snapshot: ProviderAccountUsageSnapshot,
  nowMs: number,
): ProviderAccountUsageSnapshot {
  return { ...snapshot, windows: snapshot.windows.filter((window) => !isExpired(window, nowMs)) };
}

const makeAccountUsage = Effect.gen(function* () {
  const snapshots = yield* Ref.make<ReadonlyMap<ProviderInstanceId, ProviderAccountUsageSnapshot>>(
    new Map(),
  );
  const changes = yield* PubSub.unbounded<ReadonlyArray<ProviderAccountUsageSnapshot>>();
  yield* Effect.addFinalizer(() => PubSub.shutdown(changes));

  /** Visible snapshots: expired windows removed, empty snapshots dropped. */
  const visible = (
    map: ReadonlyMap<ProviderInstanceId, ProviderAccountUsageSnapshot>,
    nowMs: number,
  ): ReadonlyArray<ProviderAccountUsageSnapshot> =>
    Array.from(map.values(), (snapshot) => pruneSnapshot(snapshot, nowMs)).filter(
      (snapshot) => snapshot.windows.length > 0,
    );

  const recordRuntimeEvent: AccountUsageShape["recordRuntimeEvent"] = (event) =>
    Effect.gen(function* () {
      if (event.type !== "account.rate-limits.updated" && event.type !== "account.updated") {
        return;
      }

      const now = yield* DateTime.now;
      const nowMs = DateTime.toEpochMillis(now);
      const observedAt = DateTime.formatIso(now);
      const key = usageKeyFor(event);
      const driver = event.provider as unknown as ProviderDriverKind;

      let windows: ReadonlyArray<ProviderAccountUsageWindow> = [];
      let planLabel: string | undefined;
      let accountLabel: string | undefined;

      if (event.type === "account.updated") {
        const labels = normalizeAccountLabels(event.payload.account);
        accountLabel = labels.accountLabel;
        planLabel = labels.planLabel;
      } else if (CLAUDE_DRIVERS.has(String(event.provider))) {
        const window = normalizeClaudeRateLimitEvent(event.payload.rateLimits, observedAt);
        windows = window ? [window] : [];
      } else {
        const result = normalizeCodexRateLimitsSnapshot(event.payload.rateLimits, observedAt);
        windows = result.windows;
        planLabel = result.planLabel;
      }

      if (windows.length === 0 && !planLabel && !accountLabel) {
        return;
      }

      const next = yield* Ref.modify(snapshots, (current) => {
        const existing = current.get(key);
        const merged: ProviderAccountUsageSnapshot = {
          instanceId: key,
          driver,
          windows: mergeWindows(existing?.windows ?? [], windows, nowMs),
          updatedAt: observedAt,
          // Labels arrive on their own events and must not be cleared by a
          // rate-limit update that does not carry them.
          ...((accountLabel ?? existing?.accountLabel)
            ? { accountLabel: accountLabel ?? existing?.accountLabel }
            : {}),
          ...((planLabel ?? existing?.planLabel)
            ? { planLabel: planLabel ?? existing?.planLabel }
            : {}),
        };
        const updated = new Map(current);
        updated.set(key, merged);
        return [visible(updated, nowMs), updated];
      });

      yield* Effect.logDebug("account usage snapshot recorded", {
        instanceId: key,
        driver,
        windowKeys: next.flatMap((snapshot) => snapshot.windows.map((window) => window.key)),
      });

      yield* PubSub.publish(changes, next);
    });

  const service: AccountUsageShape = {
    recordRuntimeEvent,
    get getSnapshots() {
      return Effect.gen(function* () {
        const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
        return visible(yield* Ref.get(snapshots), nowMs);
      });
    },
    get streamChanges() {
      return Stream.fromPubSub(changes);
    },
  };

  return service;
});

export const AccountUsageLive = Layer.effect(AccountUsage, makeAccountUsage);
