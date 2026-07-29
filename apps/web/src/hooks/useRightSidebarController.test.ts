import { describe, expect, it } from "vite-plus/test";

import { updatePendingFileSurfaceIds } from "./useRightSidebarController";

describe("updatePendingFileSurfaceIds", () => {
  it("adds a pending surface id under the given project key", () => {
    const result = updatePendingFileSurfaceIds(new Map(), "project-a", "src/foo.ts", true);
    expect(result.get("project-a")).toEqual(new Set(["file:src/foo.ts"]));
  });

  it("removes a surface id and drops the project entry once empty", () => {
    const seeded = new Map([["project-a", new Set(["file:src/foo.ts"])]]);
    const result = updatePendingFileSurfaceIds(seeded, "project-a", "src/foo.ts", false);
    expect(result.has("project-a")).toBe(false);
  });

  it("keeps other pending ids for the same project when removing one", () => {
    const seeded = new Map([["project-a", new Set(["file:src/foo.ts", "file:src/bar.ts"])]]);
    const result = updatePendingFileSurfaceIds(seeded, "project-a", "src/foo.ts", false);
    expect(result.get("project-a")).toEqual(new Set(["file:src/bar.ts"]));
  });

  it("returns the same map reference when the pending state doesn't change", () => {
    const seeded = new Map([["project-a", new Set(["file:src/foo.ts"])]]);
    const result = updatePendingFileSurfaceIds(seeded, "project-a", "src/foo.ts", true);
    expect(result).toBe(seeded);
  });

  it("does not affect other projects' pending ids", () => {
    const seeded = new Map([
      ["project-a", new Set(["file:src/foo.ts"])],
      ["project-b", new Set(["file:src/other.ts"])],
    ]);
    const result = updatePendingFileSurfaceIds(seeded, "project-a", "src/foo.ts", false);
    expect(result.get("project-b")).toEqual(new Set(["file:src/other.ts"]));
    expect(result.has("project-a")).toBe(false);
  });
});
