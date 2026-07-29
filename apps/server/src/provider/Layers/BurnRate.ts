import type {
  BurnRateLevel,
  BurnRateSnapshot,
  BurnRateSnapshots,
  ProviderInstanceId,
  ProviderRuntimeEvent,
} from "@eflob/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import { AccountUsage } from "../Services/AccountUsage.ts";
import { BurnRate, type BurnRateShape } from "../Services/BurnRate.ts";

/** How far back the trailing rate is sampled, per the burn-rate plan. */
const RATE_WINDOW_MS = 5 * 60 * 1000;
/** Sample-buffer retention: a little past the rate window so pruning never
 * starves the rate calc of its oldest still-relevant sample. */
const BUFFER_RETENTION_MS = 6 * 60 * 1000;
/** Recompute cadence — cheap in-memory arithmetic, no network/API calls. */
const RECOMPUTE_INTERVAL = Duration.seconds(12);
/** Below this, two samples are too close together for a rate to be meaningful. */
const MIN_ELAPSED_MS_FOR_RATE = 30 * 1000;

interface U5Sample {
  readonly t: number;
  readonly percent: number;
}

interface TurnUsageSample {
  readonly t: number;
  readonly model: string;
  readonly tokens: number;
  readonly costUsd: number;
}

interface InstanceState {
  u5Samples: ReadonlyArray<U5Sample>;
  /** Epoch ms the 5h window last observed for this instance resets at. */
  resetsAtMs: number | null;
  turnUsageSamples: ReadonlyArray<TurnUsageSample>;
  /** In-flight top-level turns and Task-tool subagent invocations. Not
   * time-windowed — a live gauge, not a rate. A missed terminal event (e.g. a
   * turn aborted by a connection drop) can leak an entry; accepted as a small
   * heuristic-accuracy tradeoff rather than adding TTL bookkeeping here. */
  mainActiveTurnIds: ReadonlySet<string>;
  subActiveItemIds: ReadonlySet<string>;
}

const emptyInstanceState: InstanceState = {
  u5Samples: [],
  resetsAtMs: null,
  turnUsageSamples: [],
  mainActiveTurnIds: new Set(),
  subActiveItemIds: new Set(),
};

/**
 * Runtime events carry `providerInstanceId` only once an adapter binds one;
 * mirrors `usageKeyFor` in `AccountUsage.ts` so burn-rate rows key identically
 * to the account-usage rows they augment.
 */
function usageKeyFor(event: ProviderRuntimeEvent): ProviderInstanceId {
  return (event.providerInstanceId ?? event.provider) as unknown as ProviderInstanceId;
}

function levelFor(etaMinutes: number | null, remainingMinutes: number | null): BurnRateLevel {
  if (etaMinutes === null) return "idle";
  // No reset time observed yet: too little context for a confident escalation,
  // so default to the calmest non-idle level rather than overclaiming.
  if (remainingMinutes === null || remainingMinutes <= 0) return "low";
  const ratio = etaMinutes / remainingMinutes;
  if (ratio > 2) return "low";
  if (ratio > 1) return "medium";
  if (ratio > 0.5) return "high";
  return "critical";
}

function computeFiveHour(
  samples: ReadonlyArray<U5Sample>,
  resetsAtMs: number | null,
  nowMs: number,
): BurnRateSnapshot["fiveHour"] {
  if (samples.length === 0) return null;

  const inWindow = samples.filter((sample) => sample.t >= nowMs - RATE_WINDOW_MS);
  const latest = samples[samples.length - 1]!;
  const earliest = inWindow[0] ?? latest;
  const elapsedMs = latest.t - earliest.t;

  if (elapsedMs < MIN_ELAPSED_MS_FOR_RATE) {
    return { ratePerMinute: 0, etaMinutes: null, level: "idle" };
  }

  const elapsedMinutes = elapsedMs / 60_000;
  const ratePerMinute = (latest.percent - earliest.percent) / elapsedMinutes;

  if (ratePerMinute <= 0.0001) {
    return { ratePerMinute: Math.max(ratePerMinute, 0), etaMinutes: null, level: "idle" };
  }

  const etaMinutes = (100 - latest.percent) / ratePerMinute;
  const remainingMinutes = resetsAtMs !== null ? (resetsAtMs - nowMs) / 60_000 : null;

  return { ratePerMinute, etaMinutes, level: levelFor(etaMinutes, remainingMinutes) };
}

