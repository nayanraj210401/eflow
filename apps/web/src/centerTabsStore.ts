/**
 * Project-scoped central tab strip state (VSCode-style tab layout).
 *
 * This generalizes rightPanelStore.ts's per-thread surface model to a
 * per-project set of tabs that can reference threads, files, diffs, plans,
 * and previews. Unlike rightPanelStore.ts, ordering is explicit via `tabIds`
 * (rather than implicit array order) so a future drag-to-reorder interaction
 * has somewhere to write to.
 *
 * Scoped by *project* (`environmentId` + `projectId`), not just
 * `environmentId`: a single environment (connection) can host many projects
 * (repos/worktrees), and threads from different projects must never share a
 * tab strip — see the cross-project tab bleed this scoping fixes.
 *
 * Singleton kinds (confirmed with the user): `diff`, `plan`, and `preview`
 * are each at most one tab per thread — opening one of these kinds again for
 * a thread that already has one refocuses/updates the existing tab instead
 * of creating a duplicate. `thread` and `file` are not singletons: multiple
 * thread tabs and multiple file tabs (one per distinct relativePath) can be
 * open simultaneously.
 */
import { scopedProjectKey, scopedThreadKey } from "@eflob/client-runtime/environment";
import type { ScopedProjectRef } from "@eflob/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { readClientSettings } from "./hooks/useSettings";
import { resolveStorage } from "./lib/storage";
import type { ThreadRouteTarget } from "./threadRoutes";

/** Current "max tabs per thread" setting, read synchronously at the point a tab opens (see `readClientSettings`'s doc). */
function currentMaxTabsPerThread(): number {
  return readClientSettings().maxTabsPerThread;
}

export const CENTER_TAB_KINDS = ["thread", "file", "diff", "plan", "preview"] as const;
export type CenterTabKind = (typeof CENTER_TAB_KINDS)[number];

export type CenterTab =
  | {
      id: string;
      kind: "thread";
      target: ThreadRouteTarget;
    }
  | {
      id: string;
      kind: "file";
      threadRef: ThreadRouteTarget;
      relativePath: string;
      revealLine: number | null;
      revealRequestId: number;
    }
  | {
      id: string;
      kind: "diff";
      threadRef: ThreadRouteTarget;
      revealRequestId: number;
    }
  | {
      id: string;
      kind: "plan";
      threadRef: ThreadRouteTarget;
    }
  | {
      id: string;
      kind: "preview";
      threadRef: ThreadRouteTarget;
      previewTabId: string | null;
    };

const CENTER_TABS_STORAGE_KEY = "eflob:center-tabs-state:v1";
const CENTER_TABS_STORAGE_VERSION = 2;

export interface EnvironmentCenterTabsState {
  tabIds: string[];
  activeTabId: string | null;
  tabs: Record<string, CenterTab>;
  /**
   * Tracks whichever `thread`-kind tab is currently (or was most recently)
   * active — the "owning thread" context that scopes which `file`/`diff`/
   * `plan`/`preview` tabs are visible in the tab strip (see
   * `selectVisibleCenterTabIds`) and which thread the singleton
   * `RightSidebar` reflects. Updated whenever a thread tab is opened or
   * activated; left untouched when a non-thread tab is activated (a file tab
   * doesn't change "whose" tabs are in view).
   */
  activeThreadTabId: string | null;
}

interface CenterTabsStoreState {
  byProjectKey: Record<string, EnvironmentCenterTabsState>;
  openThreadTab: (projectRef: ScopedProjectRef, target: ThreadRouteTarget) => void;
  openFileTab: (
    projectRef: ScopedProjectRef,
    threadRef: ThreadRouteTarget,
    relativePath: string,
    line?: number,
  ) => void;
  openDiffTab: (
    projectRef: ScopedProjectRef,
    threadRef: ThreadRouteTarget,
    options?: { revealPath?: boolean },
  ) => void;
  openPlanTab: (projectRef: ScopedProjectRef, threadRef: ThreadRouteTarget) => void;
  openPreviewTab: (
    projectRef: ScopedProjectRef,
    threadRef: ThreadRouteTarget,
    previewTabId?: string | null,
  ) => void;
  activateTab: (projectRef: ScopedProjectRef, tabId: string) => void;
  closeTab: (projectRef: ScopedProjectRef, tabId: string) => void;
  closeOtherTabs: (projectRef: ScopedProjectRef, tabId: string) => void;
  closeTabsToRight: (projectRef: ScopedProjectRef, tabId: string) => void;
  closeAllTabs: (projectRef: ScopedProjectRef) => void;
  reorderTab: (projectRef: ScopedProjectRef, tabId: string, toIndex: number) => void;
  reconcileThreadTabs: (
    projectRef: ScopedProjectRef,
    availableTarget: {
      threadKeys: ReadonlySet<string>;
      draftIds: ReadonlySet<string>;
    },
  ) => void;
}

