import {
  type EnvironmentId,
  type PreviewSessionSnapshot,
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
  type TimestampFormat,
} from "@eflob/contracts";
import type { FileDiffMetadata } from "@pierre/diffs/types";

import { type DraftId } from "../composerDraftStore";
import type { TerminalContextSelection } from "../lib/terminalContext";
import { type RightPanelSurface } from "../rightPanelStore";
import { RightPanelSheet } from "./RightPanelSheet";
import { RightSidebarBrowsingPanel } from "./RightSidebarBrowsingPanel";
import { PreviewPanelShell } from "./preview/PreviewPanelShell";
import { useResizableSplit } from "../hooks/useResizableSplit";
import { cn } from "../lib/utils";
import type { ActivePlanState, LatestProposedPlanState } from "../session-logic";
import type { EditorId } from "@eflob/contracts";
import { RightSidebarTerminalDock } from "./RightSidebarTerminalDock";

interface RightSidebarDockProps {
  maximized: boolean;
  activeThreadRef: ScopedThreadRef;
  activeProject: { environmentId: EnvironmentId; title: string; workspaceRoot: string } | null;
  activeWorkspaceRoot: string | undefined;
  openFileSurface: (relativePath: string) => void;
  diffAvailable: boolean;
  activeDiffFileListFiles: ReadonlyArray<FileDiffMetadata>;
  activeDiffSelectedFilePath: string | null;
  onSelectDiffFileListRow: (relativePath: string) => void;
  gitCwd: string | null;
  terminalFocusRequestId: number;
  addTerminalContextToDraft: (selection: TerminalContextSelection) => void;
  keybindings: ResolvedKeybindingsConfig;
}

const RIGHT_SIDEBAR_TOP_DOCK_HEIGHT_STORAGE_KEY = "eflob:right-sidebar-top-dock-height:v1";
const RIGHT_SIDEBAR_TOP_DOCK_DEFAULT_HEIGHT = 320;
const RIGHT_SIDEBAR_TOP_DOCK_MIN_HEIGHT = 120;
const RIGHT_SIDEBAR_TOP_DOCK_MAX_HEIGHT = 720;

/**
 * The right sidebar's fixed top/bottom dock (VSCode-style tab layout
 * redesign, Phase 3, design doc section 3): `RightSidebarBrowsingPanel`
 * (Files | Diff switcher, navigation-only) on top, a draggable/keyboard-
 * resizable split in the middle, `TerminalDockPanel` (horizontal terminal
 * tabs) on the bottom. Only rendered for the non-sheet ("inline") layout —
 * the narrow-viewport sheet layout (`RightSidebarSheetBody` below) is the
 * same composition wrapped in modal sheet chrome instead of a fixed dock.
 */
function RightSidebarDock({
  maximized,
  activeThreadRef,
  activeProject,
  activeWorkspaceRoot,
  openFileSurface,
  diffAvailable,
  activeDiffFileListFiles,
  activeDiffSelectedFilePath,
  onSelectDiffFileListRow,
  gitCwd,
  terminalFocusRequestId,
  addTerminalContextToDraft,
  keybindings,
}: RightSidebarDockProps) {
  const topDock = useResizableSplit({
    axis: "height",
    edge: "bottom",
    storageKey: RIGHT_SIDEBAR_TOP_DOCK_HEIGHT_STORAGE_KEY,
    defaultSize: RIGHT_SIDEBAR_TOP_DOCK_DEFAULT_HEIGHT,
    minSize: RIGHT_SIDEBAR_TOP_DOCK_MIN_HEIGHT,
    maxSize: RIGHT_SIDEBAR_TOP_DOCK_MAX_HEIGHT,
  });

  return (
    <PreviewPanelShell mode="inline" maximized={maximized}>
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <div className="min-h-0 shrink-0 overflow-hidden" style={{ height: topDock.size }}>
          <RightSidebarBrowsingPanel
            maximized={maximized}
            environmentId={activeProject?.environmentId ?? null}
            cwd={activeWorkspaceRoot ?? null}
            projectName={activeProject?.title ?? null}
            onOpenFile={openFileSurface}
            diffAvailable={diffAvailable}
            diffFiles={activeDiffFileListFiles}
            diffSelectedFilePath={activeDiffSelectedFilePath}
            onSelectDiffFile={onSelectDiffFileListRow}
          />
        </div>
        <div
          className={cn(
            "group relative h-1.5 shrink-0 cursor-row-resize touch-none",
            "before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-border",
            topDock.isDragging && "before:bg-ring",
          )}
          {...topDock.handleProps}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <RightSidebarTerminalDock
            threadRef={activeThreadRef}
            gitCwd={gitCwd}
            activeProject={activeProject}
            focusRequestId={terminalFocusRequestId}
            onAddTerminalContext={addTerminalContextToDraft}
            keybindings={keybindings}
          />
        </div>
      </div>
    </PreviewPanelShell>
  );
}

