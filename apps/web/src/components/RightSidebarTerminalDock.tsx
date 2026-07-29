import { useMemo } from "react";
import {
  type EnvironmentId,
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
} from "@eflob/contracts";

import { useThread } from "../state/entities";
import { scopeProjectRef } from "@eflob/client-runtime/environment";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@eflob/shared/projectScripts";
import { useComposerDraftStore } from "../composerDraftStore";
import type { TerminalContextSelection } from "../lib/terminalContext";
import TerminalDockPanel from "./TerminalDockPanel";

export interface RightSidebarTerminalDockProps {
  threadRef: ScopedThreadRef;
  gitCwd: string | null;
  activeProject: { environmentId: EnvironmentId; title: string; workspaceRoot: string } | null;
  focusRequestId: number;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
  keybindings: ResolvedKeybindingsConfig;
}

/**
 * The single terminal UI for the right sidebar (design doc: "exactly one
 * terminal UI, docked at the bottom of the right sidebar"), backed by the
 * per-thread `terminalDockStore`-driven `TerminalDockPanel`. Used by both the
 * wide/inline layout's fixed bottom dock (`RightSidebarDock`) and the
 * narrow-viewport plan-sidebar-sheet layout, so there is exactly one terminal
 * store and one terminal panel component regardless of layout mode.
 */
export function RightSidebarTerminalDock({
  threadRef,
  gitCwd,
  activeProject,
  focusRequestId,
  onAddTerminalContext,
  keybindings,
}: RightSidebarTerminalDockProps) {
  const serverThread = useThread(threadRef);
  const draftThread = useComposerDraftStore((store) => store.getDraftThreadByRef(threadRef));
  const threadWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const cwd =
    gitCwd ??
    (activeProject
      ? projectScriptCwd({
          project: { cwd: activeProject.workspaceRoot },
          worktreePath: threadWorktreePath,
        })
      : null);
  const runtimeEnv = useMemo(
    () =>
      activeProject
        ? projectScriptRuntimeEnv({
            project: { cwd: activeProject.workspaceRoot },
            worktreePath: threadWorktreePath,
          })
        : {},
    [activeProject, threadWorktreePath],
  );

  if (!cwd) return null;

  return (
    <TerminalDockPanel
      threadRef={threadRef}
      threadId={threadRef.threadId}
      cwd={cwd}
      worktreePath={threadWorktreePath}
      runtimeEnv={runtimeEnv}
      focusRequestId={focusRequestId}
      onAddTerminalContext={onAddTerminalContext}
      keybindings={keybindings}
    />
  );
}