const EMPTY_ENVIRONMENT_STATE: EnvironmentCenterTabsState = {
  tabIds: [],
  activeTabId: null,
  tabs: {},
  activeThreadTabId: null,
};

/** Stable key for a ThreadRouteTarget, used both for singleton lookups and tab id namespacing. */
function threadTargetKey(target: ThreadRouteTarget): string {
  return target.kind === "server" ? scopedThreadKey(target.threadRef) : `draft:${target.draftId}`;
}

function normalizeRevealLine(line: number | undefined): number | null {
  if (line === undefined || !Number.isFinite(line)) return null;
  return Math.max(1, Math.trunc(line));
}

function updateEnvironment(
  byProjectKey: Record<string, EnvironmentCenterTabsState>,
  projectKey: string,
  updater: (current: EnvironmentCenterTabsState) => EnvironmentCenterTabsState,
): Record<string, EnvironmentCenterTabsState> {
  const current = byProjectKey[projectKey] ?? EMPTY_ENVIRONMENT_STATE;
  const next = updater(current);
  if (next === current) return byProjectKey;
  if (next.tabIds.length === 0) {
    if (!(projectKey in byProjectKey)) return byProjectKey;
    const { [projectKey]: _removed, ...rest } = byProjectKey;
    return rest;
  }
  return { ...byProjectKey, [projectKey]: next };
}

/**
 * Inserts a brand-new (not-yet-open) non-thread tab, first evicting the
 * oldest-opened tabs owned by the same thread if it's already at the
 * "max tabs per thread" cap (`readClientSettings().maxTabsPerThread`,
 * configurable in Settings > Beta). "Oldest" = earliest in `tabIds` order —
 * new tabs are always appended at the end, so a thread's own tabs are
 * naturally ordered oldest-to-newest unless manually drag-reordered.
 */
function evictOldestForThreadIfAtCap(
  current: EnvironmentCenterTabsState,
  threadKey: string,
  maxTabsPerThread: number,
): EnvironmentCenterTabsState {
  const ownedIds = current.tabIds.filter((id) => {
    const candidate = current.tabs[id];
    return (
      candidate !== undefined &&
      candidate.kind !== "thread" &&
      threadTargetKey(candidate.threadRef) === threadKey
    );
  });
  // +1: making room for the one new tab about to be inserted after this.
  const evictCount = ownedIds.length - maxTabsPerThread + 1;
  if (evictCount <= 0) return current;
  const evictIds = new Set(ownedIds.slice(0, evictCount));
  return {
    ...current,
    tabIds: current.tabIds.filter((id) => !evictIds.has(id)),
    tabs: Object.fromEntries(Object.entries(current.tabs).filter(([id]) => !evictIds.has(id))),
  };
}

function upsertTab(
  current: EnvironmentCenterTabsState,
  tab: CenterTab,
  activate = true,
): EnvironmentCenterTabsState {
  const exists = tab.id in current.tabs;
  const withRoom =
    !exists && tab.kind !== "thread"
      ? evictOldestForThreadIfAtCap(
          current,
          threadTargetKey(tab.threadRef),
          currentMaxTabsPerThread(),
        )
      : current;
  return {
    tabIds: exists ? withRoom.tabIds : [...withRoom.tabIds, tab.id],
    tabs: { ...withRoom.tabs, [tab.id]: tab },
    activeTabId: activate ? tab.id : withRoom.activeTabId,
    activeThreadTabId: activate && tab.kind === "thread" ? tab.id : withRoom.activeThreadTabId,
  };
}

/** Last remaining `thread`-kind tab in `tabIds` order, or `null` if none remain. */
function findFallbackThreadTabId(
  tabIds: readonly string[],
  tabs: Record<string, CenterTab>,
): string | null {
  for (let i = tabIds.length - 1; i >= 0; i--) {
    const id = tabIds[i];
    if (id === undefined) continue;
    const tab = tabs[id];
    if (tab && tab.kind === "thread") return id;
  }
  return null;
}

