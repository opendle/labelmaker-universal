import type { LabelPlate, TextElement } from "@labelmaker/domain";
import { describe, expect, it } from "vitest";
import {
  elementBounds,
  patchSelectedElements,
  uniqueSelection,
} from "./element-selection.js";
import {
  toggleFlagPlate,
  updateElementAndFlagPeer,
} from "./editor-operations.js";

const text: TextElement = {
  id: "first",
  kind: "text",
  text: "First",
  xMm: 5,
  yMm: 2,
  widthMm: 10,
  heightMm: 4,
  rotationDeg: 0,
  fontSizePt: 12,
  fontWeight: 400,
  fontFamily: "sans-serif",
  align: "left",
};
const plate: LabelPlate = {
  id: "plate",
  name: "Plate",
  size: { widthMm: 40, heightMm: 16 },
  margins: { leftMm: 0, rightMm: 0 },
  elements: [
    text,
    { ...text, id: "second", text: "Second", xMm: 20, lineHeightPt: 15 },
  ],
};

describe("element selection", () => {
  it("measures the complete rotated frame", () => {
    expect(elementBounds({ ...text, rotationDeg: 90 })).toEqual({
      xMm: 8,
      yMm: -1,
      widthMm: 4.000000000000001,
      heightMm: 10,
    });
    const diagonal = elementBounds({ ...text, rotationDeg: 45 });
    expect(diagonal.widthMm).toBeCloseTo(14 / Math.sqrt(2));
    expect(diagonal.heightMm).toBeCloseTo(diagonal.widthMm);
  });
  it("selects each linked flag pair once and excludes the flag guide", () => {
    const flag = toggleFlagPlate(plate);
    expect(
      uniqueSelection(
        flag,
        flag.elements.map((item) => item.id),
      ),
    ).toEqual(["first", "second"]);
    expect(
      uniqueSelection(flag, ["first--flag-peer", "first", "missing"]),
    ).toEqual(["first--flag-peer"]);
  });
  it("removes optional properties without copying other element values and updates flag peers", () => {
    const flag = toggleFlagPlate(plate);
    const changes = patchSelectedElements(flag, ["first", "second"], text, [
      "lineHeightPt",
    ]);
    const next = changes.reduce(updateElementAndFlagPeer, flag);
    expect(next.elements.find((item) => item.id === "second")).toMatchObject({
      text: "Second",
      xMm: 20,
    });
    expect(
      next.elements.find((item) => item.id === "second"),
    ).not.toHaveProperty("lineHeightPt");
    expect(
      next.elements.find((item) => item.id === "second--flag-peer"),
    ).not.toHaveProperty("lineHeightPt");
  });
});
