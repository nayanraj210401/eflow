import type { EnvironmentId } from "@eflob/contracts";
import type { FileDiffMetadata } from "@pierre/diffs/types";
import { useState } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

import { DiffFileListPanel } from "./DiffFileListPanel";
import FileBrowserPanel from "./files/FileBrowserPanel";
import { TabStrip, type TabStripItem } from "./ui/tabs";

type BrowsingTabKind = "files" | "diff";

const BROWSING_TAB_ITEMS: ReadonlyArray<TabStripItem> = [
  { id: "files", label: "Files", closable: false },
  { id: "diff", label: "Diff", closable: false },
];

export interface RightSidebarBrowsingPanelProps {
  maximized?: boolean;
  /** Files tab inputs — `null` when no project is resolved yet (renders nothing for that tab). */
  environmentId: EnvironmentId | null;
  cwd: string | null;
  projectName: string | null;
  onOpenFile: (relativePath: string) => void;
  /** Diff tab inputs. */
  diffAvailable: boolean;
  diffFiles: ReadonlyArray<FileDiffMetadata>;
  diffSelectedFilePath: string | null;
  onSelectDiffFile: (relativePath: string) => void;
  className?: string;
}

/**
 * Right sidebar's fixed top dock (VSCode-style tab layout redesign, Phase 3,
 * design doc section 3): a non-closable "Files | Diff" switcher over
 * navigation-only content — `FileBrowserPanel` (pure tree) and
 * `DiffFileListPanel` (list-only "Changes" view). Neither tab renders file
 * or diff *content*; selecting a row in either dispatches to a central tab
 * (`centerTabsStore`) via the `onOpenFile`/`onSelectDiffFile` callbacks the
 * caller supplies.
 *
 * When `diffAvailable` is false (no server thread / not a Git repo) the
 * switcher still renders both tabs (so the affordance doesn't jump around),
 * but selecting "Diff" shows an empty state instead of a stale/absent list.
 */
export function RightSidebarBrowsingPanel({
  maximized,
  environmentId,
  cwd,
  projectName,
  onOpenFile,
  diffAvailable,
  diffFiles,
  diffSelectedFilePath,
  onSelectDiffFile,
  className,
}: RightSidebarBrowsingPanelProps) {
  const [activeTab, setActiveTab] = useState<BrowsingTabKind>("files");
  const ownsDesktopTitleBar = isElectron;

  return (
    <div className={cn("flex h-full min-h-0 min-w-0 flex-col", className)}>
      <div
        className={cn(
          "workspace-topbar gap-1 pl-2 pr-3",
          ownsDesktopTitleBar && "wco:pr-[calc(var(--workspace-native-controls-inset)+6rem)]",
          maximized && COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
        data-right-sidebar-browsing-tabbar
      >
        <TabStrip
          items={BROWSING_TAB_ITEMS}
          activeTabId={activeTab}
          onActivate={(id) => setActiveTab(id as BrowsingTabKind)}
          ownsDesktopTitleBar={ownsDesktopTitleBar}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === "files" ? (
          environmentId && cwd && projectName ? (
            <FileBrowserPanel
              environmentId={environmentId}
              cwd={cwd}
              projectName={projectName}
              onOpenFile={onOpenFile}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
              No project open.
            </div>
          )
        ) : diffAvailable ? (
          <DiffFileListPanel
            files={diffFiles}
            selectedRelativePath={diffSelectedFilePath}
            onSelectFile={onSelectDiffFile}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
            Diff is only available for server threads in Git repositories.
          </div>
        )}
      </div>
    </div>
  );
}