function computeThroughput(
  samples: ReadonlyArray<TurnUsageSample>,
  nowMs: number,
): BurnRateSnapshot["throughput"] {
  const inWindow = samples.filter((sample) => sample.t >= nowMs - RATE_WINDOW_MS);
  if (inWindow.length === 0) {
    return { tokensPerSecond: 0, costPerMinuteUsd: 0, byModel: [] };
  }

  const earliestT = inWindow.reduce((min, sample) => Math.min(min, sample.t), nowMs);
  const windowSeconds = Math.max(1, Math.min(RATE_WINDOW_MS / 1000, (nowMs - earliestT) / 1000));

  const byModelTotals = new Map<string, { tokens: number; costUsd: number }>();
  let totalTokens = 0;
  let totalCostUsd = 0;
  for (const sample of inWindow) {
    totalTokens += sample.tokens;
    totalCostUsd += sample.costUsd;
    const existing = byModelTotals.get(sample.model) ?? { tokens: 0, costUsd: 0 };
    byModelTotals.set(sample.model, {
      tokens: existing.tokens + sample.tokens,
      costUsd: existing.costUsd + sample.costUsd,
    });
  }

  return {
    tokensPerSecond: totalTokens / windowSeconds,
    costPerMinuteUsd: totalCostUsd / (windowSeconds / 60),
    byModel: Array.from(byModelTotals.entries(), ([model, totals]) => ({
      model,
      tokensPerSecond: totals.tokens / windowSeconds,
      costPerMinuteUsd: totals.costUsd / (windowSeconds / 60),
    })),
  };
}

function computeSnapshot(
  instanceId: ProviderInstanceId,
  state: InstanceState,
  nowMs: number,
  nowIso: string,
): BurnRateSnapshot {
  return {
    instanceId,
    fiveHour: computeFiveHour(state.u5Samples, state.resetsAtMs, nowMs),
    throughput: computeThroughput(state.turnUsageSamples, nowMs),
    agents: {
      mainActive: state.mainActiveTurnIds.size,
      subActive: state.subActiveItemIds.size,
    },
    updatedAt: nowIso,
  };
}

function pruneOld<T extends { t: number }>(
  samples: ReadonlyArray<T>,
  nowMs: number,
): ReadonlyArray<T> {
  return samples.filter((sample) => sample.t >= nowMs - BUFFER_RETENTION_MS);
}

