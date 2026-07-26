import { ProviderDriverKind, ProviderInstanceId } from "@eflob/contracts";
import type { ProviderAccountUsageSnapshots } from "@eflob/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildAccountUsageRows, formatResetsIn } from "./SidebarAccountUsage.logic";

const NOW = "2026-07-26T12:00:00.000Z";

function snapshots(
  windows: ReadonlyArray<{
    key: string;
    label?: string;
    usedPercent: number;
    resetsAt?: string;
    status?: "ok" | "warning" | "exhausted";
  }>,
  overrides: { accountLabel?: string; planLabel?: string } = {},
): ProviderAccountUsageSnapshots {
  return [
    {
      instanceId: ProviderInstanceId.make("claude_work"),
      driver: ProviderDriverKind.make("claudeAgent"),
      windows: windows.map((window) => ({ ...window, observedAt: NOW })),
      updatedAt: NOW,
      ...overrides,
    },
  ] as ProviderAccountUsageSnapshots;
}

describe("buildAccountUsageRows", () => {
  it("orders the shortest window first", () => {
    const rows = buildAccountUsageRows(
      snapshots([
        { key: "seven_day", label: "7d", usedPercent: 10 },
        { key: "five_hour", label: "5h", usedPercent: 40 },
      ]),
      NOW,
    );

    expect(rows.map((row) => row.windowLabel)).toEqual(["5h", "7d"]);
  });

  it("drops windows whose reset time has already passed", () => {
    const rows = buildAccountUsageRows(
      snapshots([
        { key: "five_hour", label: "5h", usedPercent: 95, resetsAt: "2026-07-26T11:00:00.000Z" },
        { key: "seven_day", label: "7d", usedPercent: 20, resetsAt: "2026-07-30T00:00:00.000Z" },
      ]),
      NOW,
    );

    expect(rows.map((row) => row.windowLabel)).toEqual(["7d"]);
  });

  it("keeps windows with no reset time", () => {
    const rows = buildAccountUsageRows(
      snapshots([{ key: "five_hour", label: "5h", usedPercent: 5 }]),
      NOW,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.resetsAt).toBeNull();
  });

  it("assigns tones from thresholds and explicit status", () => {
    const rows = buildAccountUsageRows(
      snapshots([
        { key: "a", label: "1h", usedPercent: 79 },
        { key: "b", label: "2h", usedPercent: 80 },
        { key: "c", label: "3h", usedPercent: 100 },
        { key: "d", label: "4h", usedPercent: 5, status: "exhausted" },
      ]),
      NOW,
    );

    expect(rows.map((row) => row.tone)).toEqual(["ok", "warning", "exhausted", "exhausted"]);
  });

  it("falls back to the raw window key when no label was derived", () => {
    const rows = buildAccountUsageRows(
      snapshots([{ key: "thirty_day_future", usedPercent: 30 }]),
      NOW,
    );

    expect(rows[0]?.windowLabel).toBe("thirty_day_future");
  });

  it("clamps percentages and maps the driver to a display name", () => {
    const rows = buildAccountUsageRows(
      snapshots([{ key: "five_hour", label: "5h", usedPercent: 140 }]),
      NOW,
    );

    expect(rows[0]?.usedPercent).toBe(100);
    expect(rows[0]?.providerLabel).toBe("Claude");
  });

  it("carries account and plan labels through", () => {
    const rows = buildAccountUsageRows(
      snapshots([{ key: "five_hour", label: "5h", usedPercent: 10 }], {
        accountLabel: "a@b.com",
        planLabel: "Claude Max 5x",
      }),
      NOW,
    );

    expect(rows[0]?.accountLabel).toBe("a@b.com");
    expect(rows[0]?.planLabel).toBe("Claude Max 5x");
  });

  it("returns nothing for an empty snapshot list", () => {
    expect(buildAccountUsageRows([], NOW)).toEqual([]);
  });
});

describe("formatResetsIn", () => {
  it("renders minutes, hours and days", () => {
    expect(formatResetsIn("2026-07-26T12:30:00.000Z", NOW)).toBe("resets in 30m");
    expect(formatResetsIn("2026-07-26T15:00:00.000Z", NOW)).toBe("resets in 3h");
    expect(formatResetsIn("2026-07-26T15:15:00.000Z", NOW)).toBe("resets in 3h 15m");
    expect(formatResetsIn("2026-07-29T12:00:00.000Z", NOW)).toBe("resets in 3d");
    expect(formatResetsIn("2026-07-29T18:00:00.000Z", NOW)).toBe("resets in 3d 6h");
  });

  it("returns nothing for past, absent or unparseable values", () => {
    expect(formatResetsIn("2026-07-26T11:00:00.000Z", NOW)).toBeNull();
    expect(formatResetsIn(null, NOW)).toBeNull();
    expect(formatResetsIn("not-a-date", NOW)).toBeNull();
  });
});
