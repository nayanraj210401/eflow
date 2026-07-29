import type { EnvironmentId, PreviewSessionSnapshot, ScopedProjectRef } from "@eflob/contracts";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { scopeProjectRef } from "@eflob/client-runtime/environment";

import { CenterTabBar } from "~/components/CenterTabBar";
import { CenterTabsBreadcrumb } from "~/components/CenterTabsBreadcrumb";
import { shouldShowOpenInPicker } from "~/components/chat/ChatHeader";
import { OpenInPicker } from "~/components/chat/OpenInPicker";
import GitActionsControl from "~/components/GitActionsControl";
import { useAssembledRightSidebarProps } from "~/hooks/useAssembledRightSidebarProps";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { startNewThreadFromContext } from "~/lib/chatThreadActions";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useProject, useThreadShell } from "~/state/entities";
import {
  type CenterTab,
  selectActiveCenterTab,
  selectEnvironmentCenterTabsState,
  useCenterTabsStore,
} from "~/centerTabsStore";
import {
  MAX_HIDDEN_MOUNTED_CENTER_TAB_THREADS,
  reconcileRetainedMountedThreadIds,
} from "./ChatView.logic";

/**
 * Resolves "project name > thread name" for the breadcrumb row from
 * whichever thread tab was last-active (same reflection `RightSidebar`
 * already uses — see `lastActiveThreadTab` below), independent of which tab
 * kind (file/diff/plan/preview/thread) currently has focus.
 */
function useCenterTabsBreadcrumbNames(
  activeThreadTab: Extract<CenterTab, { kind: "thread" }> | undefined,
): { projectName: string | null; threadName: string | null } {
  const target = activeThreadTab?.target;

  const serverThreadRef = target?.kind === "server" ? target.threadRef : null;
  const serverShell = useThreadShell(serverThreadRef);

  const draftId = target?.kind === "draft" ? target.draftId : null;
  const draftSession = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : null,
  );

  const projectRef =
    target?.kind === "server" && serverThreadRef && serverShell
      ? scopeProjectRef(serverThreadRef.environmentId, serverShell.projectId)
      : target?.kind === "draft" && draftSession
        ? scopeProjectRef(draftSession.environmentId, draftSession.projectId)
        : null;
  const project = useProject(projectRef);

  if (!target) return { projectName: null, threadName: null };

  const threadName = target.kind === "draft" ? "New chat" : (serverShell?.title ?? "Thread");
  return { projectName: project?.title ?? null, threadName };
}

/**
 * The `OpenInPicker` and `GitActionsControl` action controls formerly
 * rendered by `ChatHeader` (per-`ChatView`), now singleton, reflecting
 * whichever `thread`-kind tab was most recently active — same reflection
 * `useCenterTabsBreadcrumbNames` above and `RightSidebarForThreadTab`
 * (`CenterTabsHostRoot.tsx`) already use.
 *
 * `ChatHeader`'s third action, `ProjectScriptsControl`, is NOT here:
 * `runProjectScript` opens/writes to this thread's live terminal dock state
 * and reports failures via a `ChatView` instance's own local error state,
 * neither of which resolve cleanly from just `{environmentId, target}` the
 * way `useAssembledRightSidebarProps` resolves everything below — so that
 * control stays rendered from within `ChatView` itself.
 */
function CenterTabsTopBarActions({
  environmentId,
  target,
}: {
  environmentId: EnvironmentId;
  target: Extract<CenterTab, { kind: "thread" }>["target"];
}) {
  const props = useAssembledRightSidebarProps({ environmentId, target });
  const primaryEnvironmentId = usePrimaryEnvironmentId();

  if (!props) return null;

  const draftId = target.kind === "draft" ? target.draftId : undefined;
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName: props.activeProject?.title,
    activeThreadEnvironmentId: props.environmentId,
    primaryEnvironmentId,
  });

  if (!showOpenInPicker && !props.activeProject) return null;

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 pr-3 pl-2 [-webkit-app-region:no-drag]"
      data-center-tabs-topbar-actions
    >
      {showOpenInPicker ? (
        <OpenInPicker
          environmentId={props.environmentId}
          keybindings={props.keybindings}
          availableEditors={props.availableEditors}
          openInCwd={props.gitCwd}
        />
      ) : null}
      {props.activeProject ? (
        <GitActionsControl
          gitCwd={props.gitCwd}
          activeThreadRef={props.activeThreadRef}
          {...(draftId ? { draftId } : {})}
        />
      ) : null}
    </div>
  );
}

