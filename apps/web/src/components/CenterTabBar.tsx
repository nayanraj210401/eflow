import type { PreviewSessionSnapshot, ScopedProjectRef } from "@eflob/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ClipboardList, FileDiff, Globe2, MessageSquare } from "lucide-react";
import { useMemo } from "react";

import { scopedProjectKey, scopedThreadKey } from "@eflob/client-runtime/environment";

import { PierreEntryIcon } from "~/components/chat/PierreEntryIcon";
import { faviconUrlForOrigin } from "~/lib/favicon";
import { useTheme } from "~/hooks/useTheme";
import { useThreadShells } from "~/state/entities";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "~/threadRoutes";

import { TabStrip, type TabStripItem } from "~/components/ui/tabs";
import {
  type CenterTab,
  type EnvironmentCenterTabsState,
  selectVisibleCenterTabIds,
  useCenterTabsStore,
} from "~/centerTabsStore";

/**
 * Phase 2 scope: thread/file/diff/plan/preview center-tab kinds are all
 * rendered (see the design doc's phasing section).
 */
const RENDERED_KINDS = new Set<CenterTab["kind"]>(["thread", "file", "diff", "plan", "preview"]);

function previewLabel(
  tab: Extract<CenterTab, { kind: "preview" }>,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
): string {
  const snapshot = tab.previewTabId ? sessions[tab.previewTabId] : null;
  if (!snapshot || snapshot.navStatus._tag === "Idle") return "Browser";
  if (snapshot.navStatus.title.trim().length > 0) return snapshot.navStatus.title;
  try {
    return new URL(snapshot.navStatus.url).host || "Browser";
  } catch {
    return "Browser";
  }
}

function previewUrl(
  tab: Extract<CenterTab, { kind: "preview" }>,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
): string | null {
  const snapshot = tab.previewTabId ? sessions[tab.previewTabId] : null;
  if (!snapshot || snapshot.navStatus._tag === "Idle") return null;
  return snapshot.navStatus.url;
}

function PreviewFavicon({ url }: { url: string | null }) {
  const faviconUrl = faviconUrlForOrigin(url, 32);
  if (!faviconUrl) return <Globe2 className="size-3.5 shrink-0" />;
  return (
    <img
      src={faviconUrl}
      alt=""
      aria-hidden
      draggable={false}
      className="size-3.5 shrink-0 rounded-sm"
    />
  );
}

function fileName(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf("/") + 1);
}

function threadLabel(
  tab: Extract<CenterTab, { kind: "thread" }>,
  threadTitleByKey: ReadonlyMap<string, string>,
): string {
  if (tab.target.kind === "draft") return "New chat";
  const title = threadTitleByKey.get(scopedThreadKey(tab.target.threadRef));
  return title ?? "Thread";
}

export interface CenterTabBarProps {
  projectRef: ScopedProjectRef | null | undefined;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  ownsDesktopTitleBar?: boolean;
  className?: string;
}

/**
 * VSCode-style center tab bar, driven by `centerTabsStore` for the current
 * project. Phase 1 renders file/diff/plan/preview kinds only.
 */
