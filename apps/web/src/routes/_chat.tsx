import { Outlet, createFileRoute, redirect, useParams } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopedThreadKey } from "@eflob/client-runtime/environment";
import type { PreviewSessionSnapshot, ScopedProjectRef } from "@eflob/contracts";
import { useEffect, useMemo } from "react";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { useClientSettings } from "../hooks/useSettings";
import { openCommandPalette } from "../commandPaletteBus";
import { CenterTabsHostRoot } from "../components/CenterTabsHostRoot";
import { useCenterTabsStore } from "../centerTabsStore";
import { useComposerDraftStore } from "../composerDraftStore";
import { useEnvironmentThreadRefs, useProjects, useThreadShell } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { selectProjectGroupingSettings } from "../logicalProject";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { dispatchPreviewAction } from "../components/preview/previewActionBus";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { resolveShortcutCommand } from "../keybindings";
import { selectThreadHasTerminalGroups, useTerminalDockStore } from "../terminalDockStore";
import { isPreviewSupportedInRuntime, useActivePreviewSessions } from "../previewStateStore";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { primaryServerKeybindingsAtom } from "~/state/server";

/**
 * The project whose tab strip should actually be shown — the one implied by
 * the current route's thread/draft, not just its environment. A single
 * environment (connection) can host many projects (repos/worktrees), and
 * `centerTabsStore` is scoped per-project so threads from different projects
 * never share a tab strip (the cross-project tab bleed this scoping fixes —
 * see the screenshot report). Resolves to `null` (no tabs shown) when no
 * thread route is active, e.g. the bare `/` chat landing, since there's no
 * thread to derive a project from.
 */
function useActiveRouteProjectRef(): ScopedProjectRef | null {
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const serverThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const serverShell = useThreadShell(serverThreadRef);
  const draftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const draftSession = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : null,
  );
  if (serverThreadRef && serverShell) {
    return scopeProjectRef(serverThreadRef.environmentId, serverShell.projectId);
  }
  if (draftSession) {
    return scopeProjectRef(draftSession.environmentId, draftSession.projectId);
  }
  return null;
}

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadKeysSize = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread, routeThreadRef } =
    useHandleNewThread();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const sidebarV2Enabled = useClientSettings((settings) => settings.sidebarV2Enabled);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupCount = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: () => null,
      }).length,
    [primaryEnvironmentId, projectGroupingSettings, projects],
  );
  const terminalOpen = useTerminalDockStore((state) =>
    routeThreadRef ? selectThreadHasTerminalGroups(state.byThreadKey, routeThreadRef) : false,
  );
  // The `previewOpen` shortcut-context flag here uses the store-only value;
  // the URL-aware arbitration lives inside ChatView's `onTogglePreview`,
  // which we invoke via the action bus to avoid duplicating the rule.
  const previewOpen = useRightPanelStore((state) =>
    routeThreadRef
      ? selectActiveRightPanel(state.byThreadKey, routeThreadRef) === "preview"
      : false,
  );
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          previewFocus: isPreviewFocused(),
          previewOpen,
        },
      });

      if (isCommandPaletteOpen()) {
        return;
      }

      if (event.key === "Escape" && selectedThreadKeysSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        void startNewThreadFromContext({
          activeDraftThread,
          activeThread: activeThread ?? undefined,
          defaultProjectRef,
          handleNewThread,
        });
        return;
      }

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        // Sidebar v2 routes creation through the command palette whenever
        // there is a real choice to make; v1 (and single-project setups)
        // keep the immediate contextual create.
        if (sidebarV2Enabled && projectGroupCount > 1) {
          openCommandPalette({ open: "new-thread-in" });
          return;
        }
        void startNewThreadFromContext({
          activeDraftThread,
          activeThread: activeThread ?? undefined,
          defaultProjectRef,
          handleNewThread,
        });
        return;
      }

      if (command === "preview.toggle") {
        event.preventDefault();
        event.stopPropagation();
        if (!routeThreadRef) return;
        if (!isPreviewSupportedInRuntime()) {
          toastManager.add(
            stackedThreadToast({
              type: "info",
              title: "Preview is desktop-only",
              description: "Open eflob in the desktop app to use the in-app preview.",
            }),
          );
          return;
        }
        dispatchPreviewAction("toggle-panel");
        return;
      }

      // The remaining preview commands only fire when the panel is the
      // currently-focused tenant. The `when: previewFocus` rule already
      // gates this, but defend against the keybinding being misconfigured.
      if (
        command === "preview.refresh" ||
        command === "preview.focusUrl" ||
        command === "preview.zoomIn" ||
        command === "preview.zoomOut" ||
        command === "preview.resetZoom"
      ) {
        event.preventDefault();
        event.stopPropagation();
        const action =
          command === "preview.refresh"
            ? "refresh"
            : command === "preview.focusUrl"
              ? "focus-url"
              : command === "preview.zoomIn"
                ? "zoom-in"
                : command === "preview.zoomOut"
                  ? "zoom-out"
                  : "reset-zoom";
        dispatchPreviewAction(action);
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    handleNewThread,
    keybindings,
    defaultProjectRef,
    previewOpen,
    projectGroupCount,
    routeThreadRef,
    selectedThreadKeysSize,
    sidebarV2Enabled,
    terminalOpen,
  ]);

  return null;
}

/**
 * Cleans up `centerTabsStore` thread tabs for threads/drafts that no longer
 * exist in the active project (deleted server threads, discarded drafts).
 * Runs alongside `CenterTabsHostRoot`'s mount so stale tabs don't linger in
 * the tab strip/persisted storage forever.
 */
function useReconcileCenterThreadTabs(projectRef: ScopedProjectRef | null) {
  const environmentId = projectRef?.environmentId ?? null;
  const environmentThreadRefs = useEnvironmentThreadRefs(environmentId);
  // Select the stable underlying record (not a derived array/object literal)
  // so zustand's default `Object.is` snapshot comparison doesn't see a "new"
  // value on every render and loop forever re-rendering.
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftIds = useMemo(
    () =>
      environmentId
        ? Object.entries(draftThreadsByThreadKey)
            .filter(([, draftThread]) => draftThread.environmentId === environmentId)
            .map(([draftId]) => draftId)
        : [],
    [draftThreadsByThreadKey, environmentId],
  );

  useEffect(() => {
    if (!projectRef) return;
    const threadKeys = new Set(environmentThreadRefs.map((ref) => scopedThreadKey(ref)));
    const draftIdSet = new Set(draftIds);
    useCenterTabsStore.getState().reconcileThreadTabs(projectRef, {
      threadKeys,
      draftIds: draftIdSet,
    });
  }, [projectRef, environmentThreadRefs, draftIds]);
}

/** Aggregates every live preview session across all threads in the environment, keyed by preview tab id, for `CenterTabBar`'s label/favicon lookups. */
function useAggregatedPreviewSessions(): Readonly<Record<string, PreviewSessionSnapshot>> {
  const previewStateByThread = useActivePreviewSessions();
  return useMemo(() => {
    const merged: Record<string, PreviewSessionSnapshot> = {};
    for (const threadPreviewState of Object.values(previewStateByThread)) {
      Object.assign(merged, threadPreviewState.sessions);
    }
    return merged;
  }, [previewStateByThread]);
}

function ChatRouteLayout() {
  const projectRef = useActiveRouteProjectRef();
  useReconcileCenterThreadTabs(projectRef);
  const previewSessions = useAggregatedPreviewSessions();

  return (
    <>
      <ChatRouteGlobalShortcuts />
      <CenterTabsHostRoot projectRef={projectRef} previewSessions={previewSessions} />
      <Outlet />
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
});
