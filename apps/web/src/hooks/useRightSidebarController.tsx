/**
 * Per-thread state the (eventually singleton) `RightSidebar` needs, hoisted
 * out of `ChatViewContent` so it can be read/driven independently of which —
 * or how many — `ChatView` instances are mounted.
 *
 * This is Phase 2 groundwork for the VSCode-style tab layout redesign (see
 * `.context/attachments/.../vscode-style-tab-layout-redesign-for-eflob.md`):
 * `CenterTabsHost`'s `renderRightSidebar` slot will eventually call this hook
 * once, for whichever thread tab is currently active, and feed the result
 * straight into a singleton `<RightSidebar/>`. Until that step lands,
 * `ChatViewContent` calls it once for its own thread, so single-thread
 * behavior is unchanged — this file changes *where* the state lives, not
 * what it does.
 *
 * Scope, and why each piece lives here:
 * - `expandedImage` / `expandTimelineImage` / `closeExpandedImage`: the
 *   "click a message image to zoom" overlay. Genuinely thread-scoped (it
 *   must reset when the active thread changes, so a stale zoomed image from
 *   thread A never leaks into thread B) — callers should reset via
 *   `closeExpandedImage()` on thread/draft change, same as the effect this
 *   was extracted from.
 * - `terminalFocusRequestId` / `bumpTerminalFocusRequestId`: a monotonically
 *   increasing counter that tells the active thread's terminal drawer to
 *   (re)focus. Only meaningful for whichever thread is currently active, so
 *   it's naturally per-thread-call state, not a global registry.
 * - `pendingFileSurfaceIds` / `handleFilePendingChange`: which right-sidebar
 *   file surfaces (keyed by project, not thread) have unsaved/pending edits.
 *   Kept as a project-keyed map exactly as before; requires `activeProjectKey`
 *   from the caller since project identity isn't derivable from `threadRef`
 *   alone (a draft thread may have no project yet).
 * - `panelToggleControls`: the small JSX blob (the right-panel toggle button)
 *   that both the chat header and `RightSidebar` render. Kept as a derived
 *   value here (not owned state) so callers don't have to duplicate the
 *   assembly.
 *
 * Note: this file previously also hosted `useMountedTerminalThreadRefs`, an
 * app-wide "which threads should keep their terminal drawer mounted" helper
 * backed by `terminalMountRegistryStore.ts`. Both were removed as part of the
 * VSCode-style tab layout redesign: there is now exactly one terminal UI
 * (the right sidebar's bottom dock, see `RightSidebarTerminalDock.tsx`), so
 * there is no longer a separate full-width terminal drawer whose mount
 * lifecycle needs registry-based reconciliation across threads.
 */

import { type ScopedThreadRef } from "@eflob/contracts";
import { type ReactNode, useCallback, useState } from "react";

import { PanelLayoutControls } from "../components/chat/PanelLayoutControls";
import { type ExpandedImagePreview } from "../components/chat/ExpandedImagePreview";

const EMPTY_PENDING_FILE_SURFACE_IDS: ReadonlySet<string> = new Set();

/** Pure map-update logic for `pendingFileSurfaceIdsByProject`, factored out for unit testing. */
export function updatePendingFileSurfaceIds(
  currentByProject: ReadonlyMap<string, ReadonlySet<string>>,
  projectKey: string,
  relativePath: string,
  pending: boolean,
): ReadonlyMap<string, ReadonlySet<string>> {
  const current = currentByProject.get(projectKey) ?? EMPTY_PENDING_FILE_SURFACE_IDS;
  const surfaceId = `file:${relativePath}`;
  if (current.has(surfaceId) === pending) {
    return currentByProject;
  }
  const next = new Set(current);
  if (pending) {
    next.add(surfaceId);
  } else {
    next.delete(surfaceId);
  }
  const nextByProject = new Map(currentByProject);
  if (next.size === 0) {
    nextByProject.delete(projectKey);
  } else {
    nextByProject.set(projectKey, next);
  }
  return nextByProject;
}

