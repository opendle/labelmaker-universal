import type {
  ImageElement,
  LabelDocument,
  LabelPlate,
  TextElement,
} from "@labelmaker/domain";

import { replacePlate } from "./app-state.js";

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const makeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function createPlate(workspace: LabelDocument): LabelPlate {
  const number = workspace.plates.length + 1;
  const textId = makeId("element");
  const size = workspace.defaultPlateSize;
  return {
    id: makeId("plate"),
    name: `Plate ${number}`,
    size,
    margins: { leftMm: 0, rightMm: 0 },
    elements: [
      {
        id: textId,
        kind: "text",
        xMm: 4,
        yMm: 4,
        widthMm: size.widthMm - 8,
        heightMm: Math.max(5, size.heightMm - 8),
        rotationDeg: 0,
        text: "NEW LABEL",
        fontFamily: "Inter",
        fontSizePt: 16,
        fontWeight: 600,
        align: "center",
      },
    ],
  };
}

export function createText(plate: LabelPlate): TextElement {
  return {
    id: makeId("element"),
    kind: "text",
    xMm: plate.size.widthMm * 0.2,
    yMm: plate.size.heightMm * 0.3,
    widthMm: plate.size.widthMm * 0.6,
    heightMm: plate.size.heightMm * 0.4,
    rotationDeg: 0,
    text: "Text",
    fontFamily: "Inter",
    fontSizePt: 12,
    fontWeight: 500,
    align: "center",
  };
}

export function createImage(plate: LabelPlate, source: string): ImageElement {
  const widthMm = Math.min(24, plate.size.widthMm * 0.45);
  const heightMm = Math.min(12, plate.size.heightMm * 0.7);
  return {
    id: makeId("element"),
    kind: "image",
    xMm: Math.max(0, (plate.size.widthMm - widthMm) / 2),
    yMm: Math.max(0, (plate.size.heightMm - heightMm) / 2),
    widthMm,
    heightMm,
    rotationDeg: 0,
    source,
    fit: "contain",
    threshold: 128,
  };
}

export function createSpecialPlate(
  workspace: LabelDocument,
  kind: "flag" | "wrap",
): LabelPlate {
  const number = workspace.plates.length + 1;
  const heightMm = workspace.defaultPlateSize.heightMm;
  if (kind === "wrap") {
    return {
      id: makeId("plate"),
      name: `Cable wrap ${number}`,
      size: { widthMm: 62, heightMm },
      margins: { leftMm: 0, rightMm: 0 },
      elements: [
        {
          id: makeId("element"),
          kind: "text",
          xMm: 34,
          yMm: 3,
          widthMm: 26,
          heightMm: Math.max(6, heightMm - 6),
          rotationDeg: 0,
          text: "CABLE",
          fontFamily: "Inter",
          fontSizePt: 13,
          fontWeight: 700,
          align: "center",
        },
      ],
    };
  }
  return {
    id: makeId("plate"),
    name: `Flag ${number}`,
    size: { widthMm: 64, heightMm },
    margins: { leftMm: 0, rightMm: 0 },
    elements: [
      ...[2, 35].map(
        (xMm): TextElement => ({
          id: makeId("element"),
          kind: "text",
          xMm,
          yMm: 3,
          widthMm: 27,
          heightMm: Math.max(6, heightMm - 6),
          rotationDeg: 0,
          text: "CABLE",
          fontFamily: "Inter",
          fontSizePt: 13,
          fontWeight: 700,
          align: "center",
        }),
      ),
      {
        id: makeId("guide"),
        kind: "rectangle",
        xMm: 31.9,
        yMm: 1,
        widthMm: 0.2,
        heightMm: Math.max(1, heightMm - 2),
        rotationDeg: 0,
        strokeWidthMm: 0,
        filled: true,
        cornerRadiusMm: 0,
      },
    ],
  };
}

export function trimPlate(
  workspace: LabelDocument,
  plateId: string,
): LabelDocument {
  return replacePlate(workspace, plateId, (plate) => {
    if (plate.elements.length === 0) return plate;
    const bounds = plate.elements.map((element) => {
      const radians = (element.rotationDeg * Math.PI) / 180;
      const rotatedWidth =
        Math.abs(element.widthMm * Math.cos(radians)) +
        Math.abs(element.heightMm * Math.sin(radians));
      const centerX = element.xMm + element.widthMm / 2;
      return {
        minX: centerX - rotatedWidth / 2,
        maxX: centerX + rotatedWidth / 2,
      };
    });
    const minX = Math.min(...bounds.map((bound) => bound.minX));
    const maxX = Math.max(...bounds.map((bound) => bound.maxX));
    const leftMm = Math.max(0, plate.margins.leftMm);
    const rightMm = Math.max(0, plate.margins.rightMm);
    const offsetX = leftMm - minX;
    return {
      ...plate,
      size: {
        ...plate.size,
        widthMm: Math.max(1, maxX - minX + leftMm + rightMm),
      },
      elements: plate.elements.map((element) => ({
        ...element,
        xMm: element.xMm + offsetX,
      })),
    };
  });
}
