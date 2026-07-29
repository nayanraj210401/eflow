/**
 * Normalizers turning provider turn-completion payloads into the shared
 * `TurnUsageSnapshot` shape persisted as a `turn.usage` thread activity.
 *
 * Pure and total, for the same reason as the account normalizers: the inputs
 * are raw provider passthroughs, so an unrecognized shape must yield
 * `undefined` rather than throwing inside the adapter's event path.
 */
import type { TurnModelUsage, TurnUsageSnapshot } from "@eflob/contracts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * A snapshot is worth persisting only if some token was actually counted.
 * Checks the per-model breakdown as well as the totals, because a provider can
 * report one without the other — discarding on totals alone would drop real
 * per-model data, and keeping on model presence alone would persist a row of
 * zeroes for a turn that never reached the model.
 */
function isEmptySnapshot(snapshot: TurnUsageSnapshot): boolean {
  const totals =
    (snapshot.inputTokens ?? 0) +
    (snapshot.outputTokens ?? 0) +
    (snapshot.cacheReadInputTokens ?? 0) +
    (snapshot.cacheCreationInputTokens ?? 0);
  const perModel = snapshot.models.reduce(
    (sum, model) =>
      sum +
      (model.inputTokens ?? 0) +
      (model.outputTokens ?? 0) +
      (model.cacheReadInputTokens ?? 0) +
      (model.cacheCreationInputTokens ?? 0),
    0,
  );
  return totals === 0 && perModel === 0;
}

/**
 * Normalize a Claude `SDKResultMessage`. `modelUsage` is keyed by model name
 * and each entry carries its own `costUSD`, so the per-model breakdown comes
 * for free; totals come from the top-level `usage` block, which is the
 * authoritative aggregate.
 */
export function normalizeClaudeTurnUsage(result: unknown): TurnUsageSnapshot | undefined {
  const record = asRecord(result);
  if (!record) return undefined;

  const usage = asRecord(record.usage);
  const modelUsage = asRecord(record.modelUsage);

  const models: TurnModelUsage[] = [];
  for (const [rawModel, rawEntry] of Object.entries(modelUsage ?? {})) {
    const entry = asRecord(rawEntry);
    const model =
      nonEmptyString(rawEntry && entry ? entry.canonicalModel : undefined) ??
      nonEmptyString(rawModel);
    if (!entry || !model) continue;

    const inputTokens = nonNegativeInteger(entry.inputTokens);
    const outputTokens = nonNegativeInteger(entry.outputTokens);
    const cacheReadInputTokens = nonNegativeInteger(entry.cacheReadInputTokens);
    const cacheCreationInputTokens = nonNegativeInteger(entry.cacheCreationInputTokens);
    const webSearchRequests = nonNegativeInteger(entry.webSearchRequests);
    const costUsd = finiteNumber(entry.costUSD);

    models.push({
      model,
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
      ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
      ...(webSearchRequests !== undefined && webSearchRequests > 0 ? { webSearchRequests } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
    });
  }

  const inputTokens = nonNegativeInteger(usage?.input_tokens);
  const outputTokens = nonNegativeInteger(usage?.output_tokens);
  const cacheReadInputTokens = nonNegativeInteger(usage?.cache_read_input_tokens);
  const cacheCreationInputTokens = nonNegativeInteger(usage?.cache_creation_input_tokens);
  const totalCostUsd = finiteNumber(record.total_cost_usd);
  const durationMs = nonNegativeInteger(record.duration_ms);

  const snapshot: TurnUsageSnapshot = {
    models,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
    ...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };

  return isEmptySnapshot(snapshot) ? undefined : snapshot;
}

/**
 * Normalize Codex's last-turn token usage. Codex reports no cost and no
 * per-model split, so the result is a single-model breakdown with `costUsd`
 * absent — deliberately not synthesized from token counts.
 */
export function normalizeCodexTurnUsage(input: {
  readonly lastUsage: unknown;
  readonly model?: string | undefined;
}): TurnUsageSnapshot | undefined {
  const last = asRecord(input.lastUsage);
  if (!last) return undefined;

  const inputTokens = nonNegativeInteger(last.inputTokens);
  const outputTokens = nonNegativeInteger(last.outputTokens);
  const cacheReadInputTokens = nonNegativeInteger(last.cachedInputTokens);

  const model = nonEmptyString(input.model);
  const models: TurnModelUsage[] = model
    ? [
        {
          model,
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
          ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
        },
      ]
    : [];

  const snapshot: TurnUsageSnapshot = {
    models,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
  };

  return isEmptySnapshot(snapshot) ? undefined : snapshot;
}
