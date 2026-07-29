/**
 * Right-sidebar surface state + callbacks, hoisted out of `ChatViewContent`
 * (`ChatView.tsx`) as the second (and final) step of the "hoist the
 * right-sidebar props out of `ChatView.tsx`" plan (see
 * `.context/attachments/.../vscode-style-tab-layout-redesign-for-eflob.md`,
 * Phase 2). Together with `useActiveThreadResolution` and
 * `useRightSidebarController`, this hook produces everything `<RightSidebar>`
 * needs, so a future singleton right-sidebar host can call exactly these
 * three hooks once for the active thread tab instead of `<RightSidebar>`
 * only being reachable from inside a specific `ChatView` instance.
 *
 * Scope: `rightPanelStore`-derived surfaces (files/diff/plan/preview/
 * terminal), the right-sidebar "Changes" list, the plan-sidebar payload, the
 * central-tab mirrors of file/diff/preview opens (`centerTabsStore`), and all
 * the surface-activate/close/copy/create callbacks `RightSidebar` invokes.
 *
 * Explicitly NOT here, and why (kept in `ChatViewContent`, passed in as
 * inputs instead of re-derived): these are either genuinely shared with
 * non-right-sidebar logic still living in `ChatViewContent`, or are `ref`/
 * `useState` state whose *other* consumers would otherwise need a second,
 * duplicate subscription:
 * - `diffOpen` / `planSidebarOpen`: derived from the same `rightPanelStore`
 *   "active kind" selector that also feeds `onToggleDiff`/`togglePlanSidebar`/
 *   `toggleRightPanel`/`previewPanelOpen`, none of which move here.
 * - `dismissPlanSidebarForCurrentTurn` (and the `useRef` it writes): shared
 *   with `togglePlanSidebar` and a separate "auto-open plan sidebar for a new
 *   turn" effect, neither of which move here.
 * - `activeThreadKnownSessions` / `activeKnownTerminalIds` / `terminalOpen`
 *   (drawer): also feed the full-width terminal drawer's own
 *   toggle/split/new/close callbacks (Phase 3 deletes the drawer; until then
 *   both consumers need the same values).
 * - `threadActivities` / `activeLatestTurn` / `latestTurnSettled` /
 *   `threadPlanCatalog` / `interactionMode`: feed several non-right-sidebar
 *   derivations (`pendingApprovals`, `pendingUserInputs`, `activeProposedPlan`,
 *   `showPlanFollowUpPrompt`, composer mode toggles).
 * - `composerRef`: a `ChatView`-instance-local imperative handle.
 *
 * Terminal mutations (`terminalEnvironment.open`/`.close`,
 * `previewEnvironment.open`/`.close`) and the `terminalUiStateStore`
 * `closeTerminal` action ARE re-acquired here via their own
 * `useAtomCommand`/store-selector calls rather than passed in — both are
 * stateless per call site (see `useAtomCommand`), so a second call site is
 * behaviorally identical to threading the same callback through, and keeping
 * them here means this hook doesn't need `ChatViewContent`'s copies at all.
 */

import {
  type EnvironmentId,
  type OrchestrationLatestTurn,
  type OrchestrationThreadActivity,
  type ProviderInteractionMode,
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
  type ThreadId,
  type VcsStatusResult,
} from "@eflob/contracts";
import { type FileDiffMetadata } from "@pierre/diffs/types";
import { useCallback, useMemo } from "react";

import { scopeProjectRef } from "@eflob/client-runtime/environment";

