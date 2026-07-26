/**
 * Normalizers turning provider-specific rate-limit payloads into the shared
 * `ProviderAccountUsageWindow` shape.
 *
 * These are deliberately pure and total: the payloads arrive as
 * `Schema.Unknown` on `account.rate-limits.updated` (raw provider passthroughs),
 * so every read is defensive and an unrecognized shape yields no windows rather
 * than throwing.
 *
 * Two provider quirks drive the design, and both are handled by the caller
 * merging results into accumulated state rather than replacing it:
 *
 *   - Claude emits one `rate_limit_event` per window, so a single event can
 *     only ever describe the 5h window *or* the 7d window, never both.
 *   - Codex emits a sparse snapshot and documents that clients must merge
 *     available values into the previously observed snapshot.
 */
import type { ProviderAccountUsageStatus, ProviderAccountUsageWindow } from "@eflob/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Both SDKs report reset times as epoch **seconds**. Guard the conversion: a
 * unit mix-up silently produces dates in 1970 or the year 57000, which would
 * then either hide a live window or pin a stale one forever.
 */
function epochSecondsToIso(value: unknown): string | undefined {
  const seconds = asFiniteNumber(value);
  if (seconds === undefined || seconds <= 0) return undefined;
  return Option.match(DateTime.make(seconds * 1000), {
    onNone: () => undefined,
    onSome: (dateTime) => DateTime.formatIso(dateTime),
  });
}

function statusFromClaude(value: unknown): ProviderAccountUsageStatus | undefined {
  switch (value) {
    case "allowed":
      return "ok";
    case "allowed_warning":
      return "warning";
    case "rejected":
      return "exhausted";
    default:
      return undefined;
  }
}

/** Canonical slugs for the window kinds we recognize; anything else passes through. */
const CLAUDE_WINDOW_MINUTES: Record<string, number> = {
  five_hour: 5 * 60,
  seven_day: 7 * 24 * 60,
  seven_day_opus: 7 * 24 * 60,
  seven_day_sonnet: 7 * 24 * 60,
  seven_day_overage_included: 7 * 24 * 60,
};

/**
 * Render a window duration the way users think about their quota ("5h", "7d")
 * rather than exposing the provider's internal window naming.
 */
export function formatWindowLabel(windowMinutes: number | undefined): string | undefined {
  if (windowMinutes === undefined || windowMinutes <= 0) return undefined;
  if (windowMinutes % (24 * 60) === 0) return `${windowMinutes / (24 * 60)}d`;
  if (windowMinutes % 60 === 0) return `${windowMinutes / 60}h`;
  return `${windowMinutes}m`;
}

/**
 * Normalize one Claude `rate_limit_event`. The runtime event wraps the raw SDK
 * message, so accept either the message itself or a `{ rateLimits: message }`
 * envelope.
 */
export function normalizeClaudeRateLimitEvent(
  raw: unknown,
  observedAt: string,
): ProviderAccountUsageWindow | undefined {
  const outer = asRecord(raw);
  if (!outer) return undefined;
  const message = asRecord(outer.rateLimits) ?? outer;
  const info = asRecord(message.rate_limit_info);
  if (!info) return undefined;

  const utilization = asFiniteNumber(info.utilization);
  if (utilization === undefined) return undefined;

  // Unknown `rateLimitType` values pass through rather than being dropped —
  // upstream adds window kinds and a hidden window is worse than an unlabelled
  // one. `unknown` only appears when the provider omitted the field entirely.
  const key = asNonEmptyString(info.rateLimitType) ?? "unknown";
  const windowMinutes = CLAUDE_WINDOW_MINUTES[key];
  const resetsAt = epochSecondsToIso(info.resetsAt);
  const status = statusFromClaude(info.status);
  const label = formatWindowLabel(windowMinutes);

  return {
    key,
    usedPercent: clampPercent(utilization),
    observedAt,
    ...(label ? { label } : {}),
    ...(resetsAt ? { resetsAt } : {}),
    ...(windowMinutes !== undefined ? { windowMinutes } : {}),
    ...(status ? { status } : {}),
  };
}

function normalizeCodexWindow(
  key: string,
  raw: unknown,
  observedAt: string,
): ProviderAccountUsageWindow | undefined {
  const window = asRecord(raw);
  if (!window) return undefined;
  const usedPercent = asFiniteNumber(window.usedPercent);
  if (usedPercent === undefined) return undefined;

  const windowMinutes = asFiniteNumber(window.windowDurationMins);
  const resetsAt = epochSecondsToIso(window.resetsAt);
  const label = formatWindowLabel(windowMinutes);

  return {
    key,
    usedPercent: clampPercent(usedPercent),
    observedAt,
    ...(label ? { label } : {}),
    ...(resetsAt ? { resetsAt } : {}),
    ...(windowMinutes !== undefined && windowMinutes > 0
      ? { windowMinutes: Math.round(windowMinutes) }
      : {}),
  };
}

/**
 * Normalize a Codex `account/rateLimits/updated` snapshot. Updates are sparse,
 * so only the windows actually present are returned — the caller merges them
 * over previously observed windows instead of replacing the set.
 */
export function normalizeCodexRateLimitsSnapshot(
  raw: unknown,
  observedAt: string,
): { windows: ReadonlyArray<ProviderAccountUsageWindow>; planLabel?: string } {
  const outer = asRecord(raw);
  if (!outer) return { windows: [] };
  // The runtime event nests the notification under `rateLimits`, and the
  // notification nests the snapshot under `rateLimits` again.
  const notification = asRecord(outer.rateLimits) ?? outer;
  const snapshot = asRecord(notification.rateLimits) ?? notification;

  const windows: ProviderAccountUsageWindow[] = [];
  const primary = normalizeCodexWindow("primary", snapshot.primary, observedAt);
  if (primary) windows.push(primary);
  const secondary = normalizeCodexWindow("secondary", snapshot.secondary, observedAt);
  if (secondary) windows.push(secondary);

  const planLabel = asNonEmptyString(snapshot.planType);
  return { windows, ...(planLabel ? { planLabel } : {}) };
}

/**
 * Normalize an `account.updated` payload into the account/plan labels shown
 * alongside the bars. Covers Codex's `{ account: { authMode, planType } }`.
 */
export function normalizeAccountLabels(raw: unknown): {
  accountLabel?: string;
  planLabel?: string;
} {
  const outer = asRecord(raw);
  if (!outer) return {};
  const account = asRecord(outer.account) ?? outer;
  const accountLabel = asNonEmptyString(account.email) ?? asNonEmptyString(account.authMode);
  const planLabel =
    asNonEmptyString(account.planType) ?? asNonEmptyString(account.subscriptionType);
  return {
    ...(accountLabel ? { accountLabel } : {}),
    ...(planLabel ? { planLabel } : {}),
  };
}