/**
 * The `PanelLayoutControls` right-panel toggle icon formerly rendered by
 * `ChatView.tsx`'s own header (per-`ChatView`, and desynced from the
 * singleton `RightSidebar`), now singleton here, reflecting whichever
 * `thread`-kind tab was most recently active — same reflection
 * `CenterTabsTopBarActions` above already uses.
 *
 * The terminal-toggle button and the panel-maximize button were dropped
 * entirely per product feedback — this now renders just the right-panel
 * toggle, already fully wired via `useAssembledRightSidebarProps`.
 */
function CenterTabsPanelControls({
  environmentId,
  target,
}: {
  environmentId: EnvironmentId;
  target: Extract<CenterTab, { kind: "thread" }>["target"];
}) {
  const props = useAssembledRightSidebarProps({ environmentId, target });

  if (!props) return null;

  return (
    <div
      className="flex h-9 shrink-0 items-center gap-1 pr-2 [-webkit-app-region:no-drag]"
      data-center-tabs-panel-controls
    >
      {props.panelToggleControls}
    </div>
  );
}

/**
 * Wraps `CenterTabBar` for the case where a thread tab is (or was)
 * active, resolving `onOpenPreview`/`onOpenDiff` from the same
 * `useAssembledRightSidebarProps` used by `CenterTabsTopBarActions`/
 * `CenterTabsPanelControls` above, so the "+" menu's "Preview"/"Changes"
 * items open the exact same per-thread singleton surfaces as the existing
 * header buttons. When there's no active thread tab, the caller renders a
 * plain `CenterTabBar` instead with both callbacks `null` (disabled).
 */
function CenterTabBarWithAddActions({
  environmentId,
  target,
  onNewChat,
  projectRef,
  previewSessions,
  className,
}: {
  environmentId: EnvironmentId;
  target: Extract<CenterTab, { kind: "thread" }>["target"];
  onNewChat: () => void;
  projectRef: ScopedProjectRef;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  className?: string;
}) {
  const props = useAssembledRightSidebarProps({ environmentId, target });

  return (
    <CenterTabBar
      projectRef={projectRef}
      previewSessions={previewSessions}
      ownsDesktopTitleBar={false}
      onNewChat={onNewChat}
      onOpenPreview={props ? props.createBrowserSurface : null}
      onOpenDiff={props ? props.addDiffSurface : null}
      {...(className !== undefined ? { className } : {})}
    />
  );
}

export interface CenterTabsHostProps {
  projectRef: ScopedProjectRef | null | undefined;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  ownsDesktopTitleBar?: boolean;
  className?: string;
  /**
   * Render-prop delegation: `CenterTabsHost` stays decoupled from the large
   * amount of ambient ChatView state (`activeProject`, `activeWorkspaceRoot`,
   * `composerDraftTarget`, keybindings, etc.) that the existing
   * FilePreviewPanel/DiffPanel/PlanSidebar/preview renderers need. The caller
   * (ChatView) supplies these render functions using its existing local
   * context, so the *same* content-rendering components already used by the
   * right-panel surfaces are reused as-is here, just pointed at the active
   * centerTabsStore tab instead of the active rightPanelStore surface.
   */
  renderFileTab: (tab: Extract<CenterTab, { kind: "file" }>) => ReactNode;
  renderDiffTab: (tab: Extract<CenterTab, { kind: "diff" }>) => ReactNode;
  renderPlanTab: (tab: Extract<CenterTab, { kind: "plan" }>) => ReactNode;
  renderPreviewTab: (tab: Extract<CenterTab, { kind: "preview" }>) => ReactNode;
  /**
   * Phase 2 step 2 (VSCode-style tab layout redesign): renders one `ChatView`
   * per mounted `thread`-kind tab. `visible` tells the caller whether this
   * particular instance is the currently active tab (`hidden` wrapper vs.
   * not) — the caller should NOT conditionally render `null` based on this,
   * only toggle visibility, or the whole "backgrounded thread keeps
   * streaming" guarantee this phase exists for breaks.
   *
   * Optional and unused today: `CenterTabsHost` is currently mounted from
   * `RightSidebar.tsx`, itself a descendant of a single `ChatView` instance.
   * Rendering additional `ChatView` instances from here would be a circular
   * mount (a component rendering its own ancestor), so no current call site
   * passes this — it becomes wireable once step 3 moves `CenterTabsHost`'s
   * mount point above the router's `Outlet` (a sibling of, not a descendant
   * of, `ChatView`). The mounting/eviction logic below is built and tested
   * now so step 3 only has to wire it up, not design it.
   */
  renderThreadTab?: (
    tab: Extract<CenterTab, { kind: "thread" }>,
    options: { visible: boolean },
  ) => ReactNode;
  /**
   * Renders the singleton `RightSidebar`, reflecting whichever `thread` tab
   * was most recently active (which may lag the overall active tab if a
   * file/diff/plan/preview tab is currently focused — matching "the right
   * sidebar always reflects the last-active thread" from the design doc).
   * Same circular-mount caveat as `renderThreadTab` applies: unused until
   * step 3 relocates this host above `ChatView`.
   */
  renderRightSidebar?: (
    activeThreadTab: Extract<CenterTab, { kind: "thread" }> | null,
  ) => ReactNode;
  /** Overridable for tests; defaults to the shared cross-kind eviction budget. */
  maxHiddenMountedThreadCount?: number;
}