export interface RightSidebarPanelToggleOptions {
  rightPanelAvailable: boolean;
  rightPanelOpen: boolean;
  rightPanelShortcutLabel: string | null;
  onToggleRightPanel: () => void;
}

export interface UseRightSidebarControllerOptions {
  /** Identifies the thread this controller instance belongs to; used only to scope resets. */
  threadRef: ScopedThreadRef | null;
  /** Draft identity, when the thread hasn't been promoted to a server thread yet. */
  draftId?: string | null;
  /** Project key `pendingFileSurfaceIds` is scoped by (project, not thread). */
  activeProjectKey: string | null;
  panelToggle: RightSidebarPanelToggleOptions;
}

export interface RightSidebarController {
  expandedImage: ExpandedImagePreview | null;
  expandTimelineImage: (preview: ExpandedImagePreview) => void;
  closeExpandedImage: () => void;
  terminalFocusRequestId: number;
  bumpTerminalFocusRequestId: () => void;
  pendingFileSurfaceIds: ReadonlySet<string>;
  handleFilePendingChange: (relativePath: string, pending: boolean) => void;
  panelToggleControls: ReactNode;
}

/**
 * Hoisted per-thread controller for the state `RightSidebar` needs. Call
 * once per thread whose right-sidebar-facing state you own — today that's
 * exactly one call (from `ChatViewContent`, for the routed thread); once
 * Phase 2 step 2 wires multi-mount, the singleton `RightSidebar` mount point
 * calls this once for whichever thread tab is currently active.
 *
 * Does NOT reset `expandedImage` automatically on thread change by itself
 * (there is no thread-change *event* available inside a hook parameterized
 * by the current thread — the caller re-renders with a new `threadRef`
 * instead). Callers that need the "close any zoomed image when the active
 * thread changes" behavior should call `closeExpandedImage()` from their own
 * thread-change effect, exactly as `ChatViewContent` does.
 */
export function useRightSidebarController(
  options: UseRightSidebarControllerOptions,
): RightSidebarController {
  const { activeProjectKey, panelToggle } = options;

  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const expandTimelineImage = useCallback((preview: ExpandedImagePreview) => {
    setExpandedImage(preview);
  }, []);
  const closeExpandedImage = useCallback(() => {
    setExpandedImage(null);
  }, []);

  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);
  const bumpTerminalFocusRequestId = useCallback(() => {
    setTerminalFocusRequestId((value) => value + 1);
  }, []);

  const [pendingFileSurfaceIdsByProject, setPendingFileSurfaceIdsByProject] = useState<
    ReadonlyMap<string, ReadonlySet<string>>
  >(() => new Map());
  const pendingFileSurfaceIds = activeProjectKey
    ? (pendingFileSurfaceIdsByProject.get(activeProjectKey) ?? EMPTY_PENDING_FILE_SURFACE_IDS)
    : EMPTY_PENDING_FILE_SURFACE_IDS;
  const handleFilePendingChange = useCallback(
    (relativePath: string, pending: boolean) => {
      if (!activeProjectKey) return;
      setPendingFileSurfaceIdsByProject((currentByProject) =>
        updatePendingFileSurfaceIds(currentByProject, activeProjectKey, relativePath, pending),
      );
    },
    [activeProjectKey],
  );

  const panelToggleControls = (
    <PanelLayoutControls
      rightPanelAvailable={panelToggle.rightPanelAvailable}
      rightPanelOpen={panelToggle.rightPanelOpen}
      rightPanelShortcutLabel={panelToggle.rightPanelShortcutLabel}
      onToggleRightPanel={panelToggle.onToggleRightPanel}
    />
  );

  return {
    expandedImage,
    expandTimelineImage,
    closeExpandedImage,
    terminalFocusRequestId,
    bumpTerminalFocusRequestId,
    pendingFileSurfaceIds,
    handleFilePendingChange,
    panelToggleControls,
  };
}
