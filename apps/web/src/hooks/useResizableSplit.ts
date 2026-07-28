import * as Schema from "effect/Schema";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
} from "react";

import { getLocalStorageItem, setLocalStorageItem } from "./useLocalStorage";

const SizeSchema = Schema.Finite;

/** Default arrow-key nudge step, in pixels. */
export const DEFAULT_RESIZE_STEP = 8;

export type ResizableSplitAxis = "width" | "height";

/**
 * Which edge of the host element carries the drag handle. For `axis:
 * "width"` panels this is "left" | "right"; for `axis: "height"` panels this
 * is "top" | "bottom". The edge determines the sign of the pointer delta and
 * which arrow keys grow vs. shrink the panel.
 */
export type ResizableSplitEdge = "left" | "right" | "top" | "bottom";

export interface UseResizableSplitOptions {
  /** Whether the handle resizes width or height. */
  readonly axis: ResizableSplitAxis;
  /** Which edge of the host element carries the drag handle. */
  readonly edge: ResizableSplitEdge;
  /** localStorage key the persisted size is stored under, if persisted. */
  readonly storageKey?: string;
  readonly defaultSize: number;
  readonly minSize: number;
  readonly maxSize: number;
  /** Arrow-key nudge step in pixels. Defaults to {@link DEFAULT_RESIZE_STEP}. */
  readonly step?: number;
}

export interface ResizableSplitHandleProps {
  readonly role: "separator";
  readonly "aria-orientation": "horizontal" | "vertical";
  readonly "aria-valuenow": number;
  readonly "aria-valuemin": number;
  readonly "aria-valuemax": number;
  readonly tabIndex: 0;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export interface UseResizableSplitResult {
  readonly size: number;
  readonly isDragging: boolean;
  readonly handleProps: ResizableSplitHandleProps;
}

export function clampSplitSize(value: number, minSize: number, maxSize: number): number {
  if (!Number.isFinite(value)) return minSize;
  return Math.max(minSize, Math.min(maxSize, value));
}

/**
 * Sign applied to a pointer delta (or key-nudge step) so that dragging/
 * pressing "toward growth" always increases size, regardless of which edge
 * carries the handle.
 *
 * - width + left edge   → panel is right-anchored, grows leftward (dragging
 *   left grows it), so a leftward pointer delta must be negated to grow.
 * - width + right edge  → panel is left-anchored, grows rightward.
 * - height + top edge   → panel is bottom-anchored, grows upward.
 * - height + bottom edge → panel is top-anchored, grows downward.
 */
function growthSign(edge: ResizableSplitEdge): 1 | -1 {
  return edge === "left" || edge === "top" ? -1 : 1;
}

/**
 * Arrow-key size delta for a given axis/edge. Pressing the arrow that
 * visually points "toward growth" for the anchored edge always increases
 * size, mirroring the pointer-drag direction handled by `growthSign`.
 */
export function resolveKeyDelta(
  key: string,
  axis: ResizableSplitAxis,
  edge: ResizableSplitEdge,
  step: number,
): number | null {
  const sign = growthSign(edge);
  if (axis === "width") {
    if (key === "ArrowRight") return step * sign;
    if (key === "ArrowLeft") return -step * sign;
    return null;
  }
  if (key === "ArrowDown") return step * sign;
  if (key === "ArrowUp") return -step * sign;
  return null;
}

/**
 * Generalized resizable-split hook: a drag handle on a given edge that
 * resizes either the width or the height of a host element, with optional
 * localStorage persistence and keyboard nudge support.
 *
 * This generalizes `useResizableWidth` (width-only, no keyboard support) to
 * also cover height splits (e.g. a right-sidebar top/bottom split) and adds
 * `role="separator"` + arrow-key nudging so consumers don't need a
 * third-party resizable-panel library just for keyboard accessibility.
 *
 * Size is read from localStorage on mount (when `storageKey` is provided)
 * and persisted on drag-end / key-nudge, not on every rAF tick.
 */
export function useResizableSplit(options: UseResizableSplitOptions): UseResizableSplitResult {
  const {
    axis,
    edge,
    storageKey,
    defaultSize,
    minSize,
    maxSize,
    step = DEFAULT_RESIZE_STEP,
  } = options;

  const clamp = useCallback(
    (value: number): number => clampSplitSize(value, minSize, maxSize),
    [minSize, maxSize],
  );

  // No cross-tab subscription: panel size is per-window state.
  const [size, setSize] = useState<number>(() => {
    if (typeof window === "undefined" || !storageKey) return clamp(defaultSize);
    try {
      const stored = getLocalStorageItem(storageKey, SizeSchema);
      return clamp(stored ?? defaultSize);
    } catch (error) {
      console.error("Could not read persisted panel size.", error);
      return clamp(defaultSize);
    }
  });

  const [isDragging, setIsDragging] = useState(false);
  const clampedSize = clamp(size);

  const persist = useCallback(
    (value: number) => {
      if (!storageKey) return;
      try {
        setLocalStorageItem(storageKey, value, SizeSchema);
      } catch (error) {
        console.error("Could not persist panel size.", error);
      }
    },
    [storageKey],
  );

  const dragStateRef = useRef<{
    pointerId: number;
    startPos: number;
    startSize: number;
    pending: number;
    rafId: number | null;
    target: HTMLElement;
  } | null>(null);

  const releasePointer = useCallback((pointerId: number) => {
    const state = dragStateRef.current;
    if (!state) return;
    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
    }
    try {
      if (state.target.hasPointerCapture(pointerId)) {
        state.target.releasePointerCapture(pointerId);
      }
    } catch {
      // pointer may already be released; harmless.
    }
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    dragStateRef.current = null;
    setIsDragging(false);
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        return;
      }
      document.body.style.cursor = axis === "width" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      dragStateRef.current = {
        pointerId: event.pointerId,
        startPos: axis === "width" ? event.clientX : event.clientY,
        startSize: clampedSize,
        pending: clampedSize,
        rafId: null,
        target,
      };
      setIsDragging(true);
    },
    [axis, clampedSize],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      event.preventDefault();
      const pos = axis === "width" ? event.clientX : event.clientY;
      const rawDelta = pos - state.startPos;
      const delta = growthSign(edge) === -1 ? -rawDelta : rawDelta;
      state.pending = clamp(state.startSize + delta);
      if (state.rafId !== null) return;
      state.rafId = requestAnimationFrame(() => {
        const active = dragStateRef.current;
        if (!active) return;
        active.rafId = null;
        setSize(active.pending);
      });
    },
    [axis, clamp, edge],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const finalSize = clamp(state.pending);
      releasePointer(event.pointerId);
      // Commit once at drag-end to avoid 60Hz localStorage writes.
      persist(finalSize);
      setSize(finalSize);
    },
    [clamp, persist, releasePointer],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      // Don't persist a cancelled drag; revert to the start size.
      releasePointer(event.pointerId);
      setSize(state.startSize);
    },
    [releasePointer],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const delta = resolveKeyDelta(event.key, axis, edge, step);
      if (delta === null) return;
      event.preventDefault();
      setSize((current) => {
        const next = clamp(clamp(current) + delta);
        persist(next);
        return next;
      });
    },
    [axis, clamp, edge, persist, step],
  );

  return {
    size: clampedSize,
    isDragging,
    handleProps: {
      role: "separator",
      "aria-orientation": axis === "width" ? "vertical" : "horizontal",
      "aria-valuenow": Math.round(clampedSize),
      "aria-valuemin": minSize,
      "aria-valuemax": maxSize,
      tabIndex: 0,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onKeyDown,
    },
  };
}