const RIGHT_SIDEBAR_SHEET_TOP_HEIGHT_STORAGE_KEY = "eflob:right-sidebar-sheet-top-dock-height:v1";
const RIGHT_SIDEBAR_SHEET_TOP_DEFAULT_HEIGHT = 320;
const RIGHT_SIDEBAR_SHEET_TOP_MIN_HEIGHT = 120;
const RIGHT_SIDEBAR_SHEET_TOP_MAX_HEIGHT = 640;

interface RightSidebarSheetBodyProps {
  activeThreadRef: ScopedThreadRef;
  activeProject: { environmentId: EnvironmentId; title: string; workspaceRoot: string } | null;
  activeWorkspaceRoot: string | undefined;
  openFileSurface: (relativePath: string) => void;
  diffAvailable: boolean;
  activeDiffFileListFiles: ReadonlyArray<FileDiffMetadata>;
  activeDiffSelectedFilePath: string | null;
  onSelectDiffFileListRow: (relativePath: string) => void;
  gitCwd: string | null;
  terminalFocusRequestId: number;
  addTerminalContextToDraft: (selection: TerminalContextSelection) => void;
  keybindings: ResolvedKeybindingsConfig;
  /** Called after a file/diff row is selected, so the sheet dismisses and reveals the already-rendered central tab content underneath. */
  onNavigated: () => void;
}

/**
 * The narrow-viewport ("sheet") composition of the right sidebar (VSCode-
 * style tab layout redesign, design doc sections 3/4): the SAME
 * `RightSidebarBrowsingPanel` (Files | Diff switcher, navigation-only) and
 * `RightSidebarTerminalDock` the wide/inline layout uses (`RightSidebarDock`
 * above), just stacked inside modal sheet chrome instead of the fixed
 * top/bottom dock. There is exactly one data model backing both layout
 * modes now: selecting a file or diff row here dispatches into
 * `centerTabsStore` via `openFileSurface`/`onSelectDiffFileListRow` (the same
 * callbacks the wide layout uses), which is what actually renders the
 * content — full-bleed, underneath this sheet — via `CenterTabsHost`. This
 * sheet is therefore navigation-only chrome: once a row is picked, it
 * dismisses itself (`onNavigated`) so the caller can see the tab it just
 * opened instead of the sheet and the central content rendering the same
 * thing on top of each other (the bug this replaces).
 */
function RightSidebarSheetBody({
  activeThreadRef,
  activeProject,
  activeWorkspaceRoot,
  openFileSurface,
  diffAvailable,
  activeDiffFileListFiles,
  activeDiffSelectedFilePath,
  onSelectDiffFileListRow,
  gitCwd,
  terminalFocusRequestId,
  addTerminalContextToDraft,
  keybindings,
  onNavigated,
}: RightSidebarSheetBodyProps) {
  const topDock = useResizableSplit({
    axis: "height",
    edge: "bottom",
    storageKey: RIGHT_SIDEBAR_SHEET_TOP_HEIGHT_STORAGE_KEY,
    defaultSize: RIGHT_SIDEBAR_SHEET_TOP_DEFAULT_HEIGHT,
    minSize: RIGHT_SIDEBAR_SHEET_TOP_MIN_HEIGHT,
    maxSize: RIGHT_SIDEBAR_SHEET_TOP_MAX_HEIGHT,
  });

  const handleOpenFile = (relativePath: string) => {
    openFileSurface(relativePath);
    onNavigated();
  };
  const handleSelectDiffFile = (relativePath: string) => {
    onSelectDiffFileListRow(relativePath);
    onNavigated();
  };

  return (
    <PreviewPanelShell mode="sheet">
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <div className="min-h-0 shrink-0 overflow-hidden" style={{ height: topDock.size }}>
          <RightSidebarBrowsingPanel
            environmentId={activeProject?.environmentId ?? null}
            cwd={activeWorkspaceRoot ?? null}
            projectName={activeProject?.title ?? null}
            onOpenFile={handleOpenFile}
            diffAvailable={diffAvailable}
            diffFiles={activeDiffFileListFiles}
            diffSelectedFilePath={activeDiffSelectedFilePath}
            onSelectDiffFile={handleSelectDiffFile}
          />
        </div>
        <div
          className={cn(
            "group relative h-1.5 shrink-0 cursor-row-resize touch-none",
            "before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-border",
            topDock.isDragging && "before:bg-ring",
          )}
          {...topDock.handleProps}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <RightSidebarTerminalDock
            threadRef={activeThreadRef}
            gitCwd={gitCwd}
            activeProject={activeProject}
            focusRequestId={terminalFocusRequestId}
            onAddTerminalContext={addTerminalContextToDraft}
            keybindings={keybindings}
          />
        </div>
      </div>
    </PreviewPanelShell>
  );
}

export interface RightSidebarProps {
  // Layout / visibility
  shouldUsePlanSidebarSheet: boolean;
  rightPanelOpen: boolean;
  rightPanelMaximized: boolean;
  panelToggleControls: React.ReactNode;
  planSidebarOpen: boolean;
  closePlanSidebar: () => void;
  closePreviewPanel: () => void;

