/**
 * Assembles the full `<RightSidebar>` prop set for an arbitrary
 * `ThreadRouteTarget`, independent of any specific `ChatView` instance.
 *
 * VSCode-style tab layout redesign, Phase 2 step 2
 * (`.context/attachments/.../vscode-style-tab-layout-redesign-for-eflob.md`):
 * `ChatView.tsx`'s existing (non-embedded) `<RightSidebar>` call site builds
 * these same props inline from its own local state — this hook exists so
 * `CenterTabsHostRoot` (the new singleton right-sidebar host, a sibling of
 * `ChatView` rather than a descendant) can build the identical prop set for
 * whichever thread tab is currently active, by combining the three
 * already-hoisted hooks (`useActiveThreadResolution`,
 * `useRightSidebarController`, `useRightSidebarSurfaces`) with the handful of
 * small derivations those hooks' docs call out as deliberately NOT hoisted
 * (`diffOpen`/`planSidebarOpen`, `dismissPlanSidebarForCurrentTurn`, the
 * plan-state inputs, `terminalOpen`, `composerRef`) because `ChatViewContent`
 * still shares them with
 * non-right-sidebar logic. Here, with no such non-right-sidebar consumer,
 * those derivations are simply local to this hook.
 *
 * `ChatView.tsx`'s own call site is intentionally NOT rewritten to call this
 * hook in this change — it's a large, separately-verified block of inline
 * logic already covered by the full test suite, and rewriring it is a
 * bigger, riskier diff than this step calls for. Keeping both assemblies
 * conceptually in sync is a known follow-up; this hook is the sanctioned
 * shape for that future consolidation.
 */

import {
  type EnvironmentId,
  type OrchestrationThreadActivity,
  type ScopedThreadRef,
} from "@eflob/contracts";
import { scopeThreadRef } from "@eflob/client-runtime/environment";
import { useCallback, useMemo, useRef } from "react";

import { useComposerHandleContext } from "../composerHandleContext";
import { type ChatComposerHandle } from "../components/chat/ChatComposer";
import { shortcutLabelForCommand } from "../keybindings";
import {
  deriveActivePlanState,
  findSidebarProposedPlan,
  isLatestTurnSettled,
} from "../session-logic";
import { useMediaQuery } from "./useMediaQuery";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import {
  selectActiveRightPanel,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import { useComposerDraftStore } from "../composerDraftStore";
import { DEFAULT_INTERACTION_MODE } from "../types";
import { type ThreadRouteTarget } from "../threadRoutes";
import { type RightSidebarProps } from "../components/RightSidebar";
import { useActiveThreadResolution } from "./useActiveThreadResolution";
import { useRightSidebarController } from "./useRightSidebarController";
import { useRightSidebarSurfaces } from "./useRightSidebarSurfaces";

const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];

/** Resolves a `ThreadRouteTarget` into the `{environmentId, threadId, routeKind, draftId, routeThreadRef}` shape `useActiveThreadResolution` needs. */
function useThreadRouteTargetResolution(
  fallbackEnvironmentId: EnvironmentId,
  target: ThreadRouteTarget,
) {
  const draftSession = useComposerDraftStore((store) =>
    target.kind === "draft" ? store.getDraftSession(target.draftId) : null,
  );

  if (target.kind === "server") {
    return {
      environmentId: target.threadRef.environmentId,
      threadId: target.threadRef.threadId,
      routeKind: "server" as const,
      draftId: null,
      routeThreadRef: target.threadRef,
    };
  }

  const environmentId = draftSession?.environmentId ?? fallbackEnvironmentId;
  const threadId = draftSession?.threadId ?? null;
  const routeThreadRef: ScopedThreadRef | null = threadId
    ? scopeThreadRef(environmentId, threadId)
    : null;
  return {
    environmentId,
    threadId,
    routeKind: "draft" as const,
    draftId: target.draftId,
    routeThreadRef,
  };
}

export interface UseAssembledRightSidebarPropsOptions {
  environmentId: EnvironmentId;
  target: ThreadRouteTarget;
}

/**
 * Returns `null` when the target's underlying thread/draft session hasn't
 * resolved yet (e.g. a draft tab whose session hasn't loaded) — callers
 * should render nothing in that case, same as `RightSidebar` rendering an
 * empty state when `activeThreadRef` is `null`.
 */
