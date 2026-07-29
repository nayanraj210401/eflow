import { type ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * Shared top-bar chrome for panels that can end up as the topmost/leftmost
 * surface in the desktop window. Wraps the `.workspace-topbar` CSS utility
 * (`apps/web/src/index.css`) and conditionally applies `.drag-region` so the
 * native macOS traffic-light buttons never overlap panel content — see
 * `SidebarChromeHeader` (`sidebar/SidebarChrome.tsx`) for the pattern this
 * generalizes. Panels keep their own border/padding via `className`; this
 * only owns height + drag-region wiring so it can't be forgotten per-panel.
 */
export function PanelTopBar(props: {
  dragRegion: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("workspace-topbar", props.dragRegion && "drag-region", props.className)}>
      {props.children}
    </div>
  );
}
