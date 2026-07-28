import { scopeThreadRef } from "@eflob/client-runtime/environment";
import { EnvironmentId, ThreadId, TurnId } from "@eflob/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectThreadDiffPanelSelection, useDiffPanelStore } from "./diffPanelStore";

const THREAD_REF = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));

describe("diffPanelStore", () => {
  beforeEach(() => useDiffPanelStore.setState({ byThreadKey: {}, branchBaseRefByThreadKey: {} }));

  it("defaults each thread to branch changes when the working tree is clean", () => {
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: null, filePath: null, revealRequestId: 0 });
  });

  it("defaults each thread to working changes when the working tree is dirty", () => {
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF, true),
    ).toEqual({ kind: "unstaged", filePath: null, revealRequestId: 0 });
  });

  it("preserves an explicit scope selection when the working tree state changes", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF, true),
    ).toEqual({ kind: "branch", baseRef: null, filePath: null, revealRequestId: 0 });
  });

  it("clears incompatible selection fields when changing scopes", () => {
    const store = useDiffPanelStore.getState();
    store.selectTurn(THREAD_REF, TurnId.make("turn-1"), "src/app.ts");
    store.selectGitScope(THREAD_REF, "unstaged");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "unstaged", filePath: null, revealRequestId: 0 });

    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, " origin/main ");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main", filePath: null, revealRequestId: 0 });
  });

  it("increments the reveal request when opening the same turn file again", () => {
    const turnId = TurnId.make("turn-1");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "src/app.ts");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "src/app.ts");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "turn", turnId, filePath: "src/app.ts", revealRequestId: 2 });
  });

  it("restores the selected branch base after visiting another scope", () => {
    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, "origin/main");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "unstaged");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main", filePath: null, revealRequestId: 0 });
  });

  it("reveals a file within whichever scope is currently selected, bumping revealRequestId", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");
    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, "origin/main");
    useDiffPanelStore.getState().revealFile(THREAD_REF, "src/app.ts");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "branch",
      baseRef: "origin/main",
      filePath: "src/app.ts",
      revealRequestId: 1,
    });

    useDiffPanelStore.getState().revealFile(THREAD_REF, "src/app.ts");
    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF)
        .revealRequestId,
    ).toBe(2);
  });

  it("reveals a file for the unstaged scope too", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "unstaged");
    useDiffPanelStore.getState().revealFile(THREAD_REF, "src/other.ts");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "unstaged", filePath: "src/other.ts", revealRequestId: 1 });
  });

  it("reconciles a missing turn selection to the latest available turn", () => {
    const missingTurnId = TurnId.make("turn-missing");
    const latestTurnId = TurnId.make("turn-latest");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, missingTurnId, "src/app.ts");
    useDiffPanelStore.getState().reconcileTurnSelection(THREAD_REF, [latestTurnId]);

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({
      kind: "turn",
      turnId: latestTurnId,
      filePath: "src/app.ts",
      revealRequestId: 1,
    });
  });
});
