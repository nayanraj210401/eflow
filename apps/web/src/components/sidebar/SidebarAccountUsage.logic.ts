import type {
  ProviderAccountUsageSnapshots,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@eflob/contracts";

import { formatProviderDisplayName } from "../../lib/contextWindow";

/**
 * View model for the sidebar footer usage bars. Kept out of the component so
 * the filtering, ordering and threshold rules are testable without React.
 */

export type AccountUsageTone = "ok" | "warning" | "exhausted";

export type AccountUsageRow = {
  readonly id: string;
  /** Matches `BurnRateSnapshot.instanceId`, so the component can pair a row
   * with its burn-rate detail without re-deriving the id split. */
  readonly instanceId: ProviderInstanceId;
  /** Kept alongside `providerLabel` so the component can render a per-driver
   * icon — with multiple providers reporting usage, the label text alone
   * doesn't scan quickly at a glance. */
  readonly driver: ProviderDriverKind;
  readonly providerLabel: string;
  /** Duration label such as "5h" or "7d", falling back to the raw window key. */
  readonly windowLabel: string;
  readonly usedPercent: number;
  readonly resetsAt: string | null;
  readonly accountLabel: string | null;
  readonly planLabel: string | null;
  readonly tone: AccountUsageTone;
};

const WARNING_THRESHOLD = 80;

/**
 * How many bars stay permanently visible. Claude can report `seven_day_opus`,
 * `seven_day_sonnet` and overage windows on top of the main two, which would
 * otherwise grow the footer without bound; the remainder is still reachable in
 * the hover popover.
 */
export const VISIBLE_ACCOUNT_USAGE_ROWS = 2;

function toneFor(usedPercent: number, status: string | undefined): AccountUsageTone {
  if (status === "exhausted" || usedPercent >= 100) return "exhausted";
  if (status === "warning" || usedPercent >= WARNING_THRESHOLD) return "warning";
  return "ok";
}

/**
 * Build the display rows.
 *
 * Windows whose reset time has passed are dropped: `accountUsage` is replayed
 * from the client's on-disk config cache on a cold start, so without this a
 * stale percentage from a previous session would be presented as current.
 */
export function buildAccountUsageRows(
  snapshots: ProviderAccountUsageSnapshots,
  nowIso: string,
): ReadonlyArray<AccountUsageRow> {
  const nowMs = Date.parse(nowIso);
  const rows: AccountUsageRow[] = [];

  for (const snapshot of snapshots) {
    for (const window of snapshot.windows) {
      if (window.resetsAt) {
        const resetsAtMs = Date.parse(window.resetsAt);
        if (Number.isFinite(resetsAtMs) && Number.isFinite(nowMs) && resetsAtMs <= nowMs) {
          continue;
        }
      }

      rows.push({
        id: `${snapshot.instanceId}:${window.key}`,
        instanceId: snapshot.instanceId,
        driver: snapshot.driver,
        providerLabel: formatProviderDisplayName(snapshot.driver),
        windowLabel: window.label ?? window.key,
        usedPercent: Math.max(0, Math.min(100, window.usedPercent)),
        resetsAt: window.resetsAt ?? null,
        accountLabel: snapshot.accountLabel ?? null,
        planLabel: snapshot.planLabel ?? null,
        tone: toneFor(window.usedPercent, window.status),
      });
    }
  }

  // Shortest window first, so the 5h limit — the one that actually bites during
  // a session — leads. Unlabelled windows sort last.
  return rows.toSorted((left, right) => {
    const leftMinutes = windowSortKey(left.windowLabel);
    const rightMinutes = windowSortKey(right.windowLabel);
    if (leftMinutes !== rightMinutes) return leftMinutes - rightMinutes;
    return left.id.localeCompare(right.id);
  });
}

function windowSortKey(label: string): number {
  const match = /^(\d+)([hdm])$/.exec(label);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const value = Number(match[1]);
  switch (match[2]) {
    case "m":
      return value;
    case "h":
      return value * 60;
    case "d":
      return value * 24 * 60;
    default:
      return Number.MAX_SAFE_INTEGER;
  }
}

/** Human phrasing for when a window rolls over, e.g. "resets in 2h 15m". */
export function formatResetsIn(resetsAt: string | null, nowIso: string): string | null {
  if (!resetsAt) return null;
  const resetsAtMs = Date.parse(resetsAt);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(resetsAtMs) || !Number.isFinite(nowMs)) return null;

  const remainingMinutes = Math.round((resetsAtMs - nowMs) / 60_000);
  if (remainingMinutes <= 0) return null;
  if (remainingMinutes < 60) return `resets in ${remainingMinutes}m`;

  const hours = Math.floor(remainingMinutes / 60);
  if (hours < 24) {
    const minutes = remainingMinutes % 60;
    return minutes > 0 ? `resets in ${hours}h ${minutes}m` : `resets in ${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const leftoverHours = hours % 24;
  return leftoverHours > 0 ? `resets in ${days}d ${leftoverHours}h` : `resets in ${days}d`;
}

/** Human phrasing for a burn-rate ETA, e.g. "exhausts in ~12m" or "~2h 30m". */
export function formatBurnRateEta(etaMinutes: number | null): string | null {
  if (etaMinutes === null || !Number.isFinite(etaMinutes) || etaMinutes <= 0) return null;

  const totalMinutes = Math.round(etaMinutes);
  if (totalMinutes < 1) return "exhausts in <1m";
  if (totalMinutes < 60) return `exhausts in ~${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `exhausts in ~${hours}h ${minutes}m` : `exhausts in ~${hours}h`;
}

/** Compact token throughput, e.g. "1.2k tok/s" or "48 tok/s". */
export function formatTokensPerSecond(tokensPerSecond: number): string {
  if (tokensPerSecond >= 1000) return `${(tokensPerSecond / 1000).toFixed(1)}k tok/s`;
  return `${Math.round(tokensPerSecond)} tok/s`;
}

/** Compact cost burn rate, e.g. "$0.42/min". */
export function formatCostPerMinute(costPerMinuteUsd: number): string {
  return `$${costPerMinuteUsd.toFixed(costPerMinuteUsd < 1 ? 3 : 2)}/min`;
}