function findSingletonTab(
  current: EnvironmentCenterTabsState,
  kind: Exclude<CenterTabKind, "thread" | "file">,
  threadRef: ThreadRouteTarget,
): CenterTab | null {
  const key = threadTargetKey(threadRef);
  for (const tabId of current.tabIds) {
    const tab = current.tabs[tabId];
    if (tab && tab.kind === kind && threadTargetKey(tab.threadRef) === key) {
      return tab;
    }
  }
  return null;
}

export const useCenterTabsStore = create<CenterTabsStoreState>()(
  persist(
    (set) => ({
      byProjectKey: {},
      openThreadTab: (projectRef, target) =>
        set((state) => ({
          byProjectKey: updateEnvironment(
            state.byProjectKey,
            scopedProjectKey(projectRef),
            (current) => {
              const tabId = `thread:${threadTargetKey(target)}`;
              const tab: CenterTab = { id: tabId, kind: "thread", target };
              return upsertTab(current, tab);
            },
          ),
        })),
      openFileTab: (projectRef, threadRef, relativePath, line) =>
        set((state) => ({
          byProjectKey: updateEnvironment(
            state.byProjectKey,
            scopedProjectKey(projectRef),
            (current) => {
              const tabId = `file:${threadTargetKey(threadRef)}:${relativePath}`;
              const existing = current.tabs[tabId];
              const tab: CenterTab = {
                id: tabId,
                kind: "file",
                threadRef,
                relativePath,
                revealLine: normalizeRevealLine(line),
                revealRequestId:
                  existing && existing.kind === "file" ? existing.revealRequestId + 1 : 1,
              };
              return upsertTab(current, tab);
            },
          ),
        })),
      openDiffTab: (projectRef, threadRef, options) =>
        set((state) => ({
          byProjectKey: updateEnvironment(
            state.byProjectKey,
            scopedProjectKey(projectRef),
            (current) => {
              const existing = findSingletonTab(current, "diff", threadRef);
              if (existing && existing.kind === "diff") {
                const tab: CenterTab = options?.revealPath
                  ? { ...existing, revealRequestId: existing.revealRequestId + 1 }
                  : existing;
                return upsertTab(current, tab);
              }
              const tabId = `diff:${threadTargetKey(threadRef)}`;
              return upsertTab(current, { id: tabId, kind: "diff", threadRef, revealRequestId: 0 });
            },
          ),
        })),
      openPlanTab: (projectRef, threadRef) =>
        set((state) => ({
          byProjectKey: updateEnvironment(
            state.byProjectKey,
            scopedProjectKey(projectRef),
            (current) => {
              const existing = findSingletonTab(current, "plan", threadRef);
              if (existing) return upsertTab(current, existing);
              const tabId = `plan:${threadTargetKey(threadRef)}`;
              return upsertTab(current, { id: tabId, kind: "plan", threadRef });
            },
          ),
        })),
      openPreviewTab: (projectRef, threadRef, previewTabId = null) =>
        set((state) => ({
          byProjectKey: updateEnvironment(
            state.byProjectKey,
            scopedProjectKey(projectRef),
            (current) => {
              const existing = findSingletonTab(current, "preview", threadRef);
              if (existing && existing.kind === "preview") {
                const tab: CenterTab =
                  previewTabId !== null && previewTabId !== existing.previewTabId
                    ? { ...existing, previewTabId }
                    : existing;
                return upsertTab(current, tab);
              }
              const tabId = `preview:${threadTargetKey(threadRef)}`;
              return upsertTab(current, { id: tabId, kind: "preview", threadRef, previewTabId });
            },
          ),
        })),
      activateTab: (projectRef, tabId) =>
        set((state) => ({
          byProjectKey: updateEnvironment(
            state.byProjectKey,
            scopedProjectKey(projectRef),
            (current) => {
              const tab = current.tabs[tabId];
              if (!tab) return current;
              return {
                ...current,
                activeTabId: tabId,
                activeThreadTabId: tab.kind === "thread" ? tabId : current.activeThreadTabId,
              };
            },
          ),
        })),
      closeTab: (projectRef, tabId) =>
        set((state) => ({
          byProjectKey: updateEnvironment(
            state.byProjectKey,
            scopedProjectKey(projectRef),
            (current) => {
              const index = current.tabIds.indexOf(tabId);
              if (index < 0) return current;
              const closedTab = current.tabs[tabId];
              // Closing a thread tab also closes the file/diff/plan/preview
              // tabs it owns — otherwise they'd become permanently orphaned
              // (unreachable: they're only ever shown while their owning
              // thread tab is active, so with the thread gone they could never
              // be scoped into view again).
              const idsToRemove = new Set<string>([tabId]);
              if (closedTab && closedTab.kind === "thread") {
                const key = threadTargetKey(closedTab.target);
                for (const id of current.tabIds) {
                  const candidate = current.tabs[id];
                  if (
                    candidate &&
                    candidate.kind !== "thread" &&
                    threadTargetKey(candidate.threadRef) === key
                  ) {
                    idsToRemove.add(id);
                  }
                }
              }
              const tabIds = current.tabIds.filter((id) => !idsToRemove.has(id));
              const tabs = Object.fromEntries(
                Object.entries(current.tabs).filter(([id]) => !idsToRemove.has(id)),
              );
              const activeThreadTabId =
                current.activeThreadTabId !== null && idsToRemove.has(current.activeThreadTabId)
                  ? findFallbackThreadTabId(tabIds, tabs)
                  : current.activeThreadTabId;
              if (current.activeTabId === null || !idsToRemove.has(current.activeTabId)) {
                return { ...current, tabIds, tabs, activeThreadTabId };
              }
              const fallback = tabIds[Math.min(index, tabIds.length - 1)] ?? null;
              return { tabIds, tabs, activeTabId: fallback, activeThreadTabId };
            },
          ),
        })),
      closeOtherTabs: (projectRef, tabId) =>
        set((state) => ({
          byProjectKey: updateEnvironment(
            state.byProjectKey,
            scopedProjectKey(projectRef),
            (current) => {
              const tab = current.tabs[tabId];
              if (!tab || current.tabIds.length === 1) return current;
              return {
                tabIds: [tabId],
                tabs: { [tabId]: tab },
                activeTabId: tabId,
                activeThreadTabId: tab.kind === "thread" ? tabId : null,
              };
            },
          ),
        })),
      closeTabsToRight: (projectRef, tabId) =>
        set((state) => ({
          byProjectKey: updateEnvironment(
            state.byProjectKey,
            scopedProjectKey(projectRef),
            (current) => {
              const index = current.tabIds.indexOf(tabId);
              if (index < 0 || index === current.tabIds.length - 1) return current;
              const tabIds = current.tabIds.slice(0, index + 1);
              const tabIdSet = new Set(tabIds);
              const tabs = Object.fromEntries(
                Object.entries(current.tabs).filter(([id]) => tabIdSet.has(id)),
              );
              const activeStillExists =
                current.activeTabId !== null && tabIdSet.has(current.activeTabId);
              const activeThreadStillExists =
                current.activeThreadTabId !== null && tabIdSet.has(current.activeThreadTabId);
              return {
                tabIds,
                tabs,
                activeTabId: activeStillExists ? current.activeTabId : tabId,
                activeThreadTabId: activeThreadStillExists
                  ? current.activeThreadTabId
                  : findFallbackThreadTabId(tabIds, tabs),
              };
            },
          ),
        })),
      closeAllTabs: (projectRef) =>
        set((state) => ({
          byProjectKey: updateEnvironment(
            state.byProjectKey,
            scopedProjectKey(projectRef),
            (current) =>
              current.tabIds.length === 0
                ? current
                : { tabIds: [], tabs: {}, activeTabId: null, activeThreadTabId: null },
          ),
        })),
      reorderTab: (projectRef, tabId, toIndex) =>
        set((state) => ({
          byProjectKey: updateEnvironment(
            state.byProjectKey,
            scopedProjectKey(projectRef),
            (current) => {
              const fromIndex = current.tabIds.indexOf(tabId);
              if (fromIndex < 0) return current;
              const clampedToIndex = Math.max(0, Math.min(toIndex, current.tabIds.length - 1));
              if (fromIndex === clampedToIndex) return current;
              const tabIds = [...current.tabIds];
              tabIds.splice(fromIndex, 1);
              tabIds.splice(clampedToIndex, 0, tabId);
              return { ...current, tabIds };
            },
          ),
        })),
      reconcileThreadTabs: (projectRef, availableTarget) =>
        set((state) => ({
          byProjectKey: updateEnvironment(
            state.byProjectKey,
            scopedProjectKey(projectRef),
            (current) => {
              const isStaleThreadTab = (tab: CenterTab): boolean => {
                if (tab.kind !== "thread") return false;
                return tab.target.kind === "server"
                  ? !availableTarget.threadKeys.has(scopedThreadKey(tab.target.threadRef))
                  : !availableTarget.draftIds.has(tab.target.draftId);
              };
              const staleThreadIds = current.tabIds.filter((tabId) => {
                const tab = current.tabs[tabId];
                return tab !== undefined && isStaleThreadTab(tab);
              });
              if (staleThreadIds.length === 0) return current;
              // Also drop the file/diff/plan/preview tabs owned by each stale
              // thread — same orphan-avoidance decision as `closeTab`, since a
              // deleted/discarded thread can never become active again to
              // bring them back into scope.
              const staleThreadKeys = new Set(
                staleThreadIds.map((tabId) => {
                  const tab = current.tabs[tabId];
                  return tab && tab.kind === "thread" ? threadTargetKey(tab.target) : "";
                }),
              );
              const staleIdSet = new Set(staleThreadIds);
              for (const tabId of current.tabIds) {
                const tab = current.tabs[tabId];
                if (
                  tab &&
                  tab.kind !== "thread" &&
                  staleThreadKeys.has(threadTargetKey(tab.threadRef))
                ) {
                  staleIdSet.add(tabId);
                }
              }
              const tabIds = current.tabIds.filter((tabId) => !staleIdSet.has(tabId));
              const tabs = Object.fromEntries(
                Object.entries(current.tabs).filter(([id]) => !staleIdSet.has(id)),
              );
              const activeStillExists =
                current.activeTabId !== null && tabIds.includes(current.activeTabId);
              const activeThreadStillExists =
                current.activeThreadTabId !== null && tabIds.includes(current.activeThreadTabId);
              return {
                tabIds,
                tabs,
                activeTabId: activeStillExists ? current.activeTabId : (tabIds.at(-1) ?? null),
                activeThreadTabId: activeThreadStillExists
                  ? current.activeThreadTabId
                  : findFallbackThreadTabId(tabIds, tabs),
              };
            },
          ),
        })),
    }),
    {
      name: CENTER_TABS_STORAGE_KEY,
      version: CENTER_TABS_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byProjectKey: state.byProjectKey }),
    },
  ),
);

