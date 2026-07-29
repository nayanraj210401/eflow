/**
 * Thread/draft/project/git resolution prelude, hoisted out of
 * `ChatViewContent` (`ChatView.tsx`).
 *
 * This is STEP A of the two-step "hoist the right-sidebar props out of
 * `ChatView.tsx`" plan (see
 * `.context/attachments/.../vscode-style-tab-layout-redesign-for-eflob.md`,
 * Phase 2). Roughly fifteen values/callbacks the (eventually singleton)
 * `RightSidebar` needs are downstream of this resolution — draft promotion,
 * active project/git lookup, keybindings/editors — so it has to be its own
 * hook before those callbacks can be hoisted on top of it. A later, separate
 * task builds the remaining right-panel-callback hoist on top of this one.
 *
 * Scope: resolves which thread is "active" (server thread, or a local draft
 * standing in for one not yet promoted), then everything that's keyed off
 * that resolution and cheap/pure to compute here: the active project, git
 * cwd/status, workspace root, and the primary server's keybindings/editors
 * (read here because `RightSidebar` needs them, not because they're
 * thread-scoped).
 *
 * Explicitly NOT here (stays in `ChatViewContent`): terminal session queries
 * (`useThreadRunningTerminalIds`/`useKnownTerminalSessions`), right-panel/
 * center-tab derived state, and anything keyed by component-local state
 * (error banners, composer drafts) — those are either a different concern
 * (terminal/right-panel UI) or belong to the later right-panel-callback hoist
 * this hook is groundwork for.
 */

