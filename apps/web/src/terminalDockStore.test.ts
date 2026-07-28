import { scopeThreadRef, scopedThreadKey } from "@eflob/client-runtime/environment";
import { ThreadId } from "@eflob/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  migratePersistedTerminalDockState,
  selectActiveTerminalDockGroup,
  selectThreadTerminalDockState,
  useTerminalDockStore,
} from "./terminalDockStore";

const THREAD_ID = ThreadId.make("thread-1");
const THREAD_REF = scopeThreadRef("environment-a" as never, THREAD_ID);
const OTHER_THREAD_REF = scopeThreadRef("environment-b" as never, THREAD_ID);

describe("terminalDockStore actions", () => {
  beforeEach(() => {
    useTerminalDockStore.persist.clearStorage();
    useTerminalDockStore.setState({ byThreadKey: {} });
  });

  it("returns an empty default dock state for unknown threads", () => {
    const dockState = selectThreadTerminalDockState(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    );
    expect(dockState).toEqual({ groupIds: [], activeGroupId: null, groups: {} });
  });

  it("creates a new group as a tab via the '+' action", () => {
    useTerminalDockStore.getState().createGroup(THREAD_REF, "term-1");

    const dockState = selectThreadTerminalDockState(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    );
    expect(dockState.groupIds).toHaveLength(1);
    const groupId = dockState.groupIds[0]!;
    expect(dockState.activeGroupId).toBe(groupId);
    expect(dockState.groups[groupId]).toEqual({
      id: groupId,
      terminalIds: ["term-1"],
      activeTerminalId: "term-1",
      splitDirection: null,
    });
  });

  it("creates a second group and activates it, leaving the first group intact", () => {
    const store = useTerminalDockStore.getState();
    store.createGroup(THREAD_REF, "term-1");
    const firstGroupId = selectThreadTerminalDockState(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    ).groupIds[0]!;

    store.createGroup(THREAD_REF, "term-2");
    const dockState = selectThreadTerminalDockState(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    );
    expect(dockState.groupIds).toHaveLength(2);
    const secondGroupId = dockState.groupIds[1]!;
    expect(dockState.activeGroupId).toBe(secondGroupId);
    expect(dockState.groups[firstGroupId]?.terminalIds).toEqual(["term-1"]);
  });

  it("splits a terminal into a pane within the active group's grid", () => {
    const store = useTerminalDockStore.getState();
    store.createGroup(THREAD_REF, "term-1");
    const groupId = selectThreadTerminalDockState(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    ).groupIds[0]!;

    store.splitTerminal(THREAD_REF, groupId, "term-2", "vertical");

    const group = selectActiveTerminalDockGroup(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    );
    expect(group).toEqual({
      id: groupId,
      terminalIds: ["term-1", "term-2"],
      activeTerminalId: "term-2",
      splitDirection: "vertical",
    });
  });

  it("caps splits at the max panes per group", () => {
    const store = useTerminalDockStore.getState();
    store.createGroup(THREAD_REF, "term-1");
    const groupId = selectThreadTerminalDockState(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    ).groupIds[0]!;

    store.splitTerminal(THREAD_REF, groupId, "term-2");
    store.splitTerminal(THREAD_REF, groupId, "term-3");
    store.splitTerminal(THREAD_REF, groupId, "term-4");
    store.splitTerminal(THREAD_REF, groupId, "term-5");

    const group = selectActiveTerminalDockGroup(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    );
    expect(group?.terminalIds).toEqual(["term-1", "term-2", "term-3", "term-4"]);
  });

  it("activates a terminal pane within a group", () => {
    const store = useTerminalDockStore.getState();
    store.createGroup(THREAD_REF, "term-1");
    const groupId = selectThreadTerminalDockState(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    ).groupIds[0]!;
    store.splitTerminal(THREAD_REF, groupId, "term-2");

    store.activateTerminalPane(THREAD_REF, groupId, "term-1");

    const group = selectActiveTerminalDockGroup(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    );
    expect(group?.activeTerminalId).toBe("term-1");
  });

  it("closing a pane falls back to a remaining pane and clears split direction when only one remains", () => {
    const store = useTerminalDockStore.getState();
    store.createGroup(THREAD_REF, "term-1");
    const groupId = selectThreadTerminalDockState(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    ).groupIds[0]!;
    store.splitTerminal(THREAD_REF, groupId, "term-2", "vertical");

    store.closeTerminalPane(THREAD_REF, groupId, "term-2");

    const group = selectActiveTerminalDockGroup(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    );
    expect(group).toEqual({
      id: groupId,
      terminalIds: ["term-1"],
      activeTerminalId: "term-1",
      splitDirection: null,
    });
  });

  it("closes the whole group when its last pane is closed, falling back to a sibling group", () => {
    const store = useTerminalDockStore.getState();
    store.createGroup(THREAD_REF, "term-1");
    const firstGroupId = selectThreadTerminalDockState(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    ).groupIds[0]!;
    store.createGroup(THREAD_REF, "term-2");

    store.closeTerminalPane(THREAD_REF, firstGroupId, "term-1");

    const dockState = selectThreadTerminalDockState(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    );
    expect(dockState.groupIds).toHaveLength(1);
    expect(dockState.groups[firstGroupId]).toBeUndefined();
  });

  it("clears thread state entirely once the last group is closed", () => {
    const store = useTerminalDockStore.getState();
    store.createGroup(THREAD_REF, "term-1");
    const groupId = selectThreadTerminalDockState(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    ).groupIds[0]!;

    store.closeGroup(THREAD_REF, groupId);

    expect(
      useTerminalDockStore.getState().byThreadKey[scopedThreadKey(THREAD_REF)],
    ).toBeUndefined();
  });

  it("activateGroup switches the active tab without touching panes", () => {
    const store = useTerminalDockStore.getState();
    store.createGroup(THREAD_REF, "term-1");
    const firstGroupId = selectThreadTerminalDockState(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    ).groupIds[0]!;
    store.createGroup(THREAD_REF, "term-2");

    store.activateGroup(THREAD_REF, firstGroupId);

    const dockState = selectThreadTerminalDockState(
      useTerminalDockStore.getState().byThreadKey,
      THREAD_REF,
    );
    expect(dockState.activeGroupId).toBe(firstGroupId);
    expect(dockState.groupIds).toHaveLength(2);
  });

  it("keeps state isolated per environment when raw thread ids collide", () => {
    const store = useTerminalDockStore.getState();
    store.createGroup(THREAD_REF, "term-1");
    store.createGroup(OTHER_THREAD_REF, "env-b-term");

    expect(
      selectThreadTerminalDockState(useTerminalDockStore.getState().byThreadKey, THREAD_REF)
        .groupIds,
    ).toHaveLength(1);
    const otherGroup = selectActiveTerminalDockGroup(
      useTerminalDockStore.getState().byThreadKey,
      OTHER_THREAD_REF,
    );
    expect(otherGroup?.terminalIds).toEqual(["env-b-term"]);
  });

  it("removeThread clears all dock state for a thread", () => {
    const store = useTerminalDockStore.getState();
    store.createGroup(THREAD_REF, "term-1");

    store.removeThread(THREAD_REF);

    expect(
      useTerminalDockStore.getState().byThreadKey[scopedThreadKey(THREAD_REF)],
    ).toBeUndefined();
  });

  it("migrates persisted state, dropping malformed groups and orphaned group ids", () => {
    const migrated = migratePersistedTerminalDockState({
      byThreadKey: {
        [scopedThreadKey(THREAD_REF)]: {
          groupIds: ["group-1", "group-missing"],
          activeGroupId: "group-1",
          groups: {
            "group-1": {
              id: "group-1",
              terminalIds: ["term-1", "term-1"],
              activeTerminalId: "term-1",
              splitDirection: "vertical",
            },
          },
        },
        "legacy-thread-id": {
          groupIds: [],
          activeGroupId: null,
          groups: {},
        },
      },
    });

    expect(migrated).toEqual({
      byThreadKey: {
        [scopedThreadKey(THREAD_REF)]: {
          groupIds: ["group-1"],
          activeGroupId: "group-1",
          groups: {
            "group-1": {
              id: "group-1",
              terminalIds: ["term-1"],
              activeTerminalId: "term-1",
              splitDirection: "vertical",
            },
          },
        },
      },
    });
  });

  it("returns an empty byThreadKey for malformed persisted state", () => {
    expect(migratePersistedTerminalDockState(null)).toEqual({ byThreadKey: {} });
    expect(migratePersistedTerminalDockState({})).toEqual({ byThreadKey: {} });
  });
});
