import type { OrchestrationThreadActivity } from "@eflob/contracts";

/**
 * Per-conversation token usage, folded from the `turn.usage` activities the
 * server records when a turn completes.
 *
 * Kept separate from `contextWindow.ts`: that module answers "how full is the
 * context right now" from the single latest snapshot, whereas this one sums
 * across every turn in the thread. Different shapes, different cost.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type ThreadModelUsage = {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly costUsd: number | null;
};

export type ThreadUsageSummary = {
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCacheReadTokens: number;
  readonly totalCacheCreationTokens: number;
  /** Null when no turn reported a cost — providers like Codex never do. */
  readonly totalCostUsd: number | null;
  readonly turnCount: number;
  readonly models: ReadonlyArray<ThreadModelUsage>;
};

type MutableModelUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number | null;
};

function addCost(current: number | null, next: number | null): number | null {
  if (next === null) return current;
  return (current ?? 0) + next;
}

/**
 * Sum every `turn.usage` activity in the thread.
 *
 * Activities are deduped by id: the projector upserts by id so duplicates
 * should not survive, but a retried `turn.completed` would otherwise
 * double-count a turn's tokens.
 */
export function deriveThreadUsageSummary(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ThreadUsageSummary | null {
  const seenActivityIds = new Set<string>();
  const models = new Map<string, MutableModelUsage>();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCostUsd: number | null = null;
  let turnCount = 0;

  for (const activity of activities) {
    if (activity.kind !== "turn.usage") continue;
    if (seenActivityIds.has(activity.id)) continue;
    seenActivityIds.add(activity.id);

    // The payload crosses the wire as `Schema.Unknown`, so nothing here may
    // assume a shape.
    const payload = asRecord(activity.payload);
    if (!payload) continue;

    turnCount += 1;
    totalInputTokens += asFiniteNumber(payload.inputTokens) ?? 0;
    totalOutputTokens += asFiniteNumber(payload.outputTokens) ?? 0;
    totalCacheReadTokens += asFiniteNumber(payload.cacheReadInputTokens) ?? 0;
    totalCacheCreationTokens += asFiniteNumber(payload.cacheCreationInputTokens) ?? 0;
    totalCostUsd = addCost(totalCostUsd, asFiniteNumber(payload.totalCostUsd));

    const rawModels = Array.isArray(payload.models) ? payload.models : [];
    for (const rawModel of rawModels) {
      const entry = asRecord(rawModel);
      const model = entry ? asNonEmptyString(entry.model) : null;
      if (!entry || !model) continue;

      const existing = models.get(model) ?? {
        model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUsd: null,
      };
      existing.inputTokens += asFiniteNumber(entry.inputTokens) ?? 0;
      existing.outputTokens += asFiniteNumber(entry.outputTokens) ?? 0;
      existing.cacheReadInputTokens += asFiniteNumber(entry.cacheReadInputTokens) ?? 0;
      existing.cacheCreationInputTokens += asFiniteNumber(entry.cacheCreationInputTokens) ?? 0;
      existing.costUsd = addCost(existing.costUsd, asFiniteNumber(entry.costUsd));
      models.set(model, existing);
    }
  }

  if (turnCount === 0) {
    return null;
  }

  const modelTotal = (usage: MutableModelUsage) =>
    usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens;

  return {
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    totalCostUsd,
    turnCount,
    models: Array.from(models.values()).toSorted(
      (left, right) => modelTotal(right) - modelTotal(left),
    ),
  };
}

/**
 * Format a notional cost. Sub-cent values would otherwise render as "$0.00",
 * which reads as free rather than small.
 */
export function formatUsd(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value < 0.01) {
    return "<$0.01";
  }
  return `$${value.toFixed(2)}`;
}