export function CenterTabBar({
  projectRef,
  previewSessions,
  ownsDesktopTitleBar,
  className,
}: CenterTabBarProps) {
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const threadShells = useThreadShells();
  const threadTitleByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const shell of threadShells) {
      map.set(
        scopedThreadKey({ environmentId: shell.environmentId, threadId: shell.id }),
        shell.title,
      );
    }
    return map;
  }, [threadShells]);
  const environmentState: EnvironmentCenterTabsState = useCenterTabsStore((state) =>
    projectRef ? (state.byProjectKey[scopedProjectKey(projectRef)] ?? EMPTY_STATE) : EMPTY_STATE,
  );

  const visibleTabIds = useMemo(
    () =>
      selectVisibleCenterTabIds(environmentState).filter((tabId) => {
        const tab = environmentState.tabs[tabId];
        return tab !== undefined && RENDERED_KINDS.has(tab.kind);
      }),
    [environmentState],
  );

  const items: TabStripItem[] = useMemo(
    () =>
      visibleTabIds.flatMap((tabId) => {
        const tab = environmentState.tabs[tabId];
        if (!tab) return [];
        switch (tab.kind) {
          case "thread":
            return [
              {
                id: tab.id,
                label: threadLabel(tab, threadTitleByKey),
                icon: <MessageSquare className="size-3.5 shrink-0" />,
              },
            ];
          case "file":
            return [
              {
                id: tab.id,
                label: fileName(tab.relativePath),
                icon: (
                  <PierreEntryIcon
                    pathValue={tab.relativePath}
                    kind="file"
                    theme={resolvedTheme}
                    className="size-3.5"
                  />
                ),
              },
            ];
          case "diff":
            return [
              { id: tab.id, label: "Changes", icon: <FileDiff className="size-3.5 shrink-0" /> },
            ];
          case "plan":
            return [
              { id: tab.id, label: "Plan", icon: <ClipboardList className="size-3.5 shrink-0" /> },
            ];
          case "preview":
            return [
              {
                id: tab.id,
                label: previewLabel(tab, previewSessions),
                icon: <PreviewFavicon url={previewUrl(tab, previewSessions)} />,
              },
            ];
          default:
            return [];
        }
      }),
    [visibleTabIds, environmentState, previewSessions, resolvedTheme, threadTitleByKey],
  );

  if (!projectRef) return null;

  /**
   * Navigates the URL to match whichever tab is now active in the store, if
   * it's a thread tab. Called after any store mutation that can change
   * `activeTabId` (activation, and every close variant that may fall back to
   * a different tab) so the address bar / history never drifts from what's
   * on screen.
   */
  const syncNavigationToActiveTab = () => {
    const nextState = useCenterTabsStore.getState().byProjectKey[scopedProjectKey(projectRef)];
    const activeTabId = nextState?.activeTabId ?? null;
    const tab = activeTabId ? nextState?.tabs[activeTabId] : undefined;
    if (!tab || tab.kind !== "thread") return;
    if (tab.target.kind === "server") {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(tab.target.threadRef),
        replace: true,
      });
    } else {
      void navigate({
        to: "/draft/$draftId",
        params: buildDraftThreadRouteParams(tab.target.draftId),
        replace: true,
      });
    }
  };

  const onActivate = (tabId: string) => {
    useCenterTabsStore.getState().activateTab(projectRef, tabId);
    syncNavigationToActiveTab();
  };
  const onClose = (tabId: string) => {
    useCenterTabsStore.getState().closeTab(projectRef, tabId);
    syncNavigationToActiveTab();
  };
  const onCloseOthers = (tabId: string) => {
    useCenterTabsStore.getState().closeOtherTabs(projectRef, tabId);
    syncNavigationToActiveTab();
  };
  const onCloseToRight = (tabId: string) => {
    useCenterTabsStore.getState().closeTabsToRight(projectRef, tabId);
    syncNavigationToActiveTab();
  };
  const onCloseAll = () => {
    useCenterTabsStore.getState().closeAllTabs(projectRef);
    syncNavigationToActiveTab();
  };

  if (items.length === 0) return null;

  return (
    <TabStrip
      items={items}
      activeTabId={environmentState.activeTabId}
      onActivate={onActivate}
      onClose={onClose}
      onCloseOthers={onCloseOthers}
      onCloseToRight={onCloseToRight}
      onCloseAll={onCloseAll}
      ownsDesktopTitleBar={ownsDesktopTitleBar ?? false}
      {...(className !== undefined ? { className } : {})}
    />
  );
}

const EMPTY_STATE: EnvironmentCenterTabsState = {
  tabIds: [],
  activeTabId: null,
  tabs: {},
  activeThreadTabId: null,
};
