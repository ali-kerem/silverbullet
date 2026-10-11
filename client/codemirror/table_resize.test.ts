import { describe, expect, test } from "vitest";
import {
  normalizeWidths,
  resizeAdjacentColumns,
  tableWidthKey,
} from "./table_resize.ts";

describe("table column widths", () => {
  test("changes only neighboring columns and preserves the total", () => {
    const before = [200, 300, 100];
    expect(resizeAdjacentColumns(before, 0, 60)).toEqual([260, 240, 100]);
    expect(before).toEqual([200, 300, 100]);
  });
  test("clamps both directions to the minimum usable width", () => {
    expect(resizeAdjacentColumns([200, 300], 0, 1000)).toEqual([452, 48]);
    expect(resizeAdjacentColumns([200, 300], 0, -1000)).toEqual([48, 452]);
  });
  test("still fits narrow tables", () => {
    expect(resizeAdjacentColumns([30, 30], 0, 100)).toEqual([30, 30]);
  });
  test("stores relative widths", () => {
    expect(normalizeWidths([200, 300, 100], 3)).toEqual([1 / 3, 1 / 2, 1 / 6]);
  });
  test.each([
    null,
    {},
    [],
    [1],
    [1, -1],
    [0, 1],
    [NaN, 1],
    [Infinity, 1],
    ["1", 1],
  ])("rejects corrupt or mismatched saved widths: %j", (value) => {
    expect(normalizeWidths(value, 2)).toBeNull();
  });
  test("keys separate pages and duplicate-header tables", () => {
    expect(tableWidthKey("A.md", "| A | B |", 0)).not.toEqual(
      tableWidthKey("B.md", "| A | B |", 0),
    );
    expect(tableWidthKey("A.md", "| A | B |", 0)).not.toEqual(
      tableWidthKey("A.md", "| A | B |", 1),
    );
  });
});