const makeBurnRate = Effect.gen(function* () {
  const accountUsage = yield* AccountUsage;

  const instances = yield* Ref.make<ReadonlyMap<ProviderInstanceId, InstanceState>>(new Map());
  const changes = yield* PubSub.unbounded<BurnRateSnapshots>();
  yield* Effect.addFinalizer(() => PubSub.shutdown(changes));

  const snapshotAllAt = (
    map: ReadonlyMap<ProviderInstanceId, InstanceState>,
    nowMs: number,
    nowIso: string,
  ): BurnRateSnapshots =>
    Array.from(map.entries(), ([instanceId, state]) =>
      computeSnapshot(instanceId, state, nowMs, nowIso),
    );

  const currentSnapshots = Effect.gen(function* () {
    const now = yield* DateTime.now;
    const map = yield* Ref.get(instances);
    return snapshotAllAt(map, DateTime.toEpochMillis(now), DateTime.formatIso(now));
  });

  const publishSnapshot = Effect.gen(function* () {
    yield* PubSub.publish(changes, yield* currentSnapshots);
  });

  const updateInstance = (
    key: ProviderInstanceId,
    update: (state: InstanceState) => InstanceState,
  ) =>
    Ref.update(instances, (map) => {
      const existing = map.get(key) ?? emptyInstanceState;
      const next = new Map(map);
      next.set(key, update(existing));
      return next;
    });

  // 5h quota samples come from `AccountUsage`'s already-merged snapshots
  // rather than re-parsing raw rate-limit events, so the "5h" window
  // identification logic (Claude vs Codex naming) lives in exactly one place.
  yield* Effect.forkScoped(
    Stream.runForEach(accountUsage.streamChanges, (snapshots) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const nowMs = DateTime.toEpochMillis(now);
        for (const snapshot of snapshots) {
          const fiveHourWindow = snapshot.windows.find((window) => window.label === "5h");
          if (!fiveHourWindow) continue;

          const resetsAtMs = fiveHourWindow.resetsAt ? Date.parse(fiveHourWindow.resetsAt) : null;
          yield* updateInstance(snapshot.instanceId, (state) => ({
            ...state,
            u5Samples: pruneOld(
              [...state.u5Samples, { t: nowMs, percent: fiveHourWindow.usedPercent }],
              nowMs,
            ),
            resetsAtMs: Number.isFinite(resetsAtMs) ? resetsAtMs : state.resetsAtMs,
          }));
        }
        yield* publishSnapshot;
      }),
    ),
  );

  const recordRuntimeEvent: BurnRateShape["recordRuntimeEvent"] = (event) =>
    Effect.gen(function* () {
      const key = usageKeyFor(event);
      const now = yield* DateTime.now;
      const nowMs = DateTime.toEpochMillis(now);
      let touched = true;

      switch (event.type) {
        case "turn.started": {
          if (!event.turnId) return;
          const turnId = String(event.turnId);
          yield* updateInstance(key, (state) => ({
            ...state,
            mainActiveTurnIds: new Set(state.mainActiveTurnIds).add(turnId),
          }));
          break;
        }
        case "turn.completed":
        case "turn.aborted": {
          const turnId = event.turnId ? String(event.turnId) : undefined;
          const usageSummary =
            event.type === "turn.completed" ? event.payload.usageSummary : undefined;

          yield* updateInstance(key, (state) => {
            const mainActiveTurnIds = new Set(state.mainActiveTurnIds);
            if (turnId) mainActiveTurnIds.delete(turnId);

            if (!usageSummary) {
              return { ...state, mainActiveTurnIds };
            }

            const newSamples: TurnUsageSample[] =
              usageSummary.models.length > 0
                ? usageSummary.models.map((model) => ({
                    t: nowMs,
                    model: model.model,
                    tokens:
                      (model.inputTokens ?? 0) +
                      (model.outputTokens ?? 0) +
                      (model.cacheReadInputTokens ?? 0) +
                      (model.cacheCreationInputTokens ?? 0),
                    costUsd: model.costUsd ?? 0,
                  }))
                : [
                    {
                      t: nowMs,
                      model: "unknown",
                      tokens:
                        (usageSummary.inputTokens ?? 0) +
                        (usageSummary.outputTokens ?? 0) +
                        (usageSummary.cacheReadInputTokens ?? 0) +
                        (usageSummary.cacheCreationInputTokens ?? 0),
                      costUsd: usageSummary.totalCostUsd ?? 0,
                    },
                  ];

            return {
              ...state,
              mainActiveTurnIds,
              turnUsageSamples: pruneOld([...state.turnUsageSamples, ...newSamples], nowMs),
            };
          });
          break;
        }
        case "item.started": {
          if (event.payload.itemType !== "collab_agent_tool_call" || !event.itemId) {
            touched = false;
            break;
          }
          const itemId = String(event.itemId);
          yield* updateInstance(key, (state) => ({
            ...state,
            subActiveItemIds: new Set(state.subActiveItemIds).add(itemId),
          }));
          break;
        }
        case "item.completed": {
          if (event.payload.itemType !== "collab_agent_tool_call" || !event.itemId) {
            touched = false;
            break;
          }
          const itemId = String(event.itemId);
          yield* updateInstance(key, (state) => {
            const subActiveItemIds = new Set(state.subActiveItemIds);
            subActiveItemIds.delete(itemId);
            return { ...state, subActiveItemIds };
          });
          break;
        }
        default:
          touched = false;
      }

      if (touched) yield* publishSnapshot;
    });

  // Fixed recompute tick: keeps the ETA countdown and level badge live between
  // real sample arrivals (e.g. as the trailing window ages a stale spike out),
  // not just when a new event happens to land.
  yield* Effect.forkScoped(Effect.repeat(publishSnapshot, Schedule.spaced(RECOMPUTE_INTERVAL)));

  const service: BurnRateShape = {
    recordRuntimeEvent,
    get getSnapshots() {
      return currentSnapshots;
    },
    get streamChanges() {
      return Stream.fromPubSub(changes);
    },
  };

  return service;
});

export const BurnRateLive = Layer.effect(BurnRate, makeBurnRate);
