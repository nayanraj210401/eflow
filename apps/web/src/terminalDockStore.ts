/**
 * Terminal dock state keyed by scoped thread identity.
 *
 * This store unifies the two mechanisms that historically existed for
 * terminals: top-level terminal "surfaces" (formerly tracked in
 * `rightPanelStore`) and within-surface "split" terminals (formerly tracked
 * in the now-deleted `terminalUiStateStore`). Here, each horizontal tab in
 * the terminal dock is one `TerminalDockGroup` (`{ terminalIds,
 * activeTerminalId, splitDirection }`). The "+" button creates a new
 * group/tab; splitting a terminal adds a pane within the active group's grid
 * instead of creating a new tab.
 *
 * This is the single terminal UI store (design doc: "exactly one terminal
 * UI, docked at the bottom of the right sidebar") -- it backs
 * `TerminalDockPanel`/`RightSidebarTerminalDock`, and `rightPanelStore` no
 * longer has a `"terminal"` surface kind at all.
 */
import { scopedThreadKey } from "@eflob/client-runtime/environment";
import type { ScopedThreadRef } from "@eflob/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

const TERMINAL_DOCK_STORAGE_KEY = "eflob:terminal-dock-state:v1";
const TERMINAL_DOCK_STORAGE_VERSION = 1;

export const TERMINAL_DOCK_MAX_PANES_PER_GROUP = 4;

export type TerminalDockSplitDirection = "horizontal" | "vertical";

export interface TerminalDockGroup {
  id: string;
  terminalIds: string[];
  activeTerminalId: string | null;
  splitDirection: TerminalDockSplitDirection | null;
}

export interface ThreadTerminalDockState {
  groupIds: string[];
  activeGroupId: string | null;
  groups: Record<string, TerminalDockGroup>;
}

const EMPTY_THREAD_DOCK_STATE: ThreadTerminalDockState = Object.freeze({
  groupIds: [],
  activeGroupId: null,
  groups: {},
});

function createDefaultThreadDockState(): ThreadTerminalDockState {
  return { groupIds: [], activeGroupId: null, groups: {} };
}

function isEmptyThreadDockState(state: ThreadTerminalDockState): boolean {
  return state.groupIds.length === 0 && state.activeGroupId === null;
}

let groupIdCounter = 0;

function generateGroupId(): string {
  groupIdCounter += 1;
  return `dock-group-${Date.now().toString(36)}-${groupIdCounter}`;
}

function updateThread(
  byThreadKey: Record<string, ThreadTerminalDockState>,
  threadKey: string,
  updater: (current: ThreadTerminalDockState) => ThreadTerminalDockState,
): Record<string, ThreadTerminalDockState> {
  const current = byThreadKey[threadKey] ?? EMPTY_THREAD_DOCK_STATE;
  const next = updater(current);
  if (next === current) return byThreadKey;
  if (isEmptyThreadDockState(next)) {
    if (!(threadKey in byThreadKey)) return byThreadKey;
    const { [threadKey]: _removed, ...rest } = byThreadKey;
    return rest;
  }
  return { ...byThreadKey, [threadKey]: next };
}

function createGroupState(
  current: ThreadTerminalDockState,
  terminalId: string | null = null,
): ThreadTerminalDockState {
  const groupId = generateGroupId();
  const group: TerminalDockGroup = {
    id: groupId,
    terminalIds: terminalId ? [terminalId] : [],
    activeTerminalId: terminalId,
    splitDirection: null,
  };
  return {
    groupIds: [...current.groupIds, groupId],
    activeGroupId: groupId,
    groups: { ...current.groups, [groupId]: group },
  };
}

function closeGroupState(
  current: ThreadTerminalDockState,
  groupId: string,
): ThreadTerminalDockState {
  if (!(groupId in current.groups)) return current;
  const index = current.groupIds.indexOf(groupId);
  const groupIds = current.groupIds.filter((id) => id !== groupId);
  const { [groupId]: _removed, ...groups } = current.groups;
  const fallbackGroupId = groupIds[Math.min(index, groupIds.length - 1)] ?? null;
  return {
    groupIds,
    groups,
    activeGroupId: current.activeGroupId === groupId ? fallbackGroupId : current.activeGroupId,
  };
}

function activateGroupState(
  current: ThreadTerminalDockState,
  groupId: string,
): ThreadTerminalDockState {
  if (!(groupId in current.groups) || current.activeGroupId === groupId) return current;
  return { ...current, activeGroupId: groupId };
}

