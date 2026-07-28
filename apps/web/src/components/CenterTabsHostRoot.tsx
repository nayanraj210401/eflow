import {
  type EnvironmentId,
  type PreviewSessionSnapshot,
  type ScopedProjectRef,
} from "@eflob/contracts";
import { lazy, Suspense } from "react";

import { type CenterTab } from "../centerTabsStore";
import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useAssembledRightSidebarProps } from "../hooks/useAssembledRightSidebarProps";
import { CenterTabsHost } from "./CenterTabsHost";
import ChatView from "./ChatView";
import { RightSidebar } from "./RightSidebar";
import PlanSidebar from "./PlanSidebar";
import type { ThreadId } from "@eflob/contracts";

const PreviewPanel = lazy(() =>
  import("./preview/PreviewPanel").then((module) => ({ default: module.PreviewPanel })),
);
const DiffPanel = lazy(() => import("./DiffPanel"));
const FilePreviewPanel = lazy(() => import("./files/FilePreviewPanel"));

export interface CenterTabsHostRootProps {
  projectRef: ScopedProjectRef | null | undefined;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  ownsDesktopTitleBar?: boolean;
  className?: string;
  /** Overridable for tests; see `CenterTabsHostProps`. */
  maxHiddenMountedThreadCount?: number;
}

/**
 * VSCode-style tab layout redesign, Phase 2 step 2: the singleton host that
 * mounts `CenterTabsHost` *above* any individual `ChatView` instance (a
 * sibling of the router's routed thread, not a descendant of it), so it can
 * both render one `ChatView` per open `thread` tab (via `renderThreadTab`,
 * `embedded`) and render the one right-sidebar reflecting whichever thread
 * tab is last-active (via `renderRightSidebar`) — the "circular mount"
 * problem noted in `CenterTabsHost`'s docs (it used to be mounted *inside*
 * `RightSidebar.tsx`, itself inside a single `ChatView`) is resolved by this
 * component living above all of that instead.
 *
 * Not yet mounted from any route (`_chat.tsx` or otherwise) — see the design
 * doc's phasing. This component is built and typechecked so the future
 * routing step only has to mount it, not design it.
 */
export function CenterTabsHostRoot({
  projectRef,
  previewSessions,
  ownsDesktopTitleBar,
  className,
  maxHiddenMountedThreadCount,
}: CenterTabsHostRootProps) {
  const environmentId: EnvironmentId | null = projectRef?.environmentId ?? null;
  if (!projectRef || !environmentId) return null;

  return (
    <CenterTabsHost
      projectRef={projectRef}
      previewSessions={previewSessions}
      {...(ownsDesktopTitleBar !== undefined ? { ownsDesktopTitleBar } : {})}
      {...(className !== undefined ? { className } : {})}
      {...(maxHiddenMountedThreadCount !== undefined ? { maxHiddenMountedThreadCount } : {})}
      renderFileTab={(tab) => <CenterTabFileContent environmentId={environmentId} tab={tab} />}
      renderDiffTab={(tab) => <CenterTabDiffContent environmentId={environmentId} tab={tab} />}
      renderPlanTab={(tab) => <CenterTabPlanContent environmentId={environmentId} tab={tab} />}
      renderPreviewTab={(tab) => (
        <CenterTabPreviewContent environmentId={environmentId} tab={tab} />
      )}
      renderThreadTab={(tab, { visible }) => (
        <ThreadTabChatView environmentId={environmentId} tab={tab} visible={visible} />
      )}
      renderRightSidebar={(activeThreadTab) =>
        activeThreadTab ? (
          <RightSidebarForThreadTab environmentId={environmentId} target={activeThreadTab.target} />
        ) : null
      }
    />
  );
}

function ThreadTabChatView({
  environmentId,
  tab,
  visible: _visible,
}: {
  environmentId: EnvironmentId;
  tab: Extract<CenterTab, { kind: "thread" }>;
  visible: boolean;
}) {
  // `visible` is intentionally unused for rendering decisions today (see
  // `CenterTabsHost`'s render-prop doc: never conditionally render `null`
  // based on it — the wrapping `hidden` class already handles visibility
  // while keeping the instance mounted/streaming). Threaded through as a
  // parameter so a future need (e.g. suspending non-visible work) has
  // somewhere to read it from without touching this call site's shape.
  const target = tab.target;
  if (target.kind === "server") {
    return (
      <ChatView
        environmentId={target.threadRef.environmentId}
        threadId={target.threadRef.threadId}
        routeKind="server"
        embedded
      />
    );
  }
  return <DraftThreadTabChatView environmentId={environmentId} draftId={target.draftId} />;
}

