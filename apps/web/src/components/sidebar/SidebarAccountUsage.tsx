import { useAtomValue } from "@effect/atom-react";
import type { ProviderDriverKind } from "@eflob/contracts";
import { memo, useMemo } from "react";

import { cn } from "../../lib/utils";
import { primaryServerAccountUsageAtom } from "../../state/server";
import { getDriverOption } from "../settings/providerDriverMeta";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { useSidebar } from "../ui/sidebar";
import {
  type AccountUsageRow,
  type AccountUsageTone,
  buildAccountUsageRows,
  formatResetsIn,
  VISIBLE_ACCOUNT_USAGE_ROWS,
} from "./SidebarAccountUsage.logic";

/**
 * Per-driver mark so a row reads at a glance which provider it belongs to —
 * necessary once more than one provider can report usage side by side. Falls
 * back to nothing (not a generic placeholder) for a fork/unknown driver kind,
 * since `providerLabel` already covers that case in text.
 */
function ProviderIcon(props: { driver: ProviderDriverKind; className?: string }) {
  const DriverGlyph = getDriverOption(props.driver)?.icon;
  if (!DriverGlyph) return null;
  return <DriverGlyph className={props.className} aria-hidden="true" />;
}

const TONE_BAR_COLORS: Record<AccountUsageTone, string> = {
  ok: "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)",
  warning: "var(--color-warning)",
  exhausted: "var(--color-destructive)",
};

function UsageBar(props: { row: AccountUsageRow; compact?: boolean }) {
  const { row, compact } = props;
  return (
    <div
      className={cn("w-full overflow-hidden rounded-full bg-muted/60", compact ? "h-0.5" : "h-1")}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(row.usedPercent)}
      aria-label={`${row.providerLabel} ${row.windowLabel} usage`}
    >
      <div
        className="h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${row.usedPercent}%`, backgroundColor: TONE_BAR_COLORS[row.tone] }}
      />
    </div>
  );
}

function UsageDetailRow(props: { row: AccountUsageRow; nowIso: string }) {
  const { row, nowIso } = props;
  const resetsIn = formatResetsIn(row.resetsAt, nowIso);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 text-[11px] leading-4">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-muted-foreground/70">
          <ProviderIcon driver={row.driver} className="size-3 shrink-0" />
          <span className="truncate">
            {row.providerLabel} · {row.windowLabel}
          </span>
        </span>
        <span className="font-medium tabular-nums text-muted-foreground/80">
          {Math.round(row.usedPercent)}%
        </span>
      </div>
      <UsageBar row={row} />
      {resetsIn ? (
        <div className="text-[10px] leading-3 text-muted-foreground/50">{resetsIn}</div>
      ) : null}
    </div>
  );
}

/**
 * Account-level rate-limit bars in the sidebar footer.
 *
 * Renders nothing until a provider has actually reported a window. Claude only
 * emits `rate_limit_event` mid-session, so on a cold start there is genuinely
 * no data — and an empty 0% bar would read as "you've used none of your quota",
 * which is a claim we cannot make.
 */
export const SidebarAccountUsage = memo(function SidebarAccountUsage() {
  const snapshots = useAtomValue(primaryServerAccountUsageAtom);
  const { state, isMobile } = useSidebar();
  // Recomputed per render rather than ticked on a timer: the bars only change
  // when the server pushes an update, and a stale window is pruned on the next
  // render anyway.
  const nowIso = new Date().toISOString();
  const rows = useMemo(() => buildAccountUsageRows(snapshots, nowIso), [snapshots, nowIso]);

  if (rows.length === 0) {
    return null;
  }

  const visibleRows = rows.slice(0, VISIBLE_ACCOUNT_USAGE_ROWS);
  const isCollapsed = state === "collapsed" && !isMobile;
  const account = rows.find((row) => row.accountLabel || row.planLabel);
  const summaryLabel = rows
    .slice(0, VISIBLE_ACCOUNT_USAGE_ROWS)
    .map((row) => `${row.windowLabel} ${Math.round(row.usedPercent)}%`)
    .join(", ");

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            aria-label={`Account usage: ${summaryLabel}`}
            className={cn(
              "flex w-full cursor-default flex-col rounded-md outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              isCollapsed
                ? "gap-1 px-1.5 py-1.5"
                : "gap-1.5 px-2 py-1.5 hover:bg-sidebar-row-hover",
            )}
          >
            {visibleRows.map((row) =>
              isCollapsed ? (
                <div key={row.id} className="flex w-full items-center gap-1">
                  <ProviderIcon driver={row.driver} className="size-2.5 shrink-0" />
                  <UsageBar row={row} compact />
                </div>
              ) : (
                <div key={row.id} className="flex w-full items-center gap-2">
                  <ProviderIcon driver={row.driver} className="size-3 shrink-0" />
                  <span className="w-5 shrink-0 text-left text-[10px] font-medium tabular-nums text-sidebar-muted-foreground/70">
                    {row.windowLabel}
                  </span>
                  <UsageBar row={row} />
                  <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-sidebar-muted-foreground/70">
                    {Math.round(row.usedPercent)}%
                  </span>
                </div>
              ),
            )}
          </button>
        }
      />
      <PopoverPopup
        tooltipStyle
        // Opens upward: the trigger sits in the footer at the bottom of the
        // viewport, so a side/bottom-anchored popup would be clipped.
        side="top"
        align="start"
        className="dropdown-glass w-60 max-w-none border-0! bg-secondary! p-0 shadow-none! before:hidden"
      >
        <div className="flex flex-col gap-2.5 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-muted-foreground text-xs">Usage limits</div>
            {account?.planLabel ? (
              <div className="truncate text-[11px] text-muted-foreground/70">
                {account.planLabel}
              </div>
            ) : null}
          </div>
          {rows.map((row) => (
            <UsageDetailRow key={row.id} row={row} nowIso={nowIso} />
          ))}
          {account?.accountLabel ? (
            <div className="truncate border-t border-border/40 pt-2 text-[10px] text-muted-foreground/50">
              {account.accountLabel}
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
});