export function useAssembledRightSidebarProps(
  options: UseAssembledRightSidebarPropsOptions,
): RightSidebarProps | null {
  const { environmentId: fallbackEnvironmentId, target } = options;
  const resolvedIds = useThreadRouteTargetResolution(fallbackEnvironmentId, target);
  const { environmentId, threadId, routeKind, draftId, routeThreadRef } = resolvedIds;

  const composerInteractionMode = useComposerDraftStore((store) =>
    routeThreadRef && routeKind === "server"
      ? (store.getComposerDraft(routeThreadRef)?.interactionMode ?? null)
      : draftId
        ? (store.getComposerDraft(draftId)?.interactionMode ?? null)
        : null,
  );

  const resolution = useActiveThreadResolution({
    environmentId,
    threadId: threadId as NonNullable<typeof threadId>,
    routeKind,
    draftId,
    routeThreadRef: routeThreadRef as NonNullable<typeof routeThreadRef>,
  });

  const {
    activeThread,
    activeThreadId,
    activeThreadRef,
    activeThreadKey,
    activeThreadWorktreePath,
    activeProject,
    isServerThread,
    isGitRepo,
    gitCwd,
    gitStatusQuery,
    keybindings,
  } = resolution;

  const activeProjectKey = activeProject
    ? `${activeProject.environmentId}:${activeProject.workspaceRoot}`
    : null;

  const shouldUsePlanSidebarSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);

  const activeRightPanelKind = useRightPanelStore((state) =>
    selectActiveRightPanel(state.byThreadKey, activeThreadRef),
  );
  const diffOpen = activeRightPanelKind === "diff";
  const planSidebarOpen = activeRightPanelKind === "plan";
  const rightPanelOpen = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, activeThreadRef).isOpen,
  );
  // Per-thread "is the right panel maximized" state, shared (via
  // `rightPanelStore`) with every other consumer of this hook — see the
  // module doc comment above and `rightPanelStore.ts`'s `maximized` field.
  const threadMaximized = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, activeThreadRef).maximized,
  );
  const canMaximizeRightPanel = rightPanelOpen && !shouldUsePlanSidebarSheet;
  const rightPanelMaximized = canMaximizeRightPanel && threadMaximized;

  const interactionMode =
    composerInteractionMode ?? activeThread?.interactionMode ?? DEFAULT_INTERACTION_MODE;
  const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES;
  const activeLatestTurn = activeThread?.latestTurn ?? null;
  const latestTurnSettled = isLatestTurnSettled(activeLatestTurn, activeThread?.session ?? null);
  const threadPlanCatalog = useMemo(
    () =>
      activeThread ? [{ id: activeThread.id, proposedPlans: activeThread.proposedPlans }] : [],
    [activeThread],
  );

  // Mirrors ChatViewContent's dismissal ref, scoped to this hook call instead
  // of shared with a `togglePlanSidebar` that doesn't exist at this call
  // site (only `closePlanSidebar` — a `RightSidebar` prop — needs it here).
  const planSidebarDismissedForTurnRef = useRef<string | null>(null);
  const activePlanForDismissal = useMemo(
    () => deriveActivePlanState(threadActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const sidebarProposedPlanForDismissal = useMemo(
    () =>
      findSidebarProposedPlan({
        threads: threadPlanCatalog,
        latestTurn: activeLatestTurn,
        latestTurnSettled,
        threadId: activeThreadId,
      }),
    [activeLatestTurn, activeThreadId, latestTurnSettled, threadPlanCatalog],
  );
  const dismissPlanSidebarForCurrentTurn = useCallback(() => {
    planSidebarDismissedForTurnRef.current =
      activePlanForDismissal?.turnId ?? sidebarProposedPlanForDismissal?.turnId ?? "__dismissed__";
  }, [activePlanForDismissal?.turnId, sidebarProposedPlanForDismissal?.turnId]);

  const toggleRightPanel = useCallback(() => {
    if (!activeThreadRef) return;
    if (rightPanelOpen) {
      if (planSidebarOpen) dismissPlanSidebarForCurrentTurn();
      useRightPanelStore.getState().close(activeThreadRef);
      return;
    }
    useRightPanelStore.getState().toggleVisibility(activeThreadRef);
  }, [activeThreadRef, dismissPlanSidebarForCurrentTurn, planSidebarOpen, rightPanelOpen]);

  const controller = useRightSidebarController({
    threadRef: activeThreadRef,
    ...(routeKind === "draft" && draftId ? { draftId } : {}),
    activeProjectKey,
    panelToggle: {
      rightPanelAvailable: activeProject !== null,
      rightPanelOpen,
      rightPanelShortcutLabel: shortcutLabelForCommand(keybindings, "rightPanel.toggle"),
      onToggleRightPanel: toggleRightPanel,
    },
  });
  const localComposerRef = useRef<ChatComposerHandle | null>(null);
  const composerRef = useComposerHandleContext() ?? localComposerRef;

  const surfaces = useRightSidebarSurfaces({
    environmentId,
    routeKind,
    draftId,
    activeThreadRef,
    activeThreadKey,
    activeThreadId,
    activeThreadWorktreePath,
    isServerThread,
    isGitRepo,
    gitCwd,
    gitStatusQuery,
    activeProject,
    keybindings,
    diffOpen,
    planSidebarOpen,
    onDiffPanelOpen: undefined,
    dismissPlanSidebarForCurrentTurn,
    bumpTerminalFocusRequestId: controller.bumpTerminalFocusRequestId,
    composerRef,
    threadActivities,
    activeLatestTurn,
    latestTurnSettled,
    threadPlanCatalog,
    interactionMode,
  });

  if (!activeThreadRef) return null;

  return {
    shouldUsePlanSidebarSheet,
    rightPanelOpen,
    rightPanelMaximized,
    panelToggleControls: controller.panelToggleControls,
    planSidebarOpen,
    closePlanSidebar: surfaces.closePlanSidebar,
    closePreviewPanel: surfaces.closePreviewPanel,
    environmentId,
    activeThreadRef,
    activeThreadKey,
    isServerThread,
    isGitRepo,
    composerDraftTarget: resolution.composerDraftTarget,
    keybindings,
    availableEditors: resolution.availableEditors,
    gitCwd,
    activeWorkspaceRoot: resolution.activeWorkspaceRoot,
    timestampFormat: resolution.timestampFormat,
    activeProject,
    rightPanelState: surfaces.rightPanelState,
    activeRightPanelSurface: surfaces.activeRightPanelSurface,
    activeFileSurface: surfaces.activeFileSurface,
    pendingFileSurfaceIds: controller.pendingFileSurfaceIds,
    activePreviewState: surfaces.activePreviewState,
    configuredPreviewUrls: surfaces.configuredPreviewUrls,
    terminalFocusRequestId: controller.terminalFocusRequestId,
    activeDiffFileListFiles: surfaces.activeDiffFileListFiles,
    activeDiffSelectedFilePath: surfaces.activeDiffSelectedFilePath,
    onSelectDiffFileListRow: surfaces.onSelectDiffFileListRow,
    diffPanelGitStatusResolutionKey: surfaces.diffPanelGitStatusResolutionKey,
    initialDiffPanelGitScope: surfaces.initialDiffPanelGitScope,
    activePlan: surfaces.activePlan,
    sidebarProposedPlan: surfaces.sidebarProposedPlan,
    planSidebarLabel: surfaces.planSidebarLabel,
    openFileSurface: surfaces.openFileSurface,
    handleFilePendingChange: controller.handleFilePendingChange,
    addTerminalContextToDraft: surfaces.addTerminalContextToDraft,
    activateRightPanelSurface: surfaces.activateRightPanelSurface,
    closeRightPanelSurface: surfaces.closeRightPanelSurface,
    closeOtherRightPanelSurfaces: surfaces.closeOtherRightPanelSurfaces,
    closeRightPanelSurfacesToRight: surfaces.closeRightPanelSurfacesToRight,
    closeAllRightPanelSurfaces: surfaces.closeAllRightPanelSurfaces,
    copyRightPanelFilePath: surfaces.copyRightPanelFilePath,
    createBrowserSurface: surfaces.createBrowserSurface,
    addDiffSurface: surfaces.addDiffSurface,
    addFilesSurface: surfaces.addFilesSurface,
  };
}
