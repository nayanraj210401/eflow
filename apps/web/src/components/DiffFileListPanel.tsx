import type { FileDiffMetadata } from "@pierre/diffs/types";

import { cn } from "~/lib/utils";
import { getDiffCollapseIconClassName } from "../lib/diffRendering";
import { buildDiffFileList, type DiffFileListEntry } from "./diffs/diffFileList";

interface DiffFileListPanelProps {
  /** Parsed file diffs to list — typically `renderablePatch.files` from `getRenderablePatch`. */
  files: ReadonlyArray<FileDiffMetadata>;
  /** The relative path of the row that should render as selected/active. */
  selectedRelativePath?: string | null;
  /** Called with the file's relative path when a row is clicked/activated. */
  onSelectFile: (relativePath: string) => void;
  className?: string;
}

function DiffFileListRow({
  entry,
  selected,
  onSelectFile,
}: {
  entry: DiffFileListEntry;
  selected: boolean;
  onSelectFile: (relativePath: string) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
        selected
          ? "bg-foreground/[0.08] text-foreground"
          : "text-foreground/90 hover:bg-foreground/[0.05]",
      )}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelectFile(entry.filePath)}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-current",
          getDiffCollapseIconClassName(entry.fileDiff),
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate font-mono">{entry.filePath}</span>
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums">
        {entry.additions > 0 && (
          <span className="text-[var(--diffs-addition-base)]">+{entry.additions}</span>
        )}
        {entry.deletions > 0 && (
          <span className="text-[var(--diffs-deletion-base)]">-{entry.deletions}</span>
        )}
      </span>
    </button>
  );
}

export function DiffFileListPanel({
  files,
  selectedRelativePath,
  onSelectFile,
  className,
}: DiffFileListPanelProps) {
  const entries = buildDiffFileList(files);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex shrink-0 items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground">
        <span>Changes</span>
        <span className="tabular-nums">{entries.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-1">
        {entries.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground/70">No changed files.</p>
        ) : (
          entries.map((entry) => (
            <DiffFileListRow
              key={entry.fileKey}
              entry={entry}
              selected={entry.filePath === selectedRelativePath}
              onSelectFile={onSelectFile}
            />
          ))
        )}
      </div>
    </div>
  );
}
