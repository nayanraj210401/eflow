/**
 * Usage contracts — account-level rate-limit windows and per-turn token usage.
 *
 * Two independent shapes live here because they have different lifetimes:
 *
 *   - `ProviderAccountUsageSnapshot` is **account-scoped and ephemeral**. It
 *     describes how much of a subscription's rolling quota has been consumed
 *     (Claude's 5h/7d windows, Codex's primary/secondary windows). It is
 *     re-derived from provider runtime events, never event-sourced.
 *
 *   - `TurnUsageSnapshot` is **turn-scoped and durable**. It records the tokens
 *     and notional cost a single assistant turn consumed, broken down by model,
 *     and is persisted as a thread activity.
 *
 * @module providerUsage
 */
import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

/**
 * Identifies which rolling quota window a usage reading describes.
 *
 * Deliberately an **open** string rather than a literal union, for the same
 * reason `ProviderDriverKind` is open: upstream providers add window kinds
 * without warning (Claude has already grown `seven_day_opus`,
 * `seven_day_sonnet`, and overage variants). A closed union would turn an
 * unrecognized value into a decode failure that drops the whole snapshot,
 * taking the windows we *do* understand down with it. Servers normalize known
 * values to the canonical slugs below and pass anything else through verbatim;
 * clients render an unknown key as-is rather than hiding it.
 *
 * Canonical slugs: `five_hour`, `seven_day`, `seven_day_opus`,
 * `seven_day_sonnet`, `overage`, `primary`, `secondary`.
 */
export const ProviderAccountUsageWindowKey = TrimmedNonEmptyString;
export type ProviderAccountUsageWindowKey = typeof ProviderAccountUsageWindowKey.Type;

/** How close to exhaustion a window is, as reported by the provider. */
export const ProviderAccountUsageStatus = Schema.Literals(["ok", "warning", "exhausted"]);
export type ProviderAccountUsageStatus = typeof ProviderAccountUsageStatus.Type;

export const ProviderAccountUsageWindow = Schema.Struct({
  key: ProviderAccountUsageWindowKey,
  /** Short human label, e.g. "5h" or "7d". Derived from the window duration. */
  label: Schema.optional(TrimmedNonEmptyString),
  /** Percentage of the window's quota consumed, clamped to 0..100. */
  usedPercent: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  /** When the window rolls over. Absent when the provider did not report one. */
  resetsAt: Schema.optional(IsoDateTime),
  windowMinutes: Schema.optional(PositiveInt),
  status: Schema.optional(ProviderAccountUsageStatus),
  /** When this reading was observed, used to age out stale windows. */
  observedAt: IsoDateTime,
});
export type ProviderAccountUsageWindow = typeof ProviderAccountUsageWindow.Type;

export const ProviderAccountUsageSnapshot = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  /** Account identity, e.g. the signed-in email. */
  accountLabel: Schema.optional(TrimmedNonEmptyString),
  /** Subscription tier, e.g. "Claude Max 5x" or Codex's plan type. */
  planLabel: Schema.optional(TrimmedNonEmptyString),
  windows: Schema.Array(ProviderAccountUsageWindow),
  updatedAt: IsoDateTime,
});
export type ProviderAccountUsageSnapshot = typeof ProviderAccountUsageSnapshot.Type;

export const ProviderAccountUsageSnapshots = Schema.Array(ProviderAccountUsageSnapshot);
export type ProviderAccountUsageSnapshots = typeof ProviderAccountUsageSnapshots.Type;

/**
 * Token usage attributed to one model within a single turn. A turn can touch
 * several models (a main model plus subagent/summarizer models), so totals are
 * reported alongside this breakdown rather than derived from it.
 */
export const TurnModelUsage = Schema.Struct({
  model: TrimmedNonEmptyString,
  inputTokens: Schema.optional(NonNegativeInt),
  outputTokens: Schema.optional(NonNegativeInt),
  cacheReadInputTokens: Schema.optional(NonNegativeInt),
  cacheCreationInputTokens: Schema.optional(NonNegativeInt),
  webSearchRequests: Schema.optional(NonNegativeInt),
  /**
   * Notional API-equivalent cost. Absent for providers that do not report cost
   * (Codex). For subscription users this is *not* money charged — see the
   * labelling in the client.
   */
  costUsd: Schema.optional(Schema.Number),
});
export type TurnModelUsage = typeof TurnModelUsage.Type;

export const TurnUsageSnapshot = Schema.Struct({
  inputTokens: Schema.optional(NonNegativeInt),
  outputTokens: Schema.optional(NonNegativeInt),
  cacheReadInputTokens: Schema.optional(NonNegativeInt),
  cacheCreationInputTokens: Schema.optional(NonNegativeInt),
  totalCostUsd: Schema.optional(Schema.Number),
  durationMs: Schema.optional(NonNegativeInt),
  models: Schema.Array(TurnModelUsage),
});
export type TurnUsageSnapshot = typeof TurnUsageSnapshot.Type;
