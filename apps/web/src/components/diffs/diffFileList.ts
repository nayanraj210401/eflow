import type { ChangeTypes, FileDiffMetadata } from "@pierre/diffs/types";

import { buildFileDiffRenderKey, resolveFileDiffPath } from "~/lib/diffRendering";

/**
 * Pure helpers that derive a "list of changed files" shape from parsed diff
 * data (`FileDiffMetadata[]`, as produced by `getRenderablePatch`/
 * `parsePatchFiles`). No React, no workers, no live refs — data in, data out.
 * Shared by `DiffFileListPanel.tsx` (list-only view) and `DiffPanel.tsx`
 * (full virtualized diff view) so the parsing/derivation logic isn't
 * duplicated between the two.
 */

/** Line-level added/removed counts for a single file's diff. */
export interface DiffFileLineStats {
  readonly additions: number;
  readonly deletions: number;
}

/** A single row in the "changed files" list. */
export interface DiffFileListEntry extends DiffFileLineStats {
  /** Stable identity for the file within a given patch (see `buildFileDiffRenderKey`). */
  readonly fileKey: string;
  /** Display path (renamed files show the new path). */
  readonly filePath: string;
  /** The underlying change type as reported by the diff parser. */
  readonly status: ChangeTypes;
  /** The raw parsed file diff, for callers that need to render its content. */
  readonly fileDiff: FileDiffMetadata;
}

/**
 * Sums additions/deletions across all hunks of a single file's diff.
 * `Hunk.additionLines`/`Hunk.deletionLines` already give the per-hunk count
 * of `+`/`-` prefixed lines, so this is a plain reduction over static data.
 */
export function computeFileDiffLineStats(fileDiff: FileDiffMetadata): DiffFileLineStats {
  return fileDiff.hunks.reduce<DiffFileLineStats>(
    (totals, hunk) => ({
      additions: totals.additions + hunk.additionLines,
      deletions: totals.deletions + hunk.deletionLines,
    }),
    { additions: 0, deletions: 0 },
  );
}

/** Builds a single list entry from a parsed file diff. */
export function buildDiffFileListEntry(fileDiff: FileDiffMetadata): DiffFileListEntry {
  const { additions, deletions } = computeFileDiffLineStats(fileDiff);
  return {
    fileKey: buildFileDiffRenderKey(fileDiff),
    filePath: resolveFileDiffPath(fileDiff),
    status: fileDiff.type,
    additions,
    deletions,
    fileDiff,
  };
}

/**
 * Sorts parsed file diffs by display path (numeric-aware, case-insensitive),
 * matching the ordering used across the diff UI.
 */
export function sortFileDiffsByPath(files: ReadonlyArray<FileDiffMetadata>): FileDiffMetadata[] {
  return [...files].toSorted((left, right) =>
    resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

/**
 * Builds the full sorted list of changed-file entries from a set of parsed
 * file diffs (path sort + per-file stats).
 */
export function buildDiffFileList(files: ReadonlyArray<FileDiffMetadata>): DiffFileListEntry[] {
  return sortFileDiffsByPath(files).map(buildDiffFileListEntry);
}
