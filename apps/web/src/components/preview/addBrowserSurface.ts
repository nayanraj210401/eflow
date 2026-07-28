import { mapAtomCommandResult, type AtomCommandResult } from "@eflob/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@eflob/contracts";

import type { PreviewSessionSnapshot } from "@eflob/contracts";

import type { OpenPreviewMutation } from "~/browser/openFileInPreview";
import { useRightPanelStore } from "~/rightPanelStore";

import { openPreviewSession } from "./openPreviewSession";

/** Creates a new browser tab. Reopening an existing tab is a separate UI action. */
export async function addBrowserSurface<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly openPreview: OpenPreviewMutation<E>;
  /**
   * Called with the newly created tab's snapshot once the surface has been
   * opened in `rightPanelStore`, so callers (e.g. `centerTabsStore`) can
   * mirror the new tab elsewhere without this module needing to know about
   * them.
   */
  readonly onOpened?: (snapshot: PreviewSessionSnapshot) => void;
}): Promise<AtomCommandResult<void, E>> {
  const result = await openPreviewSession({
    openPreview: input.openPreview,
    threadRef: input.threadRef,
  });
  return mapAtomCommandResult(result, (snapshot) => {
    useRightPanelStore.getState().openBrowser(input.threadRef, snapshot.tabId);
    input.onOpened?.(snapshot);
  });
}
