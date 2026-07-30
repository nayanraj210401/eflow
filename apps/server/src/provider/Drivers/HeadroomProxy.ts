/**
 * Headroom proxy lifecycle.
 *
 * `headroom` (https://github.com/chopratejas/headroom) compresses tool
 * outputs/logs before they reach the LLM. Contrary to what `headroom wrap
 * claude` suggests, it does not wrap the CLI's stdio — it starts a local
 * HTTP proxy and points `ANTHROPIC_BASE_URL` at it, then launches `claude`
 * completely untouched. So eflob doesn't need to change how it spawns
 * `claude` at all; it only needs a healthy local proxy and one extra env
 * var. This module owns starting that proxy (once, lazily, shared across
 * every session) and reports whether the `headroom` CLI is installed.
 */
import { isCommandAvailable } from "@eflob/shared/shell";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { ServerSettingsService } from "../../serverSettings.ts";

export const HEADROOM_PROXY_PORT = 8787;
export const HEADROOM_PROXY_BASE_URL = `http://127.0.0.1:${HEADROOM_PROXY_PORT}`;

const HEALTH_CHECK_TIMEOUT_MS = 1500;
const STARTUP_POLL_INTERVAL_MS = 2000;
// Headroom's Python process has a heavy import chain (ML/embedding deps) on
// cold start; observed cold starts can take well over a minute.
const STARTUP_TIMEOUT_MS = 120_000;

const DETACHED_IGNORE_STDIO_OPTIONS = {
  detached: true,
  stdin: "ignore",
  stdout: "ignore",
  stderr: "ignore",
} as const satisfies ChildProcess.CommandOptions;

export const isHeadroomCliAvailable = Effect.fn("headroomProxy.isHeadroomCliAvailable")(
  function* () {
    return yield* isCommandAvailable("headroom");
  },
);

const isProxyHealthy = (): Promise<boolean> =>
  fetch(`${HEADROOM_PROXY_BASE_URL}/livez`, {
    signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
  })
    .then((response) => response.ok)
    .catch(() => false);

const spawnHeadroomProxyDetached = Effect.fn("headroomProxy.spawnDetached")(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = ChildProcess.make(
    "headroom",
    ["proxy", "--port", String(HEADROOM_PROXY_PORT), "--no-telemetry"],
    DETACHED_IGNORE_STDIO_OPTIONS,
  );
  yield* spawner.spawn(command).pipe(
    Effect.flatMap((handle) => handle.unref),
    Effect.asVoid,
    Effect.scoped,
  );
});

// Shared across every session on this server process: at most one spawn
// attempt in flight at a time, and once healthy every caller reuses the
// same proxy instead of racing to spawn duplicates.
let ensureInFlight: Promise<Option.Option<string>> | null = null;

const runEnsure = async (
  spawnDetached: () => Promise<void>,
): Promise<Option.Option<string>> => {
  if (await isProxyHealthy()) {
    return Option.some(HEADROOM_PROXY_BASE_URL);
  }

  try {
    await spawnDetached();
  } catch {
    // Fall through to polling — the proxy may already be starting from a
    // separate eflob instance, or the port may already be bound.
  }

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, STARTUP_POLL_INTERVAL_MS));
    if (await isProxyHealthy()) {
      return Option.some(HEADROOM_PROXY_BASE_URL);
    }
  }
  return Option.none();
};

/**
 * Ensures a Headroom proxy is running and healthy, starting one if needed.
 * Returns `Option.none()` (never fails the caller) if Headroom can't be
 * reached — sessions must fall back to spawning `claude` unwrapped.
 */
export const ensureHeadroomProxy = Effect.fn("headroomProxy.ensure")(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const spawnDetached = () =>
    Effect.runPromise(
      spawnHeadroomProxyDetached().pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      ),
    );

  if (!ensureInFlight) {
    ensureInFlight = runEnsure(spawnDetached).finally(() => {
      ensureInFlight = null;
    });
  }
  return yield* Effect.promise(() => ensureInFlight!);
});

/**
 * Returns `baseEnv` unchanged unless the Headroom beta toggle is on and the
 * `headroom` CLI is available, in which case it returns a copy with
 * `ANTHROPIC_BASE_URL` pointed at a (started-if-needed) local Headroom
 * proxy. Never fails the caller — any Headroom-side problem just falls back
 * to the unmodified environment so sessions aren't blocked by this beta
 * feature.
 */
export const resolveClaudeEnvironmentWithHeadroom = Effect.fn(
  "headroomProxy.resolveClaudeEnvironment",
)(function* (baseEnv: NodeJS.ProcessEnv) {
  const settingsService = yield* ServerSettingsService;
  const settings = yield* settingsService.getSettings.pipe(Effect.orElseSucceed(() => undefined));
  if (!settings?.headroomWrapEnabled) {
    return baseEnv;
  }
  if (!(yield* isHeadroomCliAvailable())) {
    return baseEnv;
  }

  const proxyBaseUrl = yield* ensureHeadroomProxy();
  return Option.match(proxyBaseUrl, {
    onNone: () => baseEnv,
    onSome: (baseUrl): NodeJS.ProcessEnv => ({ ...baseEnv, ANTHROPIC_BASE_URL: baseUrl }),
  });
});