import {
  type EditorId,
  type EnvironmentId,
  type ResolvedKeybindingsConfig,
  type ScopedProjectRef,
  type ScopedThreadRef,
  type ThreadId,
  type TimestampFormat,
  type VcsStatusResult,
} from "@eflob/contracts";
import { projectScriptCwd } from "@eflob/shared/projectScripts";
import { useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@eflob/client-runtime/environment";

import { buildLocalDraftThread } from "../components/ChatView.logic";
import { type DraftId, type DraftThreadState, useComposerDraftStore } from "../composerDraftStore";
import { useEnvironmentSettings } from "./useSettings";
import { NO_PROVIDER_MODEL_SELECTION } from "../providerInstances";
import { primaryServerAvailableEditorsAtom, primaryServerKeybindingsAtom } from "../state/server";
import { useEnvironmentQuery, type EnvironmentQueryView } from "../state/query";
import { vcsEnvironment } from "../state/vcs";
import { useProject, useThread } from "../state/entities";

export interface UseActiveThreadResolutionOptions {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  routeKind: "server" | "draft";
  draftId: DraftId | null;
  routeThreadRef: ScopedThreadRef;
}

export interface ActiveThreadResolution {
  /** Target for `useComposerDraftStore` reads/writes for the routed thread. */
  composerDraftTarget: ScopedThreadRef | DraftId;
  /** The server-backed thread for the routed ref, or `null` before promotion. */
  serverThread: ReturnType<typeof useThread>;
  /** Raw draft session backing `localDraftThread`, when the route is a draft. */
  draftThread: DraftThreadState | null;
  /** Synthetic `Thread` standing in for a not-yet-promoted draft. */
  localDraftThread: ReturnType<typeof buildLocalDraftThread> | undefined;
  /** `true` once the routed thread has a server-backed session. */
  isServerThread: boolean;
  /** `serverThread` if promoted, otherwise `localDraftThread`. */
  activeThread:
    | NonNullable<ReturnType<typeof useThread>>
    | ReturnType<typeof buildLocalDraftThread>
    | undefined;
  /** `true` while rendering a draft that hasn't been promoted yet. */
  isLocalDraftThread: boolean;
  activeThreadId: ThreadId | null;
  activeThreadRef: ScopedThreadRef | null;
  activeThreadKey: string | null;
  activeProjectRef: ScopedProjectRef | null;
  activeProject: ReturnType<typeof useProject>;
  activeProjectCwd: string | null;
  activeThreadWorktreePath: string | null;
  activeWorkspaceRoot: string | undefined;
  gitCwd: string | null;
  gitStatusQuery: EnvironmentQueryView<VcsStatusResult>;
  /** Default `true` while `gitStatusQuery` is loading, to avoid toolbar flicker. */
  isGitRepo: boolean;
  timestampFormat: TimestampFormat;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
}

/**
 * Resolves the routed thread into everything `ChatViewContent` and the
 * (eventually singleton) `RightSidebar` need to know about "which thread,
 * project, and git context are active right now" — no UI, no component
 * state, just derivation from route params + server/draft/project state.
 *
 * Call this once per `ChatViewContent`/thread-tab instance, early — before
 * anything that reads its outputs, including effects defined later in the
 * component — matching how `useRightSidebarController` is positioned.
 */
export function useActiveThreadResolution(
  options: UseActiveThreadResolutionOptions,
): ActiveThreadResolution {
  const { environmentId, threadId, routeKind, draftId, routeThreadRef } = options;

  const composerDraftTarget: ScopedThreadRef | DraftId =
    routeKind === "server" ? routeThreadRef : (draftId as DraftId);
  const serverThread = useThread(routeThreadRef);

  const draftThread = useComposerDraftStore((store) =>
    routeKind === "server"
      ? store.getDraftSessionByRef(routeThreadRef)
      : draftId
        ? store.getDraftSession(draftId)
        : null,
  );

  const fallbackDraftProjectRef = draftThread
    ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
    : null;
  const fallbackDraftProject = useProject(fallbackDraftProjectRef);

  const localDraftThread = useMemo(
    () =>
      draftThread
        ? buildLocalDraftThread(
            threadId,
            draftThread,
            fallbackDraftProject?.defaultModelSelection ?? NO_PROVIDER_MODEL_SELECTION,
          )
        : undefined,
    [draftThread, fallbackDraftProject?.defaultModelSelection, threadId],
  );

  // Promotion is data-driven: the draft route keeps rendering while the
  // server thread (same pre-allocated ref) starts, so live state must not
  // depend on which route is mounted.
  const isServerThread = serverThread !== null;
  const activeThread = isServerThread ? serverThread : localDraftThread;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  const activeThreadId = activeThread?.id ?? null;

  const activeThreadRef = useMemo(
    () => (activeThread ? scopeThreadRef(activeThread.environmentId, activeThread.id) : null),
    [activeThread],
  );
  const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;

  const activeProjectRef = activeThread
    ? scopeProjectRef(activeThread.environmentId, activeThread.projectId)
    : null;
  const activeProject = useProject(activeProjectRef);
  const activeProjectCwd = activeProject?.workspaceRoot ?? null;
  const activeThreadWorktreePath = activeThread?.worktreePath ?? null;
  const activeWorkspaceRoot = activeThreadWorktreePath ?? activeProjectCwd ?? undefined;

  const gitCwd = activeProject
    ? projectScriptCwd({
        project: { cwd: activeProject.workspaceRoot },
        worktreePath: activeThread?.worktreePath ?? null,
      })
    : null;
  const gitStatusCwd = activeThread?.worktreePath ?? gitCwd;
  const gitStatusQuery = useEnvironmentQuery(
    gitStatusCwd === null
      ? null
      : vcsEnvironment.status({
          environmentId,
          input: { cwd: gitStatusCwd },
        }),
  );
  // Default true while loading to avoid toolbar flicker.
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;

  const timestampFormat = useEnvironmentSettings(
    environmentId,
    (settings) => settings.timestampFormat,
  );
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);

  return {
    composerDraftTarget,
    serverThread,
    draftThread,
    localDraftThread,
    isServerThread,
    activeThread,
    isLocalDraftThread,
    activeThreadId,
    activeThreadRef,
    activeThreadKey,
    activeProjectRef,
    activeProject,
    activeProjectCwd,
    activeThreadWorktreePath,
    activeWorkspaceRoot,
    gitCwd,
    gitStatusQuery,
    isGitRepo,
    timestampFormat,
    keybindings,
    availableEditors,
  };
}
