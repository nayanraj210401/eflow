import { scopeProjectRef } from "@eflob/client-runtime/environment";
import { ProjectId, type ScopedThreadRef } from "@eflob/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  computeCenterTabsMigrationActions,
  runCenterTabsMigrationBootstrapOnce,
  type CenterTabsMigrationTarget,
} from "./centerTabsMigrationBootstrap";
import type { ThreadRightPanelState } from "../rightPanelStore";

/** Every thread in these fixtures lives in "project-1" within its own environment. */
const resolveProjectRef = (threadRef: ScopedThreadRef) =>
  scopeProjectRef(threadRef.environmentId, ProjectId.make("project-1"));

describe("computeCenterTabsMigrationActions", () => {
  it("derives a file migration action from a persisted file surface", () => {
    const byThreadKey: Record<string, ThreadRightPanelState> = {
      "env-1:thread-1": {
        isOpen: true,
        maximized: false,
        activeSurfaceId: "file:src/index.ts",
        surfaces: [
          {
            id: "file:src/index.ts",
            kind: "file",
            relativePath: "src/index.ts",
            revealLine: 42,
            revealRequestId: 1,
          },
        ],
      },
    };

    const actions = computeCenterTabsMigrationActions(byThreadKey, resolveProjectRef);

    expect(actions).toEqual([
      {
        kind: "file",
        projectRef: { environmentId: "env-1", projectId: "project-1" },
        threadRef: { kind: "server", threadRef: { environmentId: "env-1", threadId: "thread-1" } },
        relativePath: "src/index.ts",
        revealLine: 42,
      },
    ]);
  });

  it("derives a plan migration action from a persisted plan surface", () => {
    const byThreadKey: Record<string, ThreadRightPanelState> = {
      "env-1:thread-1": {
        isOpen: true,
        maximized: false,
        activeSurfaceId: "plan",
        surfaces: [{ id: "plan", kind: "plan" }],
      },
    };

    const actions = computeCenterTabsMigrationActions(byThreadKey, resolveProjectRef);

    expect(actions).toEqual([
      {
        kind: "plan",
        projectRef: { environmentId: "env-1", projectId: "project-1" },
        threadRef: { kind: "server", threadRef: { environmentId: "env-1", threadId: "thread-1" } },
      },
    ]);
  });

  it("derives a preview migration action, carrying the browser tab id as previewTabId", () => {
    const byThreadKey: Record<string, ThreadRightPanelState> = {
      "env-1:thread-1": {
        isOpen: true,
        maximized: false,
        activeSurfaceId: "browser:tab-9",
        surfaces: [{ id: "browser:tab-9", kind: "preview", resourceId: "tab-9" }],
      },
    };

    const actions = computeCenterTabsMigrationActions(byThreadKey, resolveProjectRef);

    expect(actions).toEqual([
      {
        kind: "preview",
        projectRef: { environmentId: "env-1", projectId: "project-1" },
        threadRef: { kind: "server", threadRef: { environmentId: "env-1", threadId: "thread-1" } },
        previewTabId: "tab-9",
      },
    ]);
  });

  it("maps a new-placeholder preview surface (resourceId null) to previewTabId null", () => {
    const byThreadKey: Record<string, ThreadRightPanelState> = {
      "env-1:thread-1": {
        isOpen: true,
        maximized: false,
        activeSurfaceId: "browser:new",
        surfaces: [{ id: "browser:new", kind: "preview", resourceId: null }],
      },
    };

    const actions = computeCenterTabsMigrationActions(byThreadKey, resolveProjectRef);

    expect(actions).toEqual([
      {
        kind: "preview",
        projectRef: { environmentId: "env-1", projectId: "project-1" },
        threadRef: { kind: "server", threadRef: { environmentId: "env-1", threadId: "thread-1" } },
        previewTabId: null,
      },
    ]);
  });

  it("ignores diff and files singleton surfaces (no central-tab equivalent to migrate)", () => {
    const byThreadKey: Record<string, ThreadRightPanelState> = {
      "env-1:thread-1": {
        isOpen: true,
        maximized: false,
        activeSurfaceId: "diff",
        surfaces: [
          { id: "diff", kind: "diff" },
          { id: "files", kind: "files" },
        ],
      },
    };

    expect(computeCenterTabsMigrationActions(byThreadKey, resolveProjectRef)).toEqual([]);
  });

  it("skips a thread key that doesn't parse as environmentId:threadId", () => {
    const byThreadKey: Record<string, ThreadRightPanelState> = {
      "malformed-key-no-colon": {
        isOpen: true,
        maximized: false,
        activeSurfaceId: "plan",
        surfaces: [{ id: "plan", kind: "plan" }],
      },
    };

    expect(computeCenterTabsMigrationActions(byThreadKey, resolveProjectRef)).toEqual([]);
  });

  it("skips malformed surfaces without throwing (defensive against corrupted storage)", () => {
    const byThreadKey = {
      "env-1:thread-1": {
        isOpen: true,
        activeSurfaceId: null,
        surfaces: [{ id: "file:", kind: "file", relativePath: "" }],
      },
    } as unknown as Record<string, ThreadRightPanelState>;

    expect(() => computeCenterTabsMigrationActions(byThreadKey, resolveProjectRef)).not.toThrow();
    expect(computeCenterTabsMigrationActions(byThreadKey, resolveProjectRef)).toEqual([]);
  });

  it("skips a thread whose project can't be resolved (e.g. entity sync hasn't caught up yet)", () => {
    const byThreadKey: Record<string, ThreadRightPanelState> = {
      "env-1:thread-1": {
        isOpen: true,
        maximized: false,
        activeSurfaceId: "plan",
        surfaces: [{ id: "plan", kind: "plan" }],
      },
    };

    expect(computeCenterTabsMigrationActions(byThreadKey, () => null)).toEqual([]);
  });

  it("produces multiple ordered actions across threads and surfaces", () => {
    const byThreadKey: Record<string, ThreadRightPanelState> = {
      "env-1:thread-1": {
        isOpen: true,
        maximized: false,
        activeSurfaceId: "plan",
        surfaces: [
          { id: "plan", kind: "plan" },
          {
            id: "file:a.ts",
            kind: "file",
            relativePath: "a.ts",
            revealLine: null,
            revealRequestId: 1,
          },
        ],
      },
      "env-2:thread-2": {
        isOpen: true,
        maximized: false,
        activeSurfaceId: "browser:tab-1",
        surfaces: [{ id: "browser:tab-1", kind: "preview", resourceId: "tab-1" }],
      },
    };

    const actions = computeCenterTabsMigrationActions(byThreadKey, resolveProjectRef);

    expect(actions.map((action) => action.kind)).toEqual(["plan", "file", "preview"]);
  });
});

