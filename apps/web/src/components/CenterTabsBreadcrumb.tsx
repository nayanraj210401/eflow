import { cn } from "~/lib/utils";

export interface CenterTabsBreadcrumbProps {
  /** Display name of the currently-open project, if any is resolved yet. */
  projectName: string | null;
  /**
   * Display name of the active thread (per the design ask: "project name >
   * current thread name"), reflecting whichever thread tab was most recently
   * active — mirrors the same "last-active thread" reflection `RightSidebar`
   * already uses, so this stays in sync even while a file/diff/plan/preview
   * tab is focused instead of a thread tab.
   */
  threadName: string | null;
  /**
   * Whether this row sits at the very top of the window and therefore owns
   * the Electron traffic-light-inset drag region. `CenterTabBar` already has
   * this concept (`ownsDesktopTitleBar`) for its own tab strip; when this
   * breadcrumb row is rendered above that strip, the breadcrumb becomes the
   * new visual "top" of the stack, so *it* (not the tab strip below it) is
   * the one that should own the drag region — callers must pass
   * `ownsDesktopTitleBar={false}` to the sibling `CenterTabBar` in that case.
   * See `CenterTabsHost.tsx` for the call site that keeps these two in sync.
   */
  ownsDesktopTitleBar?: boolean;
  className?: string;
}

/**
 * Static, non-interactive breadcrumb row rendered directly above
 * `CenterTabBar`'s tab strip (VSCode/Cursor-style: "project > current
 * thread"). Deliberately has no dropdown/chevron/menu — it is a read-only
 * label, not a navigation control. Purely additive/visual: it does not read
 * from or write to any tab/routing state itself, only renders whatever
 * `projectName`/`threadName` its caller already resolved.
 */
export function CenterTabsBreadcrumb({
  projectName,
  threadName,
  ownsDesktopTitleBar,
  className,
}: CenterTabsBreadcrumbProps) {
  // Even with nothing to show yet, a row that owns the desktop title bar must
  // still render — otherwise its drag-region/traffic-light inset disappears
  // along with it, and whatever renders below (e.g. `CenterTabBar`'s tab
  // strip) ends up flush under the traffic lights with no protection at all.
  if (!projectName && !threadName && !ownsDesktopTitleBar) return null;

  return (
    <div
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 border-b border-border/60 pr-3 text-xs text-muted-foreground select-none",
        ownsDesktopTitleBar ? "pl-[var(--workspace-titlebar-content-left)] drag-region" : "pl-3",
        className,
      )}
      data-center-tabs-breadcrumb
    >
      {projectName ? (
        <span className="truncate font-medium text-foreground/80" title={projectName}>
          {projectName}
        </span>
      ) : null}
      {projectName && threadName ? (
        <span aria-hidden className="shrink-0 text-muted-foreground/60">
          /
        </span>
      ) : null}
      {threadName ? (
        <span className="truncate" title={threadName}>
          {threadName}
        </span>
      ) : null}
    </div>
  );
}
