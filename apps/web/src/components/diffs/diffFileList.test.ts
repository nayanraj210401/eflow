import type { FileDiffMetadata, Hunk } from "@pierre/diffs/types";
import { describe, expect, it } from "vite-plus/test";

import {
  buildDiffFileList,
  buildDiffFileListEntry,
  computeFileDiffLineStats,
  sortFileDiffsByPath,
} from "./diffFileList";

function makeHunk(additionLines: number, deletionLines: number): Hunk {
  return {
    collapsedBefore: 0,
    additionStart: 1,
    additionCount: additionLines,
    additionLines,
    additionLineIndex: 0,
    deletionStart: 1,
    deletionCount: deletionLines,
    deletionLines,
    deletionLineIndex: 0,
    hunkContent: [],
  } as unknown as Hunk;
}

function makeFileDiff(overrides: Partial<FileDiffMetadata> & Pick<FileDiffMetadata, "type">) {
  return {
    name: "file.ts",
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: true,
    deletionLines: [],
    additionLines: [],
    ...overrides,
  } as unknown as FileDiffMetadata;
}

describe("computeFileDiffLineStats", () => {
  it("sums additions/deletions across all hunks", () => {
    const fileDiff = makeFileDiff({
      type: "change",
      name: "src/app.ts",
      hunks: [makeHunk(3, 1), makeHunk(2, 0)],
    });

    expect(computeFileDiffLineStats(fileDiff)).toEqual({ additions: 5, deletions: 1 });
  });

  it("returns zero stats for a file with no hunks", () => {
    const fileDiff = makeFileDiff({ type: "rename-pure", name: "src/renamed.ts", hunks: [] });

    expect(computeFileDiffLineStats(fileDiff)).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("buildDiffFileListEntry", () => {
  it("describes an added file", () => {
    const fileDiff = makeFileDiff({
      type: "new",
      name: "b/src/new-file.ts",
      hunks: [makeHunk(10, 0)],
    });

    expect(buildDiffFileListEntry(fileDiff)).toMatchObject({
      filePath: "src/new-file.ts",
      status: "new",
      additions: 10,
      deletions: 0,
    });
  });

  it("describes a deleted file", () => {
    const fileDiff = makeFileDiff({
      type: "deleted",
      name: "b/src/old-file.ts",
      hunks: [makeHunk(0, 8)],
    });

    expect(buildDiffFileListEntry(fileDiff)).toMatchObject({
      filePath: "src/old-file.ts",
      status: "deleted",
      additions: 0,
      deletions: 8,
    });
  });

  it("describes a modified file with both added and removed lines", () => {
    const fileDiff = makeFileDiff({
      type: "change",
      name: "b/src/mixed.ts",
      hunks: [makeHunk(4, 2)],
    });

    expect(buildDiffFileListEntry(fileDiff)).toMatchObject({
      filePath: "src/mixed.ts",
      status: "change",
      additions: 4,
      deletions: 2,
    });
  });
});

describe("sortFileDiffsByPath / buildDiffFileList", () => {
  it("sorts files by display path, numeric-aware", () => {
    const files = [
      makeFileDiff({ type: "change", name: "b/src/file10.ts" }),
      makeFileDiff({ type: "change", name: "b/src/file2.ts" }),
    ];

    expect(sortFileDiffsByPath(files).map((file) => file.name)).toEqual([
      "b/src/file2.ts",
      "b/src/file10.ts",
    ]);
  });

  it("returns an empty list for an empty diff", () => {
    expect(buildDiffFileList([])).toEqual([]);
  });

  it("builds a sorted list of entries with stats for a multi-file diff", () => {
    const files = [
      makeFileDiff({ type: "new", name: "b/src/z.ts", hunks: [makeHunk(1, 0)] }),
      makeFileDiff({ type: "deleted", name: "b/src/a.ts", hunks: [makeHunk(0, 3)] }),
    ];

    const entries = buildDiffFileList(files);

    expect(entries.map((entry) => entry.filePath)).toEqual(["src/a.ts", "src/z.ts"]);
    expect(entries[0]).toMatchObject({ status: "deleted", additions: 0, deletions: 3 });
    expect(entries[1]).toMatchObject({ status: "new", additions: 1, deletions: 0 });
  });
});
