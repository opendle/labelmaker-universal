import type { LabelDocument } from "@labelmaker/domain";
import { describe, expect, it } from "vitest";

import {
  plateEditorWidthMm,
  toggleFlagPlate,
  trimPlate,
  updateElementAndFlagPeer,
  updatePlateEditorWidth,
  type TextInkMeasurer,
} from "./editor-operations.js";

const measure: TextInkMeasurer = (_element, line) => ({
  advanceMm: line === "I" ? 2 : 10,
  leftMm: line === "I" ? 0 : 2,
  rightMm: line === "I" ? 2 : 11,
  heightMm: 4,
});

const document: LabelDocument = {
  schemaVersion: 1,
  id: "workspace",
  name: "Trim test",
  defaultPlateSize: { widthMm: 100, heightMm: 16 },
  plates: [
    {
      id: "plate",
      name: "Wide frame",
      size: { widthMm: 100, heightMm: 16 },
      margins: { leftMm: 2, rightMm: 3 },
      elements: [
        {
          id: "text",
          kind: "text",
          xMm: 10,
          yMm: 2,
          widthMm: 80,
          heightMm: 12,
          rotationDeg: 0,
          text: "I\nWIDE",
          fontFamily: "Georgia",
          fontSizePt: 12,
          fontWeight: 400,
          fontStyle: "italic",
          align: "center",
        },
        {
          id: "image",
          kind: "image",
          xMm: 0,
          yMm: 0,
          widthMm: 100,
          heightMm: 16,
          rotationDeg: 0,
          source: "data:image/png;base64,AA==",
          fit: "contain",
          threshold: 128,
        },
      ],
    },
  ],
};

describe("trimPlate", () => {
  it("uses multiline glyph ink and bearings instead of the text frame", () => {
    const trimmed = trimPlate(document, "plate", measure);
    const plate = trimmed.plates[0]!;
    const text = plate.elements[0]!;

    expect(plate.size.widthMm).toBe(18);
    expect(text.xMm).toBe(-31);
  });

  it("does not use non-text element frames as trim bounds", () => {
    const withoutImage: LabelDocument = {
      ...document,
      plates: document.plates.map((plate) => ({
        ...plate,
        elements: plate.elements.filter((element) => element.kind === "text"),
      })),
    };

    expect(trimPlate(document, "plate", measure).plates[0]!.size.widthMm).toBe(
      trimPlate(withoutImage, "plate", measure).plates[0]!.size.widthMm,
    );
  });

  it("adds no hidden padding when both trim margins are zero", () => {
    const zeroMargins = {
      ...document,
      plates: document.plates.map((plate) => ({
        ...plate,
        margins: { leftMm: 0, rightMm: 0 },
      })),
    };
    expect(
      trimPlate(zeroMargins, "plate", measure).plates[0]!.size.widthMm,
    ).toBe(13);
  });
});

describe("toggleFlagPlate", () => {
  it("keeps all source geometry and toggles back exactly", () => {
    const original = document.plates[0]!;
    const flag = toggleFlagPlate(original);
    const textElements = flag.elements.filter(
      (element) => element.kind === "text",
    );
    expect(textElements).toHaveLength(2);
    expect(flag.size.widthMm).toBe(202);
    expect(textElements[0]).toEqual(original.elements[0]);
    expect(textElements[1]?.xMm).toBe(112);
    expect(textElements[0]?.text).toBe("I\nWIDE");
    expect(toggleFlagPlate(flag)).toEqual(original);
  });

  it("treats the configured flag width as one half and keeps peers aligned", () => {
    const original = document.plates[0]!;
    const flag = updatePlateEditorWidth(toggleFlagPlate(original), 80);
    expect(plateEditorWidthMm(flag)).toBe(80);
    expect(flag.size.widthMm).toBe(162);

    const source = flag.elements.find((element) => element.id === "text")!;
    const moved = updateElementAndFlagPeer(flag, { ...source, xMm: 12 });
    const peer = moved.elements.find(
      (element) => element.id === "text--flag-peer",
    );
    expect(peer?.xMm).toBe(94);
    expect(toggleFlagPlate(moved).elements[0]?.xMm).toBe(12);
  });
});