import { type ChatComposerHandle } from "../components/chat/ChatComposer";
import { addBrowserSurface } from "../components/preview/addBrowserSurface";
import { closePreviewSession } from "../components/preview/closePreviewSession";
import { getConfiguredPreviewUrls } from "../components/preview/previewEmptyStateLogic";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useCenterTabsStore } from "../centerTabsStore";
import { type DraftId } from "../composerDraftStore";
import { selectDiffPanelFileList, useDiffPanelFileListStore } from "../diffPanelFileListStore";
import { selectThreadDiffPanelSelection, useDiffPanelStore } from "../diffPanelStore";
import { type TerminalContextSelection } from "../lib/terminalContext";
import {
  isPreviewSupportedInRuntime,
  setActivePreviewTab,
  useThreadPreviewState,
} from "../previewStateStore";
import {
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  type RightPanelSurface,
  useRightPanelStore,
} from "../rightPanelStore";
import { deriveActivePlanState, findSidebarProposedPlan } from "../session-logic";
import { useProject } from "../state/entities";
import type { ActivePlanState, LatestProposedPlanState } from "../session-logic";
import { previewEnvironment } from "../state/preview";
import { type EnvironmentQueryView } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { type ThreadRouteTarget } from "../threadRoutes";
import { type Thread } from "../types";

type ThreadPlanCatalogEntry = Pick<Thread, "id" | "proposedPlans">;

export interface UseRightSidebarSurfacesOptions {
  environmentId: EnvironmentId;
  routeKind: "server" | "draft";
  draftId: DraftId | null;

  activeThreadRef: ScopedThreadRef | null;
  activeThreadKey: string | null;
  activeThreadId: ThreadId | null;
  activeThreadWorktreePath: string | null;
  isServerThread: boolean;
  isGitRepo: boolean;
  gitCwd: string | null;
  gitStatusQuery: EnvironmentQueryView<VcsStatusResult>;
  activeProject: ReturnType<typeof useProject>;
  keybindings: ResolvedKeybindingsConfig;

  /** `rightPanelStore`'s "active kind" derivations, shared with non-hoisted toggles. */
  diffOpen: boolean;
  planSidebarOpen: boolean;
  onDiffPanelOpen: (() => void) | undefined;
  dismissPlanSidebarForCurrentTurn: () => void;
  bumpTerminalFocusRequestId: () => void;
  composerRef: { current: ChatComposerHandle | null };

  /** Plan-state inputs, shared with non-hoisted derivations elsewhere in `ChatViewContent`. */
  threadActivities: ReadonlyArray<OrchestrationThreadActivity>;
  activeLatestTurn: Pick<OrchestrationLatestTurn, "turnId" | "sourceProposedPlan"> | null;
  latestTurnSettled: boolean;
  threadPlanCatalog: ReadonlyArray<ThreadPlanCatalogEntry>;
  interactionMode: ProviderInteractionMode;
}

export interface RightSidebarSurfaces {
  rightPanelState: { surfaces: readonly RightPanelSurface[]; isOpen: boolean };
  activeRightPanelSurface: RightPanelSurface | null;
  activeFileSurface: Extract<RightPanelSurface, { kind: "file" }> | null;
  activePreviewState: ReturnType<typeof useThreadPreviewState>;
  configuredPreviewUrls: ReadonlyArray<string>;

  activeDiffFileListFiles: ReadonlyArray<FileDiffMetadata>;
  activeDiffSelectedFilePath: string | null;
  onSelectDiffFileListRow: (relativePath: string) => void;
  diffPanelGitStatusResolutionKey: string;
  initialDiffPanelGitScope: "branch" | "unstaged";

  activePlan: ActivePlanState | null;
  sidebarProposedPlan: LatestProposedPlanState | null;
  planSidebarLabel: string;

  openFileSurface: (relativePath: string) => void;

  addTerminalContextToDraft: (selection: TerminalContextSelection) => void;

  activateRightPanelSurface: (surface: RightPanelSurface) => void;
  closeRightPanelSurface: (surface: RightPanelSurface) => void;
  closeOtherRightPanelSurfaces: (surface: RightPanelSurface) => void;
  closeRightPanelSurfacesToRight: (surface: RightPanelSurface) => void;
  closeAllRightPanelSurfaces: () => void;
  copyRightPanelFilePath: (relativePath: string) => void;
  createBrowserSurface: () => void;
  addDiffSurface: () => void;
  addFilesSurface: () => void;
  closePlanSidebar: () => void;
  closePreviewPanel: () => void;
}