  // Thread/environment context (read-only, shared with ChatColumn)
  environmentId: EnvironmentId;
  activeThreadRef: ScopedThreadRef | null;
  activeThreadKey: string | null;
  isServerThread: boolean;
  isGitRepo: boolean;
  composerDraftTarget: ScopedThreadRef | DraftId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  gitCwd: string | null;
  activeWorkspaceRoot: string | undefined;
  timestampFormat: TimestampFormat;
  activeProject: { environmentId: EnvironmentId; title: string; workspaceRoot: string } | null;

  // rightPanelStore-derived state
  rightPanelState: { surfaces: readonly RightPanelSurface[] };
  activeRightPanelSurface: RightPanelSurface | null;
  activeFileSurface: Extract<RightPanelSurface, { kind: "file" }> | null;
  pendingFileSurfaceIds: ReadonlySet<string>;
  activePreviewState: { sessions: Readonly<Record<string, PreviewSessionSnapshot>> };
  configuredPreviewUrls: ReadonlyArray<string>;
  terminalFocusRequestId: number;

  // Diff list (right-sidebar "Changes" list)
  activeDiffFileListFiles: ReadonlyArray<FileDiffMetadata>;
  activeDiffSelectedFilePath: string | null;
  onSelectDiffFileListRow: (relativePath: string) => void;
  diffPanelGitStatusResolutionKey: string;
  initialDiffPanelGitScope: "branch" | "unstaged";

  // Plan
  activePlan: ActivePlanState | null;
  sidebarProposedPlan: LatestProposedPlanState | null;
  planSidebarLabel: string;

  // File surface
  openFileSurface: (relativePath: string) => void;
  handleFilePendingChange: (relativePath: string, pending: boolean) => void;

  // Terminal
  addTerminalContextToDraft: (selection: TerminalContextSelection) => void;

  // Right-panel surface interactions (still rightPanelStore-backed for now)
  activateRightPanelSurface: (surface: RightPanelSurface) => void;
  closeRightPanelSurface: (surface: RightPanelSurface) => void;
  closeOtherRightPanelSurfaces: (surface: RightPanelSurface) => void;
  closeRightPanelSurfacesToRight: (surface: RightPanelSurface) => void;
  closeAllRightPanelSurfaces: () => void;
  copyRightPanelFilePath: (relativePath: string) => void;
  createBrowserSurface: () => void;
  addDiffSurface: () => void;
  addFilesSurface: () => void;
}

/**
 * The right sidebar boundary extracted from `ChatView.tsx` as Phase 2 (step 1)
 * of the VSCode-style tab layout redesign: `rightPanelStore`-driven surfaces
 * (files/diff/plan/preview/terminal) plus the Phase 1 `CenterTabsHost` mount
 * point. This is a mechanical relocation only — still instantiated once per
 * single-threaded route, with zero behavior change from before the split.
 */
export function RightSidebar(props: RightSidebarProps) {
  const {
    shouldUsePlanSidebarSheet,
    rightPanelOpen,
    rightPanelMaximized,
    closePreviewPanel,
    activeThreadRef,
    isServerThread,
    isGitRepo,
    gitCwd,
    keybindings,
    activeWorkspaceRoot,
    activeProject,
    terminalFocusRequestId,
    activeDiffFileListFiles,
    activeDiffSelectedFilePath,
    onSelectDiffFileListRow,
    openFileSurface,
    addTerminalContextToDraft,
  } = props;

  return (
    <>
      {!shouldUsePlanSidebarSheet && rightPanelOpen && activeThreadRef ? (
        <RightSidebarDock
          maximized={rightPanelMaximized}
          activeThreadRef={activeThreadRef}
          activeProject={activeProject}
          activeWorkspaceRoot={activeWorkspaceRoot}
          openFileSurface={openFileSurface}
          diffAvailable={isServerThread && isGitRepo}
          activeDiffFileListFiles={activeDiffFileListFiles}
          activeDiffSelectedFilePath={activeDiffSelectedFilePath}
          onSelectDiffFileListRow={onSelectDiffFileListRow}
          gitCwd={gitCwd}
          terminalFocusRequestId={terminalFocusRequestId}
          addTerminalContextToDraft={addTerminalContextToDraft}
          keybindings={keybindings}
        />
      ) : null}
      {shouldUsePlanSidebarSheet && rightPanelOpen && activeThreadRef ? (
        <RightPanelSheet open onClose={closePreviewPanel}>
          <RightSidebarSheetBody
            activeThreadRef={activeThreadRef}
            activeProject={activeProject}
            activeWorkspaceRoot={activeWorkspaceRoot}
            openFileSurface={openFileSurface}
            diffAvailable={isServerThread && isGitRepo}
            activeDiffFileListFiles={activeDiffFileListFiles}
            activeDiffSelectedFilePath={activeDiffSelectedFilePath}
            onSelectDiffFileListRow={onSelectDiffFileListRow}
            gitCwd={gitCwd}
            terminalFocusRequestId={terminalFocusRequestId}
            addTerminalContextToDraft={addTerminalContextToDraft}
            keybindings={keybindings}
            onNavigated={closePreviewPanel}
          />
        </RightPanelSheet>
      ) : null}
    </>
  );
}
