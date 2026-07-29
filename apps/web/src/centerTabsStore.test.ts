import {
  scopeProjectRef,
  scopeThreadRef,
  scopedProjectKey,
} from "@eflob/client-runtime/environment";
import { type EnvironmentId, ProjectId, ThreadId } from "@eflob/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@eflob/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  selectActiveCenterTab,
  selectEnvironmentCenterTabsState,
  selectVisibleCenterTabIds,
  useCenterTabsStore,
} from "./centerTabsStore";
import type { DraftId } from "./composerDraftStore";
import * as useSettingsModule from "./hooks/useSettings";
import type { ThreadRouteTarget } from "./threadRoutes";

const envId = "env-1" as EnvironmentId;
const projectRef = scopeProjectRef(envId, ProjectId.make("project-1"));

const threadA: ThreadRouteTarget = {
  kind: "server",
  threadRef: scopeThreadRef(envId, ThreadId.make("thread-A")),
};
const threadB: ThreadRouteTarget = {
  kind: "server",
  threadRef: scopeThreadRef(envId, ThreadId.make("thread-B")),
};
const draftA: ThreadRouteTarget = { kind: "draft", draftId: "draft-1" as DraftId };

/** Overrides the "max tabs per thread" setting `centerTabsStore` reads on every tab open. */
function stubMaxTabsPerThread(maxTabsPerThread: number) {
  vi.spyOn(useSettingsModule, "readClientSettings").mockReturnValue({
    ...DEFAULT_CLIENT_SETTINGS,
    maxTabsPerThread,
  });
}