function splitTerminalState(
  current: ThreadTerminalDockState,
  groupId: string,
  terminalId: string,
  direction: TerminalDockSplitDirection = "horizontal",
): ThreadTerminalDockState {
  const group = current.groups[groupId];
  if (!group) return current;
  if (group.terminalIds.includes(terminalId)) {
    if (group.activeTerminalId === terminalId && group.splitDirection === direction) {
      return current;
    }
    return {
      ...current,
      activeGroupId: groupId,
      groups: {
        ...current.groups,
        [groupId]: { ...group, activeTerminalId: terminalId, splitDirection: direction },
      },
    };
  }
  if (group.terminalIds.length >= TERMINAL_DOCK_MAX_PANES_PER_GROUP) {
    return current;
  }
  const nextGroup: TerminalDockGroup = {
    ...group,
    terminalIds: [...group.terminalIds, terminalId],
    activeTerminalId: terminalId,
    splitDirection: direction,
  };
  return {
    ...current,
    activeGroupId: groupId,
    groups: { ...current.groups, [groupId]: nextGroup },
  };
}

function closeTerminalPaneState(
  current: ThreadTerminalDockState,
  groupId: string,
  terminalId: string,
): ThreadTerminalDockState {
  const group = current.groups[groupId];
  if (!group || !group.terminalIds.includes(terminalId)) return current;
  const terminalIds = group.terminalIds.filter((id) => id !== terminalId);
  if (terminalIds.length === 0) {
    return closeGroupState(current, groupId);
  }
  const closedIndex = group.terminalIds.indexOf(terminalId);
  const activeTerminalId =
    group.activeTerminalId === terminalId
      ? (terminalIds[Math.min(closedIndex, terminalIds.length - 1)] ?? terminalIds[0]!)
      : group.activeTerminalId;
  const nextGroup: TerminalDockGroup = {
    ...group,
    terminalIds,
    activeTerminalId,
    splitDirection: terminalIds.length > 1 ? group.splitDirection : null,
  };
  return { ...current, groups: { ...current.groups, [groupId]: nextGroup } };
}

function activateTerminalPaneState(
  current: ThreadTerminalDockState,
  groupId: string,
  terminalId: string,
): ThreadTerminalDockState {
  const group = current.groups[groupId];
  if (!group || !group.terminalIds.includes(terminalId)) return current;
  if (current.activeGroupId === groupId && group.activeTerminalId === terminalId) return current;
  return {
    ...current,
    activeGroupId: groupId,
    groups: { ...current.groups, [groupId]: { ...group, activeTerminalId: terminalId } },
  };
}

export function migratePersistedTerminalDockState(persistedState: unknown): {
  byThreadKey: Record<string, ThreadTerminalDockState>;
} {
  if (!persistedState || typeof persistedState !== "object") {
    return { byThreadKey: {} };
  }
  const candidate = persistedState as { byThreadKey?: unknown };
  if (!candidate.byThreadKey || typeof candidate.byThreadKey !== "object") {
    return { byThreadKey: {} };
  }
  const byThreadKey = Object.fromEntries(
    Object.entries(candidate.byThreadKey as Record<string, ThreadTerminalDockState>).flatMap(
      ([threadKey, threadState]) => {
        if (!threadState || typeof threadState !== "object") return [];
        const groupsRecord =
          "groups" in threadState && threadState.groups && typeof threadState.groups === "object"
            ? (threadState.groups as Record<string, TerminalDockGroup>)
            : {};
        const groupIds = Array.isArray(threadState.groupIds)
          ? threadState.groupIds.filter(
              (groupId): groupId is string =>
                typeof groupId === "string" && groupId in groupsRecord,
            )
          : [];
        const groups: Record<string, TerminalDockGroup> = {};
        for (const groupId of groupIds) {
          const group = groupsRecord[groupId];
          if (!group) continue;
          const terminalIds = Array.isArray(group.terminalIds)
            ? [...new Set(group.terminalIds.filter((id): id is string => typeof id === "string"))]
            : [];
          const activeTerminalId =
            typeof group.activeTerminalId === "string" &&
            terminalIds.includes(group.activeTerminalId)
              ? group.activeTerminalId
              : (terminalIds[0] ?? null);
          const splitDirection =
            group.splitDirection === "horizontal" || group.splitDirection === "vertical"
              ? group.splitDirection
              : null;
          groups[groupId] = { id: groupId, terminalIds, activeTerminalId, splitDirection };
        }
        const activeGroupId =
          typeof threadState.activeGroupId === "string" && threadState.activeGroupId in groups
            ? threadState.activeGroupId
            : (groupIds[0] ?? null);
        const nextState: ThreadTerminalDockState = { groupIds, activeGroupId, groups };
        if (isEmptyThreadDockState(nextState)) return [];
        return [[threadKey, nextState]];
      },
    ),
  );
  return { byThreadKey };
}

