import { type ReactNode } from "react";

import { isElectron } from "~/env";
import { useAvailableContentWidth } from "~/hooks/useAvailableContentWidth";
import { useResizableWidth } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

import { RightPanelResizeHandle } from "./RightPanelResizeHandle";

export type PreviewPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

const PREVIEW_PANEL_WIDTH_STORAGE_KEY = "eflob:preview-panel-width";
const PREVIEW_PANEL_MIN_WIDTH = 360;
/** Fraction of the available content width allowed, preserving the remaining space for chat. */
const PREVIEW_PANEL_MAX_WIDTH_FRACTION = 0.7;
const PREVIEW_PANEL_DEFAULT_WIDTH = 540;

export function getPreviewPanelMaxWidth(availableContentWidth: number): number {
  return Math.floor(availableContentWidth * PREVIEW_PANEL_MAX_WIDTH_FRACTION);
}

/**
 * Shell for the preview panel. In inline mode the panel is user-resizable
 * via a drag handle on the left edge; width persists per browser. In
 * sheet/sidebar modes the parent owns the size.
 */
export function PreviewPanelShell(props: {
  mode: PreviewPanelMode;
  maximized?: boolean;
  children: ReactNode;
}) {
  const useDragRegion = isElectron && props.mode !== "sheet" && props.mode !== "embedded";
  const isInline = props.mode === "inline";
  const maxWidth = getPreviewPanelMaxWidth(useAvailableContentWidth());
  const { width, handlers } = useResizableWidth({
    storageKey: PREVIEW_PANEL_WIDTH_STORAGE_KEY,
    defaultWidth: PREVIEW_PANEL_DEFAULT_WIDTH,
    minWidth: PREVIEW_PANEL_MIN_WIDTH,
    maxWidth,
    edge: "left",
  });

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-col self-stretch bg-background",
        isInline
          ? props.maximized
            ? "flex-1 border-l border-border"
            : "shrink-0 border-l border-border"
          : "w-full",
      )}
      style={isInline && !props.maximized ? { width: `${width}px` } : undefined}
      data-preview-panel-mode={props.mode}
      data-preview-panel-maximized={props.maximized ? "true" : "false"}
    >
      {isInline && !props.maximized ? <RightPanelResizeHandle handlers={handlers} /> : null}
      {useDragRegion ? <div className="electron-drag-region h-0 w-full" aria-hidden /> : null}
      {props.children}
    </div>
  );
}
