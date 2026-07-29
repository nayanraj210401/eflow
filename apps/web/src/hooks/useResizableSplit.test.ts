import { describe, expect, it } from "vite-plus/test";

import { clampSplitSize, resolveKeyDelta } from "./useResizableSplit";

describe("clampSplitSize", () => {
  it("clamps values within the min/max bounds", () => {
    expect(clampSplitSize(50, 100, 400)).toBe(100);
    expect(clampSplitSize(500, 100, 400)).toBe(400);
    expect(clampSplitSize(250, 100, 400)).toBe(250);
  });

  it("falls back to minSize for non-finite input", () => {
    expect(clampSplitSize(Number.NaN, 100, 400)).toBe(100);
    expect(clampSplitSize(Number.POSITIVE_INFINITY, 100, 400)).toBe(100);
  });
});

describe("resolveKeyDelta", () => {
  it("grows a right-anchored width panel (edge: right) when pressing ArrowRight", () => {
    expect(resolveKeyDelta("ArrowRight", "width", "right", 8)).toBe(8);
    expect(resolveKeyDelta("ArrowLeft", "width", "right", 8)).toBe(-8);
  });

  it("grows a left-anchored width panel (edge: left) when pressing ArrowLeft", () => {
    expect(resolveKeyDelta("ArrowLeft", "width", "left", 8)).toBe(8);
    expect(resolveKeyDelta("ArrowRight", "width", "left", 8)).toBe(-8);
  });

  it("grows a bottom-anchored height panel (edge: bottom) when pressing ArrowDown", () => {
    expect(resolveKeyDelta("ArrowDown", "height", "bottom", 8)).toBe(8);
    expect(resolveKeyDelta("ArrowUp", "height", "bottom", 8)).toBe(-8);
  });

  it("grows a top-anchored height panel (edge: top) when pressing ArrowUp", () => {
    expect(resolveKeyDelta("ArrowUp", "height", "top", 8)).toBe(8);
    expect(resolveKeyDelta("ArrowDown", "height", "top", 8)).toBe(-8);
  });

  it("returns null for keys not relevant to the axis", () => {
    expect(resolveKeyDelta("ArrowUp", "width", "right", 8)).toBeNull();
    expect(resolveKeyDelta("ArrowLeft", "height", "bottom", 8)).toBeNull();
    expect(resolveKeyDelta("Enter", "width", "right", 8)).toBeNull();
  });
});