interface TerminalDockStoreState {
  byThreadKey: Record<string, ThreadTerminalDockState>;
  createGroup: (ref: ScopedThreadRef, terminalId?: string | null) => void;
  closeGroup: (ref: ScopedThreadRef, groupId: string) => void;
  activateGroup: (ref: ScopedThreadRef, groupId: string) => void;
  splitTerminal: (
    ref: ScopedThreadRef,
    groupId: string,
    terminalId: string,
    direction?: TerminalDockSplitDirection,
  ) => void;
  closeTerminalPane: (ref: ScopedThreadRef, groupId: string, terminalId: string) => void;
  activateTerminalPane: (ref: ScopedThreadRef, groupId: string, terminalId: string) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

export const useTerminalDockStore = create<TerminalDockStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      createGroup: (ref, terminalId = null) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            createGroupState(current, terminalId),
          ),
        })),
      closeGroup: (ref, groupId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            closeGroupState(current, groupId),
          ),
        })),
      activateGroup: (ref, groupId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            activateGroupState(current, groupId),
          ),
        })),
      splitTerminal: (ref, groupId, terminalId, direction = "horizontal") =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            splitTerminalState(current, groupId, terminalId, direction),
          ),
        })),
      closeTerminalPane: (ref, groupId, terminalId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            closeTerminalPaneState(current, groupId, terminalId),
          ),
        })),
      activateTerminalPane: (ref, groupId, terminalId) =>
        set((state) => ({
          byThreadKey: updateThread(state.byThreadKey, scopedThreadKey(ref), (current) =>
            activateTerminalPaneState(current, groupId, terminalId),
          ),
        })),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (!(threadKey in state.byThreadKey)) return state;
          const { [threadKey]: _removed, ...rest } = state.byThreadKey;
          return { byThreadKey: rest };
        }),
    }),
    {
      name: TERMINAL_DOCK_STORAGE_KEY,
      version: TERMINAL_DOCK_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      // Only the structural tab/group/split layout is persisted; live
      // terminal buffer content lives elsewhere and is never stored here.
      partialize: (state) => ({ byThreadKey: state.byThreadKey }),
      migrate: migratePersistedTerminalDockState,
    },
  ),
);

export function selectThreadTerminalDockState(
  byThreadKey: Record<string, ThreadTerminalDockState>,
  ref: ScopedThreadRef | null | undefined,
): ThreadTerminalDockState {
  if (!ref) return createDefaultThreadDockState();
  return byThreadKey[scopedThreadKey(ref)] ?? EMPTY_THREAD_DOCK_STATE;
}

/**
 * Whether a thread has any terminal dock groups (tabs) open at all — used by
 * places that previously asked the legacy `terminalUiStateStore` "is the
 * terminal panel open for this thread" (sidebar/command-palette toggle
 * affordances, keybinding-context effects, etc). The terminal dock itself is
 * always rendered as part of the right sidebar now (design doc: "exactly one
 * terminal UI, docked at the bottom of the right sidebar"), so "open" here
 * means "has at least one live terminal group", not "is a separate panel
 * visible".
 */
export function selectThreadHasTerminalGroups(
  byThreadKey: Record<string, ThreadTerminalDockState>,
  ref: ScopedThreadRef | null | undefined,
): boolean {
  return selectThreadTerminalDockState(byThreadKey, ref).groupIds.length > 0;
}

/** All terminal ids (across every group/tab) currently tracked for a thread. */
export function selectThreadAllTerminalIds(
  byThreadKey: Record<string, ThreadTerminalDockState>,
  ref: ScopedThreadRef | null | undefined,
): string[] {
  const state = selectThreadTerminalDockState(byThreadKey, ref);
  return state.groupIds.flatMap((groupId) => state.groups[groupId]?.terminalIds ?? []);
}

export function selectActiveTerminalDockGroup(
  byThreadKey: Record<string, ThreadTerminalDockState>,
  ref: ScopedThreadRef | null | undefined,
): TerminalDockGroup | null {
  const state = selectThreadTerminalDockState(byThreadKey, ref);
  if (!state.activeGroupId) return null;
  return state.groups[state.activeGroupId] ?? null;
}
