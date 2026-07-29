/**
 * One-time bootstrap that migrates `rightPanelStore`-persisted `file`/`plan`/
 * `preview` surfaces into `centerTabsStore` on upgrade to the VSCode-style
 * tab layout, so a user's previously-open items don't silently disappear the
 * first time the new central tab bar renders (it starts out empty, since
 * `centerTabsStore` is a brand-new persisted store with no knowledge of
 * anything opened under the old model).
 *
 * This is intentionally a plain app-start effect rather than logic inside
 * `rightPanelStore`'s `persist` `migrate` function: `migrate` only has access
 * to that one store's persisted blob, not to `centerTabsStore` (see the
 * design doc's "Risks / open questions" #3).
 *
 * Runs at most once ever per browser profile, gated by a localStorage flag,
 * so it never re-imports something the user has since intentionally closed
 * in `centerTabsStore`, and never re-runs on every reload.
 */
import { parseScopedThreadKey } from "@eflob/client-runtime/environment";
import type { ScopedProjectRef, ScopedThreadRef } from "@eflob/contracts";

import type { RightPanelSurface, ThreadRightPanelState } from "../rightPanelStore";
import type { ThreadRouteTarget } from "../threadRoutes";

export const CENTER_TABS_MIGRATION_BOOTSTRAP_FLAG_KEY =
  "eflob:center-tabs-migration-bootstrapped-v1";

export type CenterTabsMigrationAction =
  | {
      kind: "file";
      projectRef: ScopedProjectRef;
      threadRef: ThreadRouteTarget;
      relativePath: string;
      revealLine: number | null;
    }
  | {
      kind: "plan";
      projectRef: ScopedProjectRef;
      threadRef: ThreadRouteTarget;
    }
  | {
      kind: "preview";
      projectRef: ScopedProjectRef;
      threadRef: ThreadRouteTarget;
      previewTabId: string | null;
    };

/**
 * Pure derivation: given `rightPanelStore`'s (already rehydrated/migrated)
 * `byThreadKey` map, compute the list of `centerTabsStore` tabs that should
 * be opened to carry forward any `file`/`plan`/`preview` surfaces a user had
 * open under the old model. Order is stable (by thread key, then surface
 * order within the thread) so tests and any future logging are deterministic.
 *
 * `resolveProjectRef` is injected (rather than reading `state/entities`
 * directly) so this stays a pure function of its inputs — the caller
 * supplies a live lookup (e.g. `readThreadShell`) in production and a fixture
 * map in tests. Threads whose project can't be resolved (e.g. this bootstrap
 * effect racing environment entity sync on a cold start) are skipped —
 * `centerTabsStore` is scoped per-project, so an action without a known
 * `projectRef` has nowhere correct to land; silently dropping it is
 * consistent with this migration's existing best-effort philosophy.
 */
export function computeCenterTabsMigrationActions(
  byThreadKey: Record<string, ThreadRightPanelState>,
  resolveProjectRef: (threadRef: ScopedThreadRef) => ScopedProjectRef | null,
): CenterTabsMigrationAction[] {
  const actions: CenterTabsMigrationAction[] = [];

  for (const [threadKey, threadState] of Object.entries(byThreadKey)) {
    if (!threadState || !Array.isArray(threadState.surfaces)) continue;

    const scopedRef = safeParseScopedThreadKey(threadKey);
    if (!scopedRef) continue;

    const projectRef = resolveProjectRef(scopedRef);
    if (!projectRef) continue;

    const threadRef: ThreadRouteTarget = { kind: "server", threadRef: scopedRef };

    for (const surface of threadState.surfaces) {
      const action = surfaceToMigrationAction(surface, projectRef, threadRef);
      if (action) actions.push(action);
    }
  }

  return actions;
}

function surfaceToMigrationAction(
  surface: RightPanelSurface,
  projectRef: ScopedProjectRef,
  threadRef: ThreadRouteTarget,
): CenterTabsMigrationAction | null {
  switch (surface.kind) {
    case "file":
      if (typeof surface.relativePath !== "string" || surface.relativePath.length === 0) {
        return null;
      }
      return {
        kind: "file",
        projectRef,
        threadRef,
        relativePath: surface.relativePath,
        revealLine:
          typeof surface.revealLine === "number" && Number.isFinite(surface.revealLine)
            ? surface.revealLine
            : null,
      };
    case "plan":
      return { kind: "plan", projectRef, threadRef };
    case "preview":
      return {
        kind: "preview",
        projectRef,
        threadRef,
        previewTabId: surface.resourceId ?? null,
      };
    default:
      return null;
  }
}

function safeParseScopedThreadKey(threadKey: string): ScopedThreadRef | null {
  try {
    return parseScopedThreadKey(threadKey);
  } catch {
    return null;
  }
}

export interface CenterTabsMigrationTarget {
  openFileTab: (
    projectRef: ScopedProjectRef,
    threadRef: ThreadRouteTarget,
    relativePath: string,
    line?: number,
  ) => void;
  openPlanTab: (projectRef: ScopedProjectRef, threadRef: ThreadRouteTarget) => void;
  openPreviewTab: (
    projectRef: ScopedProjectRef,
    threadRef: ThreadRouteTarget,
    previewTabId?: string | null,
  ) => void;
}

function applyCenterTabsMigrationActions(
  actions: readonly CenterTabsMigrationAction[],
  target: CenterTabsMigrationTarget,
): void {
  for (const action of actions) {
    switch (action.kind) {
      case "file":
        target.openFileTab(
          action.projectRef,
          action.threadRef,
          action.relativePath,
          action.revealLine ?? undefined,
        );
        break;
      case "plan":
        target.openPlanTab(action.projectRef, action.threadRef);
        break;
      case "preview":
        target.openPreviewTab(action.projectRef, action.threadRef, action.previewTabId);
        break;
    }
  }
}

export interface RunCenterTabsMigrationBootstrapOnceOptions {
  getFlag: () => string | null;
  setFlag: () => void;
  getByThreadKey: () => Record<string, ThreadRightPanelState>;
  resolveProjectRef: (threadRef: ScopedThreadRef) => ScopedProjectRef | null;
  target: CenterTabsMigrationTarget;
}

/**
 * Best-effort, defensive, idempotent runner: reads the one-time flag, and if
 * unset, migrates `rightPanelStore`'s persisted `file`/`plan`/`preview`
 * surfaces into `centerTabsStore`, then sets the flag so this never runs
 * again. Any failure (malformed storage, missing APIs, etc.) is swallowed so
 * a broken migration can never crash app startup.
 */
export function runCenterTabsMigrationBootstrapOnce(
  options: RunCenterTabsMigrationBootstrapOnceOptions,
): void {
  try {
    if (options.getFlag() !== null) return;
  } catch {
    // If we can't even read the flag, don't guess: no-op rather than risk
    // re-migrating on every launch.
    return;
  }

  try {
    const byThreadKey = options.getByThreadKey();
    const actions = computeCenterTabsMigrationActions(byThreadKey, options.resolveProjectRef);
    applyCenterTabsMigrationActions(actions, options.target);
  } catch {
    // Best-effort: never block app startup on a failed migration.
  }

  try {
    options.setFlag();
  } catch {
    // If we can't persist the flag, worst case we retry next launch.
  }
}
