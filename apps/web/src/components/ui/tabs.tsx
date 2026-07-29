"use client";

import { ChevronDown, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "~/lib/utils";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

/**
 * Generic VSCode-style tab-strip primitive.
 *
 * Purely presentational: callers own the underlying "what is a tab" data model
 * (threads, files, diffs, terminals, ...) and pass a flattened list of
 * `TabStripItem`s plus callbacks. This file has no knowledge of any specific
 * surface kind.
 */
export interface TabStripItem {
  id: string;
  label: string;
  icon?: ReactNode;
  closable?: boolean;
  isDirty?: boolean;
}

export interface TabStripProps {
  items: readonly TabStripItem[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
  onClose?: (id: string) => void;
  onCloseOthers?: (id: string) => void;
  onCloseToRight?: (id: string) => void;
  onCloseAll?: () => void;
  /**
   * Stubbed out for future drag-to-reorder support. The prop shape is fixed
   * now so callers/stores can be built against it before DnD lands.
   */
  onReorder?: (fromId: string, toId: string) => void;
  /**
   * Whether this tab strip owns the Electron draggable title-bar region
   * (`wco:`/drag-region CSS). The strip that renders at the very top of the
   * window (the new central tab bar) should pass `true`; a secondary strip
   * (e.g. the terminal dock's tab row) should pass `false` (default).
   */
  ownsDesktopTitleBar?: boolean;
  /** Rendered at the trailing edge of the strip, outside the scroll area (e.g. an "add tab" button). */
  trailingActions?: ReactNode;
  /** Rendered at the very end of the bar, after the scroll area and the overflow chevron (e.g. layout controls). */
  endSlot?: ReactNode;
  className?: string;
  tabClassName?: string;
}

type TabContextMenuAction = "close" | "close-others" | "close-to-right" | "close-all";

interface ContextMenuState {
  tabId: string;
  anchor: { x: number; y: number };
}

export function TabStrip(props: TabStripProps) {
  const {
    items,
    activeTabId,
    onActivate,
    onClose,
    onCloseOthers,
    onCloseToRight,
    onCloseAll,
    ownsDesktopTitleBar = false,
    trailingActions,
    endSlot,
    className,
    tabClassName,
  } = props;

  const tabListRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);

  const hasCloseActions = Boolean(onClose || onCloseOthers || onCloseToRight || onCloseAll);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleTabContextMenu = useCallback(
    (event: ReactMouseEvent, tabId: string) => {
      if (!hasCloseActions) return;
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({ tabId, anchor: { x: event.clientX, y: event.clientY } });
    },
    [hasCloseActions],
  );

  const handleContextMenuAction = useCallback(
    (action: TabContextMenuAction, tabId: string) => {
      switch (action) {
        case "close":
          onClose?.(tabId);
          break;
        case "close-others":
          onCloseOthers?.(tabId);
          break;
        case "close-to-right":
          onCloseToRight?.(tabId);
          break;
        case "close-all":
          onCloseAll?.();
          break;
      }
      closeContextMenu();
    },
    [onClose, onCloseOthers, onCloseToRight, onCloseAll, closeContextMenu],
  );

  const handleTabMouseDown = useCallback((event: ReactMouseEvent) => {
    // Prevent middle-click auto-scroll/paste behavior so it can be repurposed for "close".
    if (event.button !== 1) return;
    event.preventDefault();
  }, []);

  const handleTabAuxClick = useCallback(
    (event: ReactMouseEvent, tabId: string, closable: boolean) => {
      if (event.button !== 1 || !closable) return;
      event.preventDefault();
      event.stopPropagation();
      onClose?.(tabId);
    },
    [onClose],
  );

  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent, tabId: string, closable: boolean) => {
      if ((event.key === "Delete" || event.key === "Backspace") && closable) {
        event.preventDefault();
        onClose?.(tabId);
      }
    },
    [onClose],
  );

  useEffect(() => {
    const activeTab = tabListRef.current?.querySelector<HTMLElement>("[data-active-tab='true']");
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  const contextMenuIndex = useMemo(
    () => (contextMenu ? items.findIndex((item) => item.id === contextMenu.tabId) : -1),
    [contextMenu, items],
  );

  const contextMenuAnchor = useMemo(() => {
    if (!contextMenu) return undefined;
    const { x, y } = contextMenu.anchor;
    return {
      getBoundingClientRect: () => new DOMRect(x, y, 0, 0),
    };
  }, [contextMenu]);

  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)} data-slot="tab-strip">
      <ScrollArea
        ref={tabListRef}
        hideScrollbars
        scrollFade
        className={cn("min-w-0 flex-1 rounded-none", ownsDesktopTitleBar && "drag-region")}
        data-slot="tab-strip-list"
      >
        <div className="flex h-full w-max min-w-full items-center gap-1">
          {items.map((item) => {
            const active = item.id === activeTabId;
            const closable = item.closable !== false && Boolean(onClose);
            return (
              <div
                key={item.id}
                data-active-tab={active}
                data-slot="tab-strip-tab"
                onMouseDown={handleTabMouseDown}
                onAuxClick={(event) => handleTabAuxClick(event, item.id, closable)}
                onContextMenu={(event) => handleTabContextMenu(event, item.id)}
                onKeyDown={(event) => handleTabKeyDown(event, item.id, closable)}
                className={cn(
                  "group flex h-7 min-w-25 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  tabClassName,
                )}
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1.5"
                        onClick={() => onActivate(item.id)}
                      >
                        {item.icon}
                        <span className="truncate">{item.label}</span>
                        {item.isDirty ? (
                          <span
                            className="size-1.5 shrink-0 rounded-full bg-current opacity-70"
                            aria-hidden
                          />
                        ) : null}
                      </button>
                    }
                  />
                  <TooltipPopup>{item.label}</TooltipPopup>
                </Tooltip>
                {closable ? (
                  <button
                    type="button"
                    className="relative flex size-4 shrink-0 items-center justify-center rounded opacity-0 hover:bg-muted focus:opacity-100 group-hover:opacity-100"
                    aria-label={`Close ${item.label}`}
                    onClick={() => onClose?.(item.id)}
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {items.length > 0 ? (
        <Menu open={overflowOpen} onOpenChange={setOverflowOpen}>
          <MenuTrigger
            className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Show all open tabs"
          >
            <ChevronDown className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end" side="bottom" sideOffset={6} className="max-h-96 min-w-56">
            {items.map((item) => (
              <MenuItem
                key={item.id}
                onClick={() => {
                  onActivate(item.id);
                  setOverflowOpen(false);
                }}
                className={item.id === activeTabId ? "bg-accent/60" : undefined}
              >
                {item.icon}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      ) : null}

      {trailingActions}
      {endSlot}

      {hasCloseActions ? (
        <Menu
          open={contextMenu !== null}
          onOpenChange={(open) => {
            if (!open) closeContextMenu();
          }}
        >
          <MenuPopup
            anchor={contextMenuAnchor}
            align="start"
            side="bottom"
            sideOffset={0}
            className="min-w-44"
          >
            {contextMenu ? (
              <>
                <MenuItem
                  disabled={!onClose}
                  onClick={() => handleContextMenuAction("close", contextMenu.tabId)}
                >
                  Close
                </MenuItem>
                <MenuItem
                  disabled={!onCloseOthers || items.length <= 1}
                  onClick={() => handleContextMenuAction("close-others", contextMenu.tabId)}
                >
                  Close others
                </MenuItem>
                <MenuItem
                  disabled={!onCloseToRight || contextMenuIndex >= items.length - 1}
                  onClick={() => handleContextMenuAction("close-to-right", contextMenu.tabId)}
                >
                  Close to the right
                </MenuItem>
                <MenuItem
                  disabled={!onCloseAll || items.length === 0}
                  onClick={() => handleContextMenuAction("close-all", contextMenu.tabId)}
                >
                  Close all
                </MenuItem>
              </>
            ) : null}
          </MenuPopup>
        </Menu>
      ) : null}
    </div>
  );
}
