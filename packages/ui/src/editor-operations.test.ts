import type { LabelDocument } from "@labelmaker/domain";
import { describe, expect, it } from "vitest";

import {
  toggleFlagPlate,
  trimPlate,
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
});

describe("toggleFlagPlate", () => {
  it("keeps a wide text frame inside both flag sides and toggles back", () => {
    const original = document.plates[0]!;
    const flag = toggleFlagPlate({
      ...original,
      name: "Wide frame",
      elements: [original.elements[0]!],
    });
    const textElements = flag.elements.filter(
      (element) => element.kind === "text",
    );
    expect(textElements).toHaveLength(2);
    expect(textElements.every((element) => element.xMm >= 0)).toBe(true);
    expect(textElements.every((element) => element.widthMm > 0)).toBe(true);
    expect(textElements[0]?.text).toBe("I\nWIDE");
    expect(toggleFlagPlate(flag).name).toBe("Wide frame");
    expect(
      toggleFlagPlate(flag).elements.filter(
        (element) => element.kind === "text",
      ),
    ).toHaveLength(1);
  });
});
