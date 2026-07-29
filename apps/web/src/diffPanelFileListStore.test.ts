import { scopeThreadRef } from "@eflob/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@eflob/contracts";
import type { FileDiffMetadata } from "@pierre/diffs/types";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectDiffPanelFileList, useDiffPanelFileListStore } from "./diffPanelFileListStore";

const THREAD_REF = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));
const OTHER_THREAD_REF = scopeThreadRef(
  EnvironmentId.make("environment-1"),
  ThreadId.make("thread-2"),
);

const FILES = [{ path: "src/app.ts" }] as unknown as ReadonlyArray<FileDiffMetadata>;

describe("diffPanelFileListStore", () => {
  beforeEach(() => useDiffPanelFileListStore.setState({ byThreadKey: {} }));

  it("returns an empty list for a thread with no published files", () => {
    expect(
      selectDiffPanelFileList(useDiffPanelFileListStore.getState().byThreadKey, THREAD_REF),
    ).toEqual([]);
  });

  it("returns an empty list for a null/undefined ref", () => {
    useDiffPanelFileListStore.getState().setFileList(THREAD_REF, FILES);
    expect(selectDiffPanelFileList(useDiffPanelFileListStore.getState().byThreadKey, null)).toEqual(
      [],
    );
  });

  it("publishes and reads back the files for a specific thread", () => {
    useDiffPanelFileListStore.getState().setFileList(THREAD_REF, FILES);

    expect(
      selectDiffPanelFileList(useDiffPanelFileListStore.getState().byThreadKey, THREAD_REF),
    ).toBe(FILES);
    expect(
      selectDiffPanelFileList(useDiffPanelFileListStore.getState().byThreadKey, OTHER_THREAD_REF),
    ).toEqual([]);
  });

  it("does not trigger a state change when setting the same array reference again", () => {
    useDiffPanelFileListStore.getState().setFileList(THREAD_REF, FILES);
    const stateAfterFirstSet = useDiffPanelFileListStore.getState().byThreadKey;
    useDiffPanelFileListStore.getState().setFileList(THREAD_REF, FILES);
    expect(useDiffPanelFileListStore.getState().byThreadKey).toBe(stateAfterFirstSet);
  });
});