function DraftThreadTabChatView({
  environmentId,
  draftId,
}: {
  environmentId: EnvironmentId;
  draftId: DraftId;
}) {
  // A draft tab's `threadId` (the pre-allocated id standing in for the
  // not-yet-promoted server thread) lives on its draft session; resolved
  // directly here since `ChatView` only needs the id, not the whole
  // assembled right-sidebar prop set.
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const threadId: ThreadId | null = draftSession?.threadId ?? null;
  if (!threadId) return null;
  return (
    <ChatView
      environmentId={draftSession?.environmentId ?? environmentId}
      threadId={threadId}
      routeKind="draft"
      draftId={draftId}
      embedded
    />
  );
}

function RightSidebarForThreadTab({
  environmentId,
  target,
}: {
  environmentId: EnvironmentId;
  target: Extract<CenterTab, { kind: "thread" }>["target"];
}) {
  const props = useAssembledRightSidebarProps({ environmentId, target });
  if (!props) return null;
  return <RightSidebar {...props} />;
}

function CenterTabFileContent({
  environmentId,
  tab,
}: {
  environmentId: EnvironmentId;
  tab: Extract<CenterTab, { kind: "file" }>;
}) {
  const props = useAssembledRightSidebarProps({ environmentId, target: tab.threadRef });
  if (!props || !props.activeProject || !props.activeWorkspaceRoot || !props.activeThreadRef) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <FilePreviewPanel
        key={`${props.activeProject.environmentId}:${props.activeWorkspaceRoot}`}
        environmentId={props.activeProject.environmentId}
        cwd={props.activeWorkspaceRoot}
        projectName={props.activeProject.title}
        threadRef={props.activeThreadRef}
        composerDraftTarget={props.composerDraftTarget}
        keybindings={props.keybindings}
        availableEditors={props.availableEditors}
        relativePath={tab.relativePath}
        revealLine={tab.revealLine}
        revealRequestId={tab.revealRequestId}
        onOpenFile={props.openFileSurface}
        onPendingChange={props.handleFilePendingChange}
        showEmbeddedExplorer={false}
      />
    </Suspense>
  );
}

function CenterTabDiffContent({
  environmentId,
  tab,
}: {
  environmentId: EnvironmentId;
  tab: Extract<CenterTab, { kind: "diff" }>;
}) {
  const props = useAssembledRightSidebarProps({ environmentId, target: tab.threadRef });
  if (!props || !props.activeThreadRef) return null;
  return (
    <Suspense fallback={null}>
      <DiffPanel
        key={`${props.activeThreadKey}:${props.diffPanelGitStatusResolutionKey}`}
        mode="embedded"
        composerDraftTarget={props.composerDraftTarget}
        initialGitScope={props.initialDiffPanelGitScope}
      />
    </Suspense>
  );
}

function CenterTabPlanContent({
  environmentId,
  tab,
}: {
  environmentId: EnvironmentId;
  tab: Extract<CenterTab, { kind: "plan" }>;
}) {
  const props = useAssembledRightSidebarProps({ environmentId, target: tab.threadRef });
  if (!props || !props.activeThreadRef) return null;
  return (
    <PlanSidebar
      activePlan={props.activePlan}
      activeProposedPlan={props.sidebarProposedPlan}
      label={props.planSidebarLabel}
      environmentId={props.environmentId}
      threadRef={props.activeThreadRef}
      markdownCwd={props.gitCwd ?? undefined}
      workspaceRoot={props.activeWorkspaceRoot}
      timestampFormat={props.timestampFormat}
      mode="embedded"
    />
  );
}

function CenterTabPreviewContent({
  environmentId,
  tab,
}: {
  environmentId: EnvironmentId;
  tab: Extract<CenterTab, { kind: "preview" }>;
}) {
  const props = useAssembledRightSidebarProps({ environmentId, target: tab.threadRef });
  if (!props || !props.activeThreadRef) return null;
  return (
    <Suspense fallback={null}>
      <PreviewPanel
        mode="embedded"
        threadRef={props.activeThreadRef}
        tabId={tab.previewTabId}
        configuredUrls={props.configuredPreviewUrls}
        visible
      />
    </Suspense>
  );
}