beforeEach(() => {
  useCenterTabsStore.setState({ byProjectKey: {} });
  stubMaxTabsPerThread(DEFAULT_CLIENT_SETTINGS.maxTabsPerThread);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("centerTabsStore", () => {
  it("openThreadTab opens and activates a thread tab, allowing multiple threads", () => {
    useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
    useCenterTabsStore.getState().openThreadTab(projectRef, threadB);

    const state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    expect(state.tabIds).toHaveLength(2);
    expect(state.activeTabId).toBe(state.tabIds[1]);
    expect(selectActiveCenterTab(useCenterTabsStore.getState().byProjectKey, projectRef)).toEqual({
      id: state.tabIds[1],
      kind: "thread",
      target: threadB,
    });
  });

  it("openThreadTab supports draft targets and does not duplicate on reopen", () => {
    useCenterTabsStore.getState().openThreadTab(projectRef, draftA);
    useCenterTabsStore.getState().openThreadTab(projectRef, draftA);

    const state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    expect(state.tabIds).toHaveLength(1);
    expect(state.tabs[state.tabIds[0]!]).toEqual({
      id: "thread:draft:draft-1",
      kind: "thread",
      target: draftA,
    });
  });

  it("openFileTab allows multiple distinct files and bumps revealRequestId on reopen", () => {
    useCenterTabsStore.getState().openFileTab(projectRef, threadA, "src/index.ts");
    useCenterTabsStore.getState().openFileTab(projectRef, threadA, "README.md");
    useCenterTabsStore.getState().openFileTab(projectRef, threadA, "src/index.ts", 42);

    const state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    expect(state.tabIds).toHaveLength(2);
    expect(
      state.tabs[
        `file:${threadA.threadRef.environmentId}:${threadA.threadRef.threadId}:src/index.ts`
      ],
    ).toEqual({
      id: `file:${threadA.threadRef.environmentId}:${threadA.threadRef.threadId}:src/index.ts`,
      kind: "file",
      threadRef: threadA,
      relativePath: "src/index.ts",
      revealLine: 42,
      revealRequestId: 2,
    });
    expect(state.activeTabId).toBe(
      `file:${threadA.threadRef.environmentId}:${threadA.threadRef.threadId}:src/index.ts`,
    );
  });

  it("openDiffTab is a singleton per thread and refocuses instead of duplicating", () => {
    useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
    useCenterTabsStore.getState().openDiffTab(projectRef, threadA);
    useCenterTabsStore.getState().openThreadTab(projectRef, threadB);
    useCenterTabsStore.getState().openDiffTab(projectRef, threadA);

    const state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    const diffTabs = state.tabIds.filter((id) => state.tabs[id]?.kind === "diff");
    expect(diffTabs).toHaveLength(1);
    expect(state.activeTabId).toBe(diffTabs[0]);
  });

  it("openDiffTab with revealPath bumps revealRequestId on an existing tab rather than forking", () => {
    useCenterTabsStore.getState().openDiffTab(projectRef, threadA);
    useCenterTabsStore.getState().openDiffTab(projectRef, threadA, { revealPath: true });
    useCenterTabsStore.getState().openDiffTab(projectRef, threadA, { revealPath: true });

    const state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    expect(state.tabIds).toHaveLength(1);
    const tab = state.tabs[state.tabIds[0]!];
    expect(tab?.kind).toBe("diff");
    expect(tab && tab.kind === "diff" ? tab.revealRequestId : null).toBe(2);
  });

  it("openPlanTab is a singleton per thread", () => {
    useCenterTabsStore.getState().openPlanTab(projectRef, threadA);
    useCenterTabsStore.getState().openPlanTab(projectRef, threadA);
    useCenterTabsStore.getState().openPlanTab(projectRef, threadB);

    const state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    const planTabs = state.tabIds.filter((id) => state.tabs[id]?.kind === "plan");
    expect(planTabs).toHaveLength(2);
  });

  it("openPreviewTab is a singleton per thread and updates previewTabId on the existing tab", () => {
    useCenterTabsStore.getState().openPreviewTab(projectRef, threadA, "tab-1");
    useCenterTabsStore.getState().openPreviewTab(projectRef, threadA, "tab-2");

    const state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    const previewTabs = state.tabIds.filter((id) => state.tabs[id]?.kind === "preview");
    expect(previewTabs).toHaveLength(1);
    const tab = state.tabs[previewTabs[0]!];
    expect(tab && tab.kind === "preview" ? tab.previewTabId : null).toBe("tab-2");
  });

  it("activateTab switches the active tab without changing tabIds", () => {
    useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
    useCenterTabsStore.getState().openThreadTab(projectRef, threadB);
    const state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    const firstTabId = state.tabIds[0]!;

    useCenterTabsStore.getState().activateTab(projectRef, firstTabId);

    const next = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    expect(next.activeTabId).toBe(firstTabId);
    expect(next.tabIds).toEqual(state.tabIds);
  });

  it("closeTab removes the tab and falls back to a neighbor when it was active", () => {
    useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
    useCenterTabsStore.getState().openThreadTab(projectRef, threadB);
    const state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    const [firstTabId, secondTabId] = state.tabIds;

    useCenterTabsStore.getState().closeTab(projectRef, secondTabId!);

    const next = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    expect(next.tabIds).toEqual([firstTabId]);
    expect(next.activeTabId).toBe(firstTabId);
  });

  it("closeOtherTabs keeps only the given tab", () => {
    useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
    useCenterTabsStore.getState().openThreadTab(projectRef, threadB);
    const state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    const [firstTabId] = state.tabIds;

    useCenterTabsStore.getState().closeOtherTabs(projectRef, firstTabId!);

    const next = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    expect(next.tabIds).toEqual([firstTabId]);
    expect(next.activeTabId).toBe(firstTabId);
  });

  it("closeTabsToRight removes tabs after the given tab", () => {
    useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
    useCenterTabsStore.getState().openThreadTab(projectRef, threadB);
    useCenterTabsStore.getState().openPlanTab(projectRef, threadA);
    const state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    const [firstTabId] = state.tabIds;

    useCenterTabsStore.getState().closeTabsToRight(projectRef, firstTabId!);

    const next = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    expect(next.tabIds).toEqual([firstTabId]);
    expect(next.activeTabId).toBe(firstTabId);
  });

  it("closeAllTabs clears the environment entirely", () => {
    useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
    useCenterTabsStore.getState().openPlanTab(projectRef, threadA);

    useCenterTabsStore.getState().closeAllTabs(projectRef);

    expect(
      selectEnvironmentCenterTabsState(useCenterTabsStore.getState().byProjectKey, projectRef),
    ).toEqual({
      tabIds: [],
      activeTabId: null,
      tabs: {},
      activeThreadTabId: null,
    });
    expect(
      useCenterTabsStore.getState().byProjectKey[scopedProjectKey(projectRef)],
    ).toBeUndefined();
  });

  it("reorderTab moves a tab to the requested index", () => {
    useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
    useCenterTabsStore.getState().openThreadTab(projectRef, threadB);
    useCenterTabsStore.getState().openPlanTab(projectRef, threadA);
    const state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    const [firstTabId, , thirdTabId] = state.tabIds;

    useCenterTabsStore.getState().reorderTab(projectRef, thirdTabId!, 0);

    const next = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    expect(next.tabIds[0]).toBe(thirdTabId);
    expect(next.tabIds).toContain(firstTabId);
  });

  it("reconcileThreadTabs drops thread tabs whose target no longer exists", () => {
    useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
    useCenterTabsStore.getState().openThreadTab(projectRef, threadB);
    useCenterTabsStore.getState().openThreadTab(projectRef, draftA);

    useCenterTabsStore.getState().reconcileThreadTabs(projectRef, {
      threadKeys: new Set([`${threadA.threadRef.environmentId}:${threadA.threadRef.threadId}`]),
      draftIds: new Set<string>(),
    });

    const next = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    expect(next.tabIds).toEqual([
      "thread:" + `${threadA.threadRef.environmentId}:${threadA.threadRef.threadId}`,
    ]);
  });

  it("leaves a thread's non-thread tabs untouched by reconcileThreadTabs when the thread is still available", () => {
    useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
    useCenterTabsStore.getState().openPlanTab(projectRef, threadA);

    useCenterTabsStore.getState().reconcileThreadTabs(projectRef, {
      threadKeys: new Set([`${threadA.threadRef.environmentId}:${threadA.threadRef.threadId}`]),
      draftIds: new Set<string>(),
    });

    const next = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    expect(next.tabIds.some((id) => next.tabs[id]?.kind === "plan")).toBe(true);
  });

  it("reconcileThreadTabs also drops a stale thread's owned file/diff/plan/preview tabs (avoids orphaning them)", () => {
    useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
    useCenterTabsStore.getState().openPlanTab(projectRef, threadA);
    useCenterTabsStore.getState().openFileTab(projectRef, threadA, "src/index.ts");
    useCenterTabsStore.getState().openThreadTab(projectRef, threadB);
    useCenterTabsStore.getState().openPlanTab(projectRef, threadB);

    useCenterTabsStore.getState().reconcileThreadTabs(projectRef, {
      threadKeys: new Set([`${threadB.threadRef.environmentId}:${threadB.threadRef.threadId}`]),
      draftIds: new Set<string>(),
    });

    const next = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    expect(
      next.tabIds.some(
        (id) => next.tabs[id]?.kind === "plan" && next.tabs[id]?.threadRef === threadA,
      ),
    ).toBe(false);
    expect(next.tabIds.some((id) => next.tabs[id]?.kind === "file")).toBe(false);
    expect(
      next.tabIds.some(
        (id) => next.tabs[id]?.kind === "plan" && next.tabs[id]?.threadRef === threadB,
      ),
    ).toBe(true);
  });

  it("closeTab on a thread tab also closes the file/diff/plan/preview tabs it owns", () => {
    useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
    useCenterTabsStore.getState().openPlanTab(projectRef, threadA);
    useCenterTabsStore.getState().openFileTab(projectRef, threadA, "src/index.ts");
    useCenterTabsStore.getState().openThreadTab(projectRef, threadB);
    useCenterTabsStore.getState().openDiffTab(projectRef, threadB);

    const threadATabId = `thread:${threadA.threadRef.environmentId}:${threadA.threadRef.threadId}`;
    useCenterTabsStore.getState().closeTab(projectRef, threadATabId);

    const next = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    expect(next.tabIds.some((id) => next.tabs[id]?.kind === "plan")).toBe(false);
    expect(next.tabIds.some((id) => next.tabs[id]?.kind === "file")).toBe(false);
    // threadB's own diff tab is untouched.
    expect(next.tabIds.some((id) => next.tabs[id]?.kind === "diff")).toBe(true);
    expect(
      next.tabIds.some(
        (id) => next.tabs[id]?.kind === "thread" && next.tabs[id]?.target === threadB,
      ),
    ).toBe(true);
  });

  it("tracks activeThreadTabId across thread activation and falls back when the active thread closes", () => {
    useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
    useCenterTabsStore.getState().openThreadTab(projectRef, threadB);
    let state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    const threadBTabId = state.tabIds[1]!;
    expect(state.activeThreadTabId).toBe(threadBTabId);

    // Opening a file tab activates it, but the "owning thread" context stays threadB.
    useCenterTabsStore.getState().openFileTab(projectRef, threadB, "README.md");
    state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    expect(state.activeTabId).not.toBe(threadBTabId);
    expect(state.activeThreadTabId).toBe(threadBTabId);

    useCenterTabsStore.getState().closeTab(projectRef, threadBTabId);
    state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    const threadATabId = state.tabIds.find((id) => state.tabs[id]?.kind === "thread")!;
    expect(state.activeThreadTabId).toBe(threadATabId);
  });

  it("selectVisibleCenterTabIds scopes file/diff/plan/preview tabs to the active thread tab", () => {
    useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
    useCenterTabsStore.getState().openFileTab(projectRef, threadA, "src/index.ts");
    useCenterTabsStore.getState().openPlanTab(projectRef, threadA);
    useCenterTabsStore.getState().openThreadTab(projectRef, threadB);
    useCenterTabsStore.getState().openDiffTab(projectRef, threadB);

    // threadB is active: only threadB's diff tab (plus both thread tabs) should be visible.
    let state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    let visibleKinds = selectVisibleCenterTabIds(state).map((id) => state.tabs[id]?.kind);
    expect(visibleKinds.sort()).toEqual(["diff", "thread", "thread"].sort());

    // Switching the active thread tab back to threadA reveals threadA's file/plan
    // tabs and hides threadB's diff tab.
    const threadATabId = state.tabIds.find(
      (id) => state.tabs[id]?.kind === "thread" && state.tabs[id]?.target === threadA,
    )!;
    useCenterTabsStore.getState().activateTab(projectRef, threadATabId);
    state = selectEnvironmentCenterTabsState(
      useCenterTabsStore.getState().byProjectKey,
      projectRef,
    );
    visibleKinds = selectVisibleCenterTabIds(state).map((id) => state.tabs[id]?.kind);
    expect(visibleKinds.sort()).toEqual(["file", "plan", "thread", "thread"].sort());
  });

  it("persist partialize keeps only byProjectKey", () => {
    useCenterTabsStore.getState().openThreadTab(projectRef, threadA);

    const persistOptions = (
      useCenterTabsStore as unknown as {
        persist: { getOptions: () => { partialize: (state: unknown) => unknown } };
      }
    ).persist.getOptions();
    const persisted = persistOptions.partialize(useCenterTabsStore.getState());

    expect(Object.keys(persisted as Record<string, unknown>)).toEqual(["byProjectKey"]);
  });

  describe("maxTabsPerThread cap", () => {
    it("evicts the oldest file tab for a thread once the cap is reached", () => {
      stubMaxTabsPerThread(2);
      useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
      useCenterTabsStore.getState().openFileTab(projectRef, threadA, "a.ts");
      useCenterTabsStore.getState().openFileTab(projectRef, threadA, "b.ts");
      useCenterTabsStore.getState().openFileTab(projectRef, threadA, "c.ts");

      const state = selectEnvironmentCenterTabsState(
        useCenterTabsStore.getState().byProjectKey,
        projectRef,
      );
      const fileLabels = state.tabIds
        .map((id) => state.tabs[id])
        .filter((tab) => tab?.kind === "file")
        .map((tab) => tab.relativePath);
      expect(fileLabels).toEqual(["b.ts", "c.ts"]);
    });

    it("does not evict tabs belonging to a different thread", () => {
      stubMaxTabsPerThread(1);
      useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
      useCenterTabsStore.getState().openFileTab(projectRef, threadA, "a.ts");
      useCenterTabsStore.getState().openThreadTab(projectRef, threadB);
      useCenterTabsStore.getState().openFileTab(projectRef, threadB, "b.ts");

      const state = selectEnvironmentCenterTabsState(
        useCenterTabsStore.getState().byProjectKey,
        projectRef,
      );
      const fileLabels = state.tabIds
        .map((id) => state.tabs[id])
        .filter((tab) => tab?.kind === "file")
        .map((tab) => tab.relativePath);
      expect(fileLabels).toEqual(["a.ts", "b.ts"]);
    });

    it("does not evict when reopening an already-open tab (no new tab being inserted)", () => {
      stubMaxTabsPerThread(1);
      useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
      useCenterTabsStore.getState().openFileTab(projectRef, threadA, "a.ts");
      useCenterTabsStore.getState().openFileTab(projectRef, threadA, "a.ts", 10);

      const state = selectEnvironmentCenterTabsState(
        useCenterTabsStore.getState().byProjectKey,
        projectRef,
      );
      const fileTabs = state.tabIds
        .map((id) => state.tabs[id])
        .filter((tab) => tab?.kind === "file");
      expect(fileTabs).toHaveLength(1);
    });

    it("counts diff/plan/preview tabs toward the same per-thread cap as file tabs", () => {
      stubMaxTabsPerThread(2);
      useCenterTabsStore.getState().openThreadTab(projectRef, threadA);
      useCenterTabsStore.getState().openFileTab(projectRef, threadA, "a.ts");
      useCenterTabsStore.getState().openDiffTab(projectRef, threadA);
      useCenterTabsStore.getState().openPlanTab(projectRef, threadA);

      const state = selectEnvironmentCenterTabsState(
        useCenterTabsStore.getState().byProjectKey,
        projectRef,
      );
      const ownedNonThreadKinds = state.tabIds
        .map((id) => state.tabs[id])
        .filter((tab) => tab !== undefined && tab.kind !== "thread")
        .map((tab) => tab!.kind);
      expect(ownedNonThreadKinds).toEqual(["diff", "plan"]);
    });
  });
});
