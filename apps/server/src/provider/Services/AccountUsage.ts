import type { ProviderAccountUsageSnapshot, ProviderRuntimeEvent } from "@eflob/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

/**
 * Accumulated account-level rate-limit state, keyed by provider instance.
 *
 * This state is deliberately **not** event-sourced. It is ephemeral,
 * high-frequency, re-derivable from the next provider event, and account-scoped
 * rather than thread-scoped — so it stays in the provider layer instead of
 * flowing through the orchestration decider and `orchestration_events`.
 *
 * The service exists mainly to own a merge that neither provider does for us:
 * Claude reports one window per event (so 5h and 7d arrive separately) and
 * Codex sends sparse snapshots it expects clients to merge. Overwriting on each
 * event would leave at most one window visible.
 */
export interface AccountUsageShape {
  /**
   * Fold an `account.rate-limits.updated` or `account.updated` runtime event
   * into the accumulated snapshots. Unrecognized payloads are ignored.
   */
  readonly recordRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;

  /** Current snapshots with expired windows filtered out. */
  readonly getSnapshots: Effect.Effect<ReadonlyArray<ProviderAccountUsageSnapshot>>;

  /**
   * Emits the full snapshot list whenever it changes. A getter on the
   * implementation so each consumer gets a fresh subscription rather than
   * sharing one already-started channel.
   */
  readonly streamChanges: Stream.Stream<ReadonlyArray<ProviderAccountUsageSnapshot>>;
}

export class AccountUsage extends Context.Service<AccountUsage, AccountUsageShape>()(
  "eflob/provider/Services/AccountUsage",
) {}