describe("runCenterTabsMigrationBootstrapOnce", () => {
  function makeTarget() {
    const openFileTab = vi.fn<CenterTabsMigrationTarget["openFileTab"]>();
    const openPlanTab = vi.fn<CenterTabsMigrationTarget["openPlanTab"]>();
    const openPreviewTab = vi.fn<CenterTabsMigrationTarget["openPreviewTab"]>();
    return {
      target: { openFileTab, openPlanTab, openPreviewTab } satisfies CenterTabsMigrationTarget,
      openFileTab,
      openPlanTab,
      openPreviewTab,
    };
  }

  it("migrates surfaces and sets the flag when the flag is unset", () => {
    const target = makeTarget();
    const setFlag = vi.fn();

    runCenterTabsMigrationBootstrapOnce({
      getFlag: () => null,
      setFlag,
      getByThreadKey: () => ({
        "env-1:thread-1": {
          isOpen: true,
          maximized: false,
          activeSurfaceId: "plan",
          surfaces: [{ id: "plan", kind: "plan" }],
        },
      }),
      resolveProjectRef,
      target: target.target,
    });

    expect(target.openPlanTab).toHaveBeenCalledTimes(1);
    expect(target.openPlanTab).toHaveBeenCalledWith(
      { environmentId: "env-1", projectId: "project-1" },
      {
        kind: "server",
        threadRef: { environmentId: "env-1", threadId: "thread-1" },
      },
    );
    expect(setFlag).toHaveBeenCalledTimes(1);
  });

  it("no-ops without touching the target when the flag is already set", () => {
    const target = makeTarget();
    const getByThreadKey = vi.fn(() => ({}));
    const setFlag = vi.fn();

    runCenterTabsMigrationBootstrapOnce({
      getFlag: () => "1",
      setFlag,
      getByThreadKey,
      resolveProjectRef,
      target: target.target,
    });

    expect(getByThreadKey).not.toHaveBeenCalled();
    expect(target.openFileTab).not.toHaveBeenCalled();
    expect(target.openPlanTab).not.toHaveBeenCalled();
    expect(target.openPreviewTab).not.toHaveBeenCalled();
    expect(setFlag).not.toHaveBeenCalled();
  });

  it("never throws even if getByThreadKey throws, and still sets the flag", () => {
    const target = makeTarget();
    const setFlag = vi.fn();

    expect(() =>
      runCenterTabsMigrationBootstrapOnce({
        getFlag: () => null,
        setFlag,
        getByThreadKey: () => {
          throw new Error("corrupted storage");
        },
        resolveProjectRef,
        target: target.target,
      }),
    ).not.toThrow();

    expect(setFlag).toHaveBeenCalledTimes(1);
  });

  it("never throws even if setFlag throws", () => {
    const target = makeTarget();

    expect(() =>
      runCenterTabsMigrationBootstrapOnce({
        getFlag: () => null,
        setFlag: () => {
          throw new Error("storage full");
        },
        getByThreadKey: () => ({}),
        resolveProjectRef,
        target: target.target,
      }),
    ).not.toThrow();
  });

  it("calls openFileTab with the reveal line forwarded as `line`", () => {
    const target = makeTarget();

    runCenterTabsMigrationBootstrapOnce({
      getFlag: () => null,
      setFlag: () => {},
      getByThreadKey: () => ({
        "env-1:thread-1": {
          isOpen: true,
          maximized: false,
          activeSurfaceId: "file:a.ts",
          surfaces: [
            {
              id: "file:a.ts",
              kind: "file",
              relativePath: "a.ts",
              revealLine: 7,
              revealRequestId: 1,
            },
          ],
        },
      }),
      resolveProjectRef,
      target: target.target,
    });

    expect(target.openFileTab).toHaveBeenCalledWith(
      { environmentId: "env-1", projectId: "project-1" },
      { kind: "server", threadRef: { environmentId: "env-1", threadId: "thread-1" } },
      "a.ts",
      7,
    );
  });
});