/**
 * Hoisted right-sidebar surface state/callbacks. Call once per thread whose
 * right-sidebar-facing surfaces you own — today that's exactly one call
 * (from `ChatViewContent`, for the routed thread); once the singleton
 * `RightSidebar` mount point lands, it calls this once for whichever thread
 * tab is currently active, alongside `useActiveThreadResolution` and
 * `useRightSidebarController`.
 */
export function useRightSidebarSurfaces(
  options: UseRightSidebarSurfacesOptions,
): RightSidebarSurfaces {
  const {
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
    onDiffPanelOpen,
    dismissPlanSidebarForCurrentTurn,
    bumpTerminalFocusRequestId,
    composerRef,
    threadActivities,
    activeLatestTurn,
    latestTurnSettled,
    threadPlanCatalog,
    interactionMode,
  } = options;

  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const closePreview = useAtomCommand(previewEnvironment.close, "preview close");

  // Mirror rightPanelStore's file/diff/plan/preview opens into
  // centerTabsStore (Phase 1 groundwork), additive/parallel to the
  // rightPanelStore-driven UI. `openCenterPlanTab` stays out of this hook
  // (`togglePlanSidebar`, the only caller, isn't hoisted).
  const centerTabsThreadTarget = useMemo<ThreadRouteTarget | null>(() => {
    if (routeKind === "draft" && draftId) return { kind: "draft", draftId };
    return activeThreadRef ? { kind: "server", threadRef: activeThreadRef } : null;
  }, [routeKind, draftId, activeThreadRef]);
  const activeProjectRef = useMemo(
    () => (activeProject ? scopeProjectRef(activeProject.environmentId, activeProject.id) : null),
    [activeProject],
  );
  const openCenterFileTab = useCallback(
    (relativePath: string, line?: number) => {
      if (!centerTabsThreadTarget || !activeProjectRef) return;
      useCenterTabsStore
        .getState()
        .openFileTab(activeProjectRef, centerTabsThreadTarget, relativePath, line);
    },
    [centerTabsThreadTarget, activeProjectRef],
  );
  const openCenterDiffTab = useCallback(
    (diffOptions?: { revealPath?: boolean }) => {
      if (!centerTabsThreadTarget || !activeProjectRef) return;
      useCenterTabsStore
        .getState()
        .openDiffTab(activeProjectRef, centerTabsThreadTarget, diffOptions);
    },
    [centerTabsThreadTarget, activeProjectRef],
  );
  const openCenterPreviewTab = useCallback(
    (previewTabId?: string | null) => {
      if (!centerTabsThreadTarget || !activeProjectRef) return;
      useCenterTabsStore
        .getState()
        .openPreviewTab(activeProjectRef, centerTabsThreadTarget, previewTabId);
    },
    [centerTabsThreadTarget, activeProjectRef],
  );

  const activeDiffFileListFiles = useDiffPanelFileListStore((state) =>
    selectDiffPanelFileList(state.byThreadKey, activeThreadRef),
  );
  const activeDiffSelectedFilePath = useDiffPanelStore(
    (state) => selectThreadDiffPanelSelection(state.byThreadKey, activeThreadRef).filePath,
  );
  const onSelectDiffFileListRow = useCallback(
    (relativePath: string) => {
      if (!activeThreadRef) return;
      useDiffPanelStore.getState().revealFile(activeThreadRef, relativePath);
      openCenterDiffTab({ revealPath: true });
    },
    [activeThreadRef, openCenterDiffTab],
  );

  const rightPanelState = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, activeThreadRef),
  );
  const activeRightPanelSurface = useRightPanelStore((state) =>
    selectActiveRightPanelSurface(state.byThreadKey, activeThreadRef),
  );
  const activeFileSurface =
    activeRightPanelSurface?.kind === "file" ? activeRightPanelSurface : null;
  const activePreviewState = useThreadPreviewState(activeThreadRef);

  const configuredPreviewUrls = useMemo(
    () => getConfiguredPreviewUrls(activeProject?.scripts),
    [activeProject?.scripts],
  );

  const initialDiffPanelGitScope =
    gitStatusQuery.data?.hasWorkingTreeChanges === true ? "unstaged" : "branch";
  const diffPanelGitStatusResolutionKey = gitStatusQuery.data ? "resolved" : "pending";

  const activePlan = useMemo(
    () => deriveActivePlanState(threadActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, threadActivities],
  );
  const sidebarProposedPlan = useMemo(
    () =>
      findSidebarProposedPlan({
        threads: threadPlanCatalog,
        latestTurn: activeLatestTurn,
        latestTurnSettled,
        threadId: activeThreadId,
      }),
    [activeLatestTurn, activeThreadId, latestTurnSettled, threadPlanCatalog],
  );
  const planSidebarLabel = sidebarProposedPlan || interactionMode === "plan" ? "Plan" : "Tasks";

  const openFileSurface = useCallback(
    (relativePath: string) => {
      if (!activeThreadRef || !activeProject) return;
      useRightPanelStore.getState().openFile(activeThreadRef, relativePath);
      openCenterFileTab(relativePath);
    },
    [activeProject, activeThreadRef, openCenterFileTab],
  );

  const addTerminalContextToDraft = useCallback(
    (selection: TerminalContextSelection) => {
      composerRef.current?.addTerminalContext(selection);
    },
    [composerRef],
  );

  const activateRightPanelSurface = useCallback(
    (surface: RightPanelSurface) => {
      if (!activeThreadRef) return;
      if (surface.kind !== "plan" && planSidebarOpen) {
        dismissPlanSidebarForCurrentTurn();
      }
      useRightPanelStore.getState().activateSurface(activeThreadRef, surface.id);
      if (surface.kind === "preview" && surface.resourceId) {
        setActivePreviewTab(activeThreadRef, surface.resourceId);
      }
      if (surface.kind === "diff" && !diffOpen) {
        onDiffPanelOpen?.();
      }
    },
    [activeThreadRef, diffOpen, dismissPlanSidebarForCurrentTurn, onDiffPanelOpen, planSidebarOpen],
  );

  const cleanupRightPanelSurfaces = useCallback(
    (surfaces: readonly RightPanelSurface[]) => {
      if (!activeThreadRef) return;
      if (surfaces.some((surface) => surface.kind === "plan")) {
        dismissPlanSidebarForCurrentTurn();
      }

      for (const surface of surfaces) {
        if (surface.kind === "preview" && surface.resourceId) {
          void closePreviewSession({
            closePreview,
            snapshot: activePreviewState.sessions[surface.resourceId] ?? null,
            tabId: surface.resourceId,
            threadRef: activeThreadRef,
          });
        }
      }
    },
    [activeThreadRef, activePreviewState.sessions, closePreview, dismissPlanSidebarForCurrentTurn],
  );
  const syncActivePreviewSurface = useCallback(() => {
    if (!activeThreadRef) return;
    const nextActiveSurface = selectActiveRightPanelSurface(
      useRightPanelStore.getState().byThreadKey,
      activeThreadRef,
    );
    if (nextActiveSurface?.kind === "preview" && nextActiveSurface.resourceId) {
      setActivePreviewTab(activeThreadRef, nextActiveSurface.resourceId);
    }
  }, [activeThreadRef]);
  const closeRightPanelSurface = useCallback(
    (surface: RightPanelSurface) => {
      if (!activeThreadRef) return;
      cleanupRightPanelSurfaces([surface]);
      useRightPanelStore.getState().closeSurface(activeThreadRef, surface.id);
      syncActivePreviewSurface();
    },
    [activeThreadRef, cleanupRightPanelSurfaces, syncActivePreviewSurface],
  );
  const closeOtherRightPanelSurfaces = useCallback(
    (surface: RightPanelSurface) => {
      if (!activeThreadRef) return;
      const surfaces = rightPanelState.surfaces.filter((entry) => entry.id !== surface.id);
      cleanupRightPanelSurfaces(surfaces);
      useRightPanelStore.getState().closeOtherSurfaces(activeThreadRef, surface.id);
      syncActivePreviewSurface();
    },
    [
      activeThreadRef,
      cleanupRightPanelSurfaces,
      rightPanelState.surfaces,
      syncActivePreviewSurface,
    ],
  );
  const closeRightPanelSurfacesToRight = useCallback(
    (surface: RightPanelSurface) => {
      if (!activeThreadRef) return;
      const surfaceIndex = rightPanelState.surfaces.findIndex((entry) => entry.id === surface.id);
      if (surfaceIndex < 0) return;
      const surfaces = rightPanelState.surfaces.slice(surfaceIndex + 1);
      cleanupRightPanelSurfaces(surfaces);
      useRightPanelStore.getState().closeSurfacesToRight(activeThreadRef, surface.id);
      syncActivePreviewSurface();
    },
    [
      activeThreadRef,
      cleanupRightPanelSurfaces,
      rightPanelState.surfaces,
      syncActivePreviewSurface,
    ],
  );
  const closeAllRightPanelSurfaces = useCallback(() => {
    if (!activeThreadRef) return;
    cleanupRightPanelSurfaces(rightPanelState.surfaces);
    useRightPanelStore.getState().closeAllSurfaces(activeThreadRef);
  }, [activeThreadRef, cleanupRightPanelSurfaces, rightPanelState.surfaces]);

  const copyRightPanelFilePath = useCallback((relativePath: string) => {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: "Clipboard API unavailable.",
        }),
      );
      return;
    }

    void navigator.clipboard.writeText(relativePath).then(
      () => {
        toastManager.add({
          type: "success",
          title: "Path copied",
          description: relativePath,
        });
      },
      (error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to copy path",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      },
    );
  }, []);

  const createBrowserSurface = useCallback(() => {
    if (!activeThreadRef) return;
    void addBrowserSurface({
      threadRef: activeThreadRef,
      openPreview,
      onOpened: (snapshot) => openCenterPreviewTab(snapshot.tabId),
    });
  }, [activeThreadRef, openCenterPreviewTab, openPreview]);
  const addDiffSurface = useCallback(() => {
    if (!activeThreadRef || !isServerThread || !isGitRepo) return;
    if (planSidebarOpen) {
      dismissPlanSidebarForCurrentTurn();
    }
    useRightPanelStore.getState().open(activeThreadRef, "diff");
    openCenterDiffTab();
    onDiffPanelOpen?.();
  }, [
    activeThreadRef,
    dismissPlanSidebarForCurrentTurn,
    isGitRepo,
    isServerThread,
    onDiffPanelOpen,
    openCenterDiffTab,
    planSidebarOpen,
  ]);
  const addFilesSurface = useCallback(() => {
    if (!activeThreadRef || !activeProject) return;
    useRightPanelStore.getState().open(activeThreadRef, "files");
  }, [activeProject, activeThreadRef]);

  const closePlanSidebar = useCallback(() => {
    if (!activeThreadRef) return;
    // `close` un-maximizes the panel too (see `rightPanelStore.ts`), so no
    // separate maximize-reset call is needed here.
    useRightPanelStore.getState().close(activeThreadRef);
    dismissPlanSidebarForCurrentTurn();
  }, [activeThreadRef, dismissPlanSidebarForCurrentTurn]);
  const closePreviewPanel = useCallback(() => {
    if (activeThreadRef) {
      useRightPanelStore.getState().close(activeThreadRef);
    }
  }, [activeThreadRef]);

  return {
    rightPanelState,
    activeRightPanelSurface,
    activeFileSurface,
    activePreviewState,
    configuredPreviewUrls,
    activeDiffFileListFiles,
    activeDiffSelectedFilePath,
    onSelectDiffFileListRow,
    diffPanelGitStatusResolutionKey,
    initialDiffPanelGitScope,
    activePlan,
    sidebarProposedPlan,
    planSidebarLabel,
    openFileSurface,
    addTerminalContextToDraft,
    activateRightPanelSurface,
    closeRightPanelSurface,
    closeOtherRightPanelSurfaces,
    closeRightPanelSurfacesToRight,
    closeAllRightPanelSurfaces,
    copyRightPanelFilePath,
    createBrowserSurface,
    addDiffSurface,
    addFilesSurface,
    closePlanSidebar,
    closePreviewPanel,
  };
}
