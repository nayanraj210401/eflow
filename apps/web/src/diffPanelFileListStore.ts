import { scopedThreadKey } from "@eflob/client-runtime/environment";
import type { ScopedThreadRef } from "@eflob/contracts";
import type { FileDiffMetadata } from "@pierre/diffs/types";
import { create } from "zustand";

/**
 * Ephemeral (non-persisted), per-thread cache of the parsed file diffs
 * currently rendered by `DiffPanel.tsx` for whatever diff scope is selected.
 *
 * `DiffPanel.tsx` already parses/derives this via `diffFileList.ts`'s
 * `sortFileDiffsByPath` (see `renderableFiles`) as part of rendering its own
 * full virtualized diff view; re-deriving it a second time elsewhere would
 * mean re-running the same git/checkpoint-diff queries and parsing. This
 * store lets `DiffPanel.tsx` publish that already-computed list so
 * `DiffFileListPanel` (mounted separately, in the right sidebar's
 * diff-browsing area) can render the same "changed files" list without
 * duplicating the fetch/parse pipeline.
 */
interface DiffPanelFileListState {
  byThreadKey: Record<string, ReadonlyArray<FileDiffMetadata>>;
  setFileList: (ref: ScopedThreadRef, files: ReadonlyArray<FileDiffMetadata>) => void;
}

export const useDiffPanelFileListStore = create<DiffPanelFileListState>((set) => ({
  byThreadKey: {},
  setFileList: (ref, files) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      if (state.byThreadKey[threadKey] === files) return state;
      return { byThreadKey: { ...state.byThreadKey, [threadKey]: files } };
    }),
}));

const EMPTY_FILE_LIST: ReadonlyArray<FileDiffMetadata> = [];

export function selectDiffPanelFileList(
  byThreadKey: Record<string, ReadonlyArray<FileDiffMetadata>>,
  ref: ScopedThreadRef | null | undefined,
): ReadonlyArray<FileDiffMetadata> {
  if (!ref) return EMPTY_FILE_LIST;
  return byThreadKey[scopedThreadKey(ref)] ?? EMPTY_FILE_LIST;
}
