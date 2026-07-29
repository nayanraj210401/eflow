import { useMemo } from "react";
import { Plus, SquareSplitHorizontal, TerminalSquare } from "lucide-react";
import {
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
  type ThreadId,
} from "@eflob/contracts";
import { getTerminalLabel } from "@eflob/shared/terminalLabels";

import { TabStrip, type TabStripItem } from "~/components/ui/tabs";
import { randomUUID } from "~/lib/utils";
import {
  type TerminalDockGroup,
  selectThreadTerminalDockState,
  useTerminalDockStore,
} from "../terminalDockStore";
import ThreadTerminalDrawer from "./ThreadTerminalDrawer";
import { type TerminalContextSelection } from "~/lib/terminalContext";

/**
 * Horizontal tab strip over `terminalDockStore` groups. Each tab is one
 * top-level terminal session (a `TerminalDockGroup`); the active group's
 * pane grid (including splits) is rendered below via `ThreadTerminalDrawer`
 * in "panel" mode, reusing its xterm/@xterm-addon-fit rendering rather than
 * duplicating it.
 *
 * NOT wired into `ChatView.tsx` or any right-sidebar layout yet -- that
 * integration happens once the concurrent Phase 2 work (which owns
 * `ChatView.tsx`, the `_chat*` routes, and `DiffWorkerPoolProvider.tsx`)
 * lands and can adopt this panel as the terminal dock UI.
 */
export interface TerminalDockPanelProps {
  threadRef: ScopedThreadRef;
  threadId: ThreadId;
  cwd: string;
  worktreePath?: string | null;
  runtimeEnv?: Record<string, string>;
  focusRequestId: number;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
  keybindings: ResolvedKeybindingsConfig;
}

export default function TerminalDockPanel({
  threadRef,
  threadId,
  cwd,
  worktreePath,
  runtimeEnv,
  focusRequestId,
  onAddTerminalContext,
  keybindings,
}: TerminalDockPanelProps) {
  const byThreadKey = useTerminalDockStore((state) => state.byThreadKey);
  const createGroup = useTerminalDockStore((state) => state.createGroup);
  const closeGroup = useTerminalDockStore((state) => state.closeGroup);
  const activateGroup = useTerminalDockStore((state) => state.activateGroup);
  const splitTerminal = useTerminalDockStore((state) => state.splitTerminal);
  const closeTerminalPane = useTerminalDockStore((state) => state.closeTerminalPane);
  const activateTerminalPane = useTerminalDockStore((state) => state.activateTerminalPane);

  const dockState = selectThreadTerminalDockState(byThreadKey, threadRef);
  const groups: TerminalDockGroup[] = useMemo(
    () =>
      dockState.groupIds
        .map((groupId) => dockState.groups[groupId])
        .filter((g): g is TerminalDockGroup => Boolean(g)),
    [dockState],
  );
  const activeGroup =
    groups.find((group) => group.id === dockState.activeGroupId) ?? groups[0] ?? null;

  const tabItems: TabStripItem[] = useMemo(
    () =>
      groups.map((group) => {
        const label =
          group.terminalIds.length > 1
            ? `Terminal (${group.terminalIds.length} panes)`
            : getTerminalLabel(group.terminalIds[0] ?? group.id);
        return {
          id: group.id,
          label,
          icon: <TerminalSquare className="size-3.5" />,
          closable: true,
        };
      }),
    [groups],
  );

  const handleNewGroup = () => {
    createGroup(threadRef, randomUUID());
  };

  const handleSplitActiveGroup = () => {
    if (!activeGroup) return;
    splitTerminal(threadRef, activeGroup.id, randomUUID());
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex h-8 shrink-0 items-center border-b border-border/70 px-1">
        <TabStrip
          items={tabItems}
          activeTabId={activeGroup?.id ?? null}
          onActivate={(groupId) => activateGroup(threadRef, groupId)}
          onClose={(groupId) => closeGroup(threadRef, groupId)}
          trailingActions={
            <div className="inline-flex items-center gap-0.5">
              <button
                type="button"
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={handleSplitActiveGroup}
                aria-label="Split terminal"
                disabled={!activeGroup}
              >
                <SquareSplitHorizontal className="size-3.5" />
              </button>
              <button
                type="button"
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={handleNewGroup}
                aria-label="New terminal"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
          }
        />
      </div>
      <div className="min-h-0 flex-1">
        {activeGroup ? (
          <ThreadTerminalDrawer
            mode="panel"
            showTabBar={false}
            threadRef={threadRef}
            threadId={threadId}
            cwd={cwd}
            {...(worktreePath !== undefined ? { worktreePath } : {})}
            {...(runtimeEnv ? { runtimeEnv } : {})}
            terminalIds={activeGroup.terminalIds}
            activeTerminalId={activeGroup.activeTerminalId ?? activeGroup.terminalIds[0] ?? ""}
            terminalGroups={[
              {
                id: activeGroup.id,
                terminalIds: activeGroup.terminalIds,
                ...(activeGroup.splitDirection
                  ? { splitDirection: activeGroup.splitDirection }
                  : {}),
              },
            ]}
            activeTerminalGroupId={activeGroup.id}
            focusRequestId={focusRequestId}
            onSplitTerminal={handleSplitActiveGroup}
            onSplitTerminalVertical={() => {
              if (!activeGroup) return;
              splitTerminal(threadRef, activeGroup.id, randomUUID(), "vertical");
            }}
            onNewTerminal={handleNewGroup}
            onActiveTerminalChange={(terminalId) =>
              activateTerminalPane(threadRef, activeGroup.id, terminalId)
            }
            onCloseTerminal={(terminalId) =>
              closeTerminalPane(threadRef, activeGroup.id, terminalId)
            }
            onAddTerminalContext={onAddTerminalContext}
            keybindings={keybindings}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-6 text-center text-sm text-muted-foreground">
            <p>No terminal sessions for this thread yet.</p>
            <button
              type="button"
              className="rounded-md border border-border/80 bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              onClick={handleNewGroup}
            >
              New Terminal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