function isThreadTab(
  tab: CenterTab | null | undefined,
): tab is Extract<CenterTab, { kind: "thread" }> {
  return tab !== null && tab !== undefined && tab.kind === "thread";
}

/**
 * Center tabs host: renders the `CenterTabBar` plus the content of whichever
 * file/diff/plan/preview tab is active for the current environment, and
 * (Phase 2 step 2) the stay-mounted set of `thread`-kind tabs.
 *
 * If there's no active tab (or the active tab isn't one of the Phase 1
 * kinds) and there are no mounted thread tabs, this renders nothing — it is
 * additive/parallel to the existing rightPanelStore-driven UI, not a
 * replacement.
 */
export function CenterTabsHost({
  projectRef,
  previewSessions,
  ownsDesktopTitleBar,
  className,
  renderFileTab,
  renderDiffTab,
  renderPlanTab,
  renderPreviewTab,
  renderThreadTab,
  renderRightSidebar,
  maxHiddenMountedThreadCount = MAX_HIDDEN_MOUNTED_CENTER_TAB_THREADS,
}: CenterTabsHostProps) {
  const environmentId: EnvironmentId | null = projectRef?.environmentId ?? null;
  const activeTab = useCenterTabsStore((state) =>
    selectActiveCenterTab(state.byProjectKey, projectRef),
  );
  const activeTabId = useCenterTabsStore(
    (state) => selectEnvironmentCenterTabsState(state.byProjectKey, projectRef).activeTabId,
  );
  const envState = useCenterTabsStore((state) =>
    selectEnvironmentCenterTabsState(state.byProjectKey, projectRef),
  );
  const hasVisibleTabs = envState.tabIds.some((tabId) => {
    const tab = envState.tabs[tabId];
    return tab !== undefined && tab.kind !== "thread";
  });

  const openThreadTabIds = envState.tabIds.filter((tabId) => isThreadTab(envState.tabs[tabId]));

  // The "owning thread" for whichever tab is active. `centerTabsStore`
  // already tracks this correctly and persistently as `activeThreadTabId`
  // (updated whenever a thread tab opens/activates, left untouched while a
  // file/diff/plan/preview tab of that same thread is focused). This used to
  // be re-derived locally as "is the raw active tab literally a thread tab",
  // which went null any time a non-thread tab was focused, so the singleton
  // `RightSidebar` (and its `openFileSurface`/`openCenterFileTab`) could end
  // up reflecting a stale thread from before the last known-good
  // literal-thread-tab focus, misattributing newly-opened file/diff/plan/
  // preview tabs to the wrong thread (and, since the store is now
  // project-scoped, potentially the wrong project too).
  const activeThreadTabId = envState.activeThreadTabId;
  const lastActiveThreadTab = activeThreadTabId ? envState.tabs[activeThreadTabId] : undefined;

  const newThreadContext = useHandleNewThread();
  const onNewChat = useCallback(() => {
    void startNewThreadFromContext({
      activeDraftThread: newThreadContext.activeDraftThread,
      activeThread: newThreadContext.activeThread ?? undefined,
      defaultProjectRef: newThreadContext.defaultProjectRef,
      handleNewThread: newThreadContext.handleNewThread,
    });
  }, [newThreadContext]);

  // Least-recently-active-first eviction of backgrounded thread mounts,
  // generalizing `reconcileRetainedMountedThreadIds` (previously
  // terminal-thread-only) across "how many hidden ChatView instances can
  // stay mounted" per the design doc's Phase 2 mounting-cap section.
  const [mountedThreadTabIds, setMountedThreadTabIds] = useState<string[]>([]);

  useEffect(() => {
    setMountedThreadTabIds((current) =>
      reconcileRetainedMountedThreadIds({
        currentThreadIds: current,
        openThreadIds: openThreadTabIds,
        activeThreadId: activeThreadTabId,
        activeThreadOpen: activeThreadTabId !== null,
        maxHiddenThreadCount: maxHiddenMountedThreadCount,
      }),
    );
    // openThreadTabIds is a fresh array each render; compare by content via
    // join so we don't spuriously reconcile (and reshuffle LRU order) when
    // nothing about the open/active set actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThreadTabIds.join(" "), activeThreadTabId, maxHiddenMountedThreadCount]);

  // Called unconditionally (before the early `return null` below) since it
  // calls hooks internally.
  const { projectName, threadName } = useCenterTabsBreadcrumbNames(
    isThreadTab(lastActiveThreadTab) ? lastActiveThreadTab : undefined,
  );

  if (!projectRef || !environmentId || (!hasVisibleTabs && mountedThreadTabIds.length === 0))
    return null;

  const content = (() => {
    if (!activeTab) return null;
    switch (activeTab.kind) {
      case "file":
        return renderFileTab(activeTab);
      case "diff":
        return renderDiffTab(activeTab);
      case "plan":
        return renderPlanTab(activeTab);
      case "preview":
        return renderPreviewTab(activeTab);
      default:
        return null;
    }
  })();

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 self-stretch bg-background"
      data-center-tabs-host
    >
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        {/*
         * The breadcrumb row is the new visual "top" of this stack, so *it*
         * (not `CenterTabBar`'s strip below it) owns the Electron
         * traffic-light-inset drag region when this host is the desktop
         * title bar owner — `CenterTabBar` is always passed `false` here so
         * the drag region isn't duplicated/fought over between the two rows.
         * `CenterTabsBreadcrumb` keeps rendering (as an empty spacer) even
         * with no project/thread to show yet whenever it owns the title bar,
         * so the drag region and traffic-light inset are never silently
         * dropped — see the guard in that component.
         */}
        <div className="flex items-stretch">
          <CenterTabsBreadcrumb
            projectName={projectName}
            threadName={threadName}
            ownsDesktopTitleBar={ownsDesktopTitleBar ?? false}
            className="min-w-0 flex-1"
          />
          {isThreadTab(lastActiveThreadTab) ? (
            <CenterTabsTopBarActions
              environmentId={environmentId}
              target={lastActiveThreadTab.target}
            />
          ) : null}
        </div>
        {/*
         * `CenterTabBar` renders `null` when there are 0 visible tabs, which
         * would silently drop `TabStrip`'s `endSlot` too if the layout
         * controls were passed through it — instead, mirror the breadcrumb
         * row above: a `flex-1` tab bar plus a `shrink-0` controls sibling,
         * so the controls stay visible even with no tabs open.
         */}
        <div className="flex items-stretch">
          {isThreadTab(lastActiveThreadTab) ? (
            <CenterTabBarWithAddActions
              environmentId={environmentId}
              target={lastActiveThreadTab.target}
              onNewChat={onNewChat}
              projectRef={projectRef}
              previewSessions={previewSessions}
              className="min-w-0 flex-1"
            />
          ) : (
            <CenterTabBar
              projectRef={projectRef}
              previewSessions={previewSessions}
              ownsDesktopTitleBar={false}
              onNewChat={onNewChat}
              onOpenPreview={null}
              onOpenDiff={null}
              className="min-w-0 flex-1"
            />
          )}
          {isThreadTab(lastActiveThreadTab) ? (
            <CenterTabsPanelControls
              environmentId={environmentId}
              target={lastActiveThreadTab.target}
            />
          ) : null}
        </div>
        {content ? <div className="flex min-h-0 flex-1 flex-col">{content}</div> : null}
        {renderThreadTab
          ? mountedThreadTabIds.map((tabId) => {
              const tab = envState.tabs[tabId];
              if (!isThreadTab(tab)) return null;
              const visible = tabId === activeTabId;
              return (
                <div key={tabId} className={visible ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                  {renderThreadTab(tab, { visible })}
                </div>
              );
            })
          : null}
      </div>
      {renderRightSidebar
        ? renderRightSidebar(isThreadTab(lastActiveThreadTab) ? lastActiveThreadTab : null)
        : null}
    </div>
  );
}