export function selectEnvironmentCenterTabsState(
  byProjectKey: Record<string, EnvironmentCenterTabsState>,
  projectRef: ScopedProjectRef | null | undefined,
): EnvironmentCenterTabsState {
  if (!projectRef) return EMPTY_ENVIRONMENT_STATE;
  return byProjectKey[scopedProjectKey(projectRef)] ?? EMPTY_ENVIRONMENT_STATE;
}

export function selectActiveCenterTab(
  byProjectKey: Record<string, EnvironmentCenterTabsState>,
  projectRef: ScopedProjectRef | null | undefined,
): CenterTab | null {
  const state = selectEnvironmentCenterTabsState(byProjectKey, projectRef);
  if (!state.activeTabId) return null;
  return state.tabs[state.activeTabId] ?? null;
}

/**
 * The tab ids that should actually render in the center tab strip: every
 * `thread`-kind tab (the one truly project-global flat list you switch
 * between), plus only the `file`/`diff`/`plan`/`preview` tabs owned by
 * whichever thread tab is currently (or was most recently) active —
 * `state.activeThreadTabId`. A thread's own file/diff/plan/preview tabs stay
 * out of view while a *different* thread tab is active, instead of bleeding
 * across every open thread (the bug this scoping fixes).
 *
 * Falls back to showing just the active tab by itself when there's no
 * resolvable active-thread context (e.g. immediately after closing every
 * thread but one non-thread tab remains selected) so the currently active
 * tab is never hidden by its own filter.
 */
export function selectVisibleCenterTabIds(state: EnvironmentCenterTabsState): string[] {
  const activeThreadTab = state.activeThreadTabId ? state.tabs[state.activeThreadTabId] : undefined;
  const activeThreadKey =
    activeThreadTab && activeThreadTab.kind === "thread"
      ? threadTargetKey(activeThreadTab.target)
      : null;
  return state.tabIds.filter((tabId) => {
    const tab = state.tabs[tabId];
    if (!tab) return false;
    if (tab.kind === "thread") return true;
    if (activeThreadKey === null) return tabId === state.activeTabId;
    return threadTargetKey(tab.threadRef) === activeThreadKey;
  });
}
