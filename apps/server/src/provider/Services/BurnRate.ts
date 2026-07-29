import type { BurnRateSnapshots, ProviderRuntimeEvent } from "@eflob/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

/**
 * Burn-rate heuristics, keyed by provider instance and derived from three
 * inputs that all arrive as `ProviderRuntimeEvent`s: `account.rate-limits.updated`
 * (the true 5h quota signal, sampled over time to get a rate), `turn.completed`
 * (tokens/cost, for the trailing throughput breakdown), and `turn.started` /
 * `item.started` / `item.completed` for the "collab_agent_tool_call" item type
 * (live main/sub-agent concurrency gauges).
 *
 * Deliberately not event-sourced, same reasoning as `AccountUsage`: ephemeral,
 * high-frequency, re-derivable from the next event.
 */
export interface BurnRateShape {
  /**
   * Fold a runtime event into the accumulated sample buffers. Event types this
   * service does not care about are ignored.
   */
  readonly recordRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;

  /** Current derived snapshots, recomputed on read. */
  readonly getSnapshots: Effect.Effect<BurnRateSnapshots>;

  /**
   * Emits the full snapshot list on a fixed recompute tick and immediately
   * after any sample that changes the underlying buffers. A getter so each
   * consumer gets its own subscription.
   */
  readonly streamChanges: Stream.Stream<BurnRateSnapshots>;
}

export class BurnRate extends Context.Service<BurnRate, BurnRateShape>()(
  "eflob/provider/Services/BurnRate",
) {}
