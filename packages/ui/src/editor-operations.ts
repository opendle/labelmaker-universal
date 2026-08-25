import type {
  ImageElement,
  LabelDocument,
  LabelElement,
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

/** Convert the active plate to a two-sided flag without replacing its text. */
export function toggleFlagPlate(plate: LabelPlate): LabelPlate {
  const isFlag = plate.name.startsWith("Flag ");
  if (isFlag) {
    const textIds = new Set<string>();
    let textCount = 0;
    for (const element of plate.elements) {
      if (element.kind === "text") {
        if (textCount > 0) textIds.add(element.id);
        textCount += 1;
      }
    }
    const remainingText = plate.elements.find(
      (element) => element.kind === "text" && !textIds.has(element.id),
    );
    const elements: LabelElement[] = [];
    for (const element of plate.elements) {
      if (
        textIds.has(element.id) ||
        (element.kind === "rectangle" && element.id.startsWith("flag-guide"))
      ) {
        continue;
      }
      elements.push(
        element.id === remainingText?.id && element.kind === "text"
          ? {
              ...element,
              xMm: Math.min(4, Math.max(0, plate.size.widthMm - 1)),
              widthMm: Math.max(1, plate.size.widthMm - 8),
            }
          : element,
      );
    }
    return {
      ...plate,
      name: plate.name.replace(/^Flag\s+/, ""),
      elements,
    };
  }
  const source = plate.elements.find((element) => element.kind === "text");
  if (!source || source.kind !== "text") return plate;
  const gapMm = 2;
  const halfWidth = Math.max(1, (plate.size.widthMm - gapMm) / 2);
  const sourceWidth = Math.min(
    Math.max(1, source.widthMm),
    Math.max(1, halfWidth - 1),
  );
  const sourceX = Math.max(0, Math.min(source.xMm, halfWidth - sourceWidth));
  const sourceText = {
    ...source,
    xMm: sourceX,
    widthMm: sourceWidth,
  };
  const peer = {
    ...sourceText,
    id: `${source.id}-flag-peer`,
    xMm: halfWidth + gapMm,
  };
  return {
    ...plate,
    name: `Flag ${plate.name}`,
    elements: [
      ...plate.elements.filter((element) => element.id !== source.id),
      sourceText,
      peer,
      {
        id: `flag-guide-${plate.id}`,
        kind: "rectangle",
        xMm: halfWidth + gapMm / 2,
        yMm: 1,
        widthMm: 0.2,
        heightMm: Math.max(1, plate.size.heightMm - 2),
        rotationDeg: 0,
        strokeWidthMm: 0,
        filled: true,
        cornerRadiusMm: 0,
      },
    ],
  };
}

export function updateElementAndFlagPeer(
  plate: LabelPlate,
  updated: LabelElement,
): LabelPlate {
  let textCount = 0;
  for (const element of plate.elements) {
    if (element.kind === "text") textCount += 1;
  }
  const isFlagText =
    plate.name.startsWith("Flag ") &&
    updated.kind === "text" &&
    textCount === 2;
  return {
    ...plate,
    elements: plate.elements.map((element) => {
      if (element.id === updated.id) return updated;
      if (!isFlagText || element.kind !== "text") return element;
      return {
        ...element,
        yMm: updated.yMm,
        widthMm: updated.widthMm,
        heightMm: updated.heightMm,
        rotationDeg: updated.rotationDeg,
        text: updated.text,
        fontFamily: updated.fontFamily,
        fontSizePt: updated.fontSizePt,
        fontWeight: updated.fontWeight,
        fontStyle: updated.fontStyle ?? "normal",
        align: updated.align,
      };
    }),
  };
}

interface HorizontalBounds {
  readonly minX: number;
  readonly maxX: number;
}

export interface TextInkMetrics {
  readonly advanceMm: number;
  readonly leftMm: number;
  readonly rightMm: number;
  readonly heightMm: number;
}

export type TextInkMeasurer = (
  element: TextElement,
  line: string,
) => TextInkMetrics;

const measureTextLine: TextInkMeasurer = (element, line) => {
  const fontSizePx = (element.fontSizePt * 96) / 72;
  const canvas =
    typeof globalThis.CanvasRenderingContext2D === "undefined"
      ? undefined
      : globalThis.document?.createElement("canvas");
  const context = canvas?.getContext("2d");
  if (context) {
    context.font = `${element.fontStyle ?? "normal"} ${element.fontWeight} ${fontSizePx}px ${element.fontFamily}`;
    const metrics = context.measureText(line || " ");
    return {
      advanceMm: (metrics.width * 25.4) / 96,
      leftMm: (metrics.actualBoundingBoxLeft * 25.4) / 96,
      rightMm: ((metrics.actualBoundingBoxRight || metrics.width) * 25.4) / 96,
      heightMm:
        ((metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent ||
          fontSizePx) *
          25.4) /
        96,
    };
  }
  return {
    advanceMm: Math.max(0.2, line.length * element.fontSizePt * 0.19),
    leftMm: 0,
    rightMm: Math.max(0.2, line.length * element.fontSizePt * 0.19),
    heightMm: (element.fontSizePt * 25.4) / 72,
  };
};

function textInkBounds(
  element: TextElement,
  measure: TextInkMeasurer,
): HorizontalBounds {
  const lines = element.text.split("\n");
  const measured = lines.map((line) => measure(element, line));
  const lineHeightMm = (element.fontSizePt * 25.4) / 72;
  const inkHeightMm = Math.max(
    lineHeightMm,
    lineHeightMm * (lines.length - 1) +
      Math.max(...measured.map((line) => line.heightMm)),
  );
  const inkTop = element.yMm + (element.heightMm - inkHeightMm) / 2;
  const centerX = element.xMm + element.widthMm / 2;
  const centerY = element.yMm + element.heightMm / 2;
  const radians = (element.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotatedX: number[] = [];

  measured.forEach((line, index) => {
    const layoutStart =
      element.align === "left"
        ? element.xMm
        : element.align === "right"
          ? element.xMm + element.widthMm - line.advanceMm
          : element.xMm + (element.widthMm - line.advanceMm) / 2;
    const inkLeft = layoutStart - line.leftMm;
    const inkRight = layoutStart + line.rightMm;
    const top = inkTop + index * lineHeightMm;
    const corners = [
      [inkLeft, top],
      [inkRight, top],
      [inkLeft, top + line.heightMm],
      [inkRight, top + line.heightMm],
    ];
    corners.forEach(([x = 0, y = 0]) => {
      rotatedX.push(centerX + (x - centerX) * cos - (y - centerY) * sin);
    });
  });
  return { minX: Math.min(...rotatedX), maxX: Math.max(...rotatedX) };
}

function elementInkBounds(
  element: LabelElement,
  measure: TextInkMeasurer,
): HorizontalBounds | null {
  if (element.kind === "text") {
    if (!element.text.trim()) return null;
    return textInkBounds(element, measure);
  }
  return null;
}

export function trimPlate(
  workspace: LabelDocument,
  plateId: string,
  measure: TextInkMeasurer = measureTextLine,
): LabelDocument {
  return replacePlate(workspace, plateId, (plate) => {
    if (plate.elements.length === 0) return plate;
    const bounds: HorizontalBounds[] = [];
    for (const element of plate.elements) {
      const bound = elementInkBounds(element, measure);
      if (bound) bounds.push(bound);
    }
    if (bounds.length === 0) return plate;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (const bound of bounds) {
      minX = Math.min(minX, bound.minX);
      maxX = Math.max(maxX, bound.maxX);
    }
    // Keep a small amount of white around the measured black ink. Explicit
    // user margins still take precedence when they are larger.
    const inkMarginMm = 0.25;
    const leftMm = Math.max(inkMarginMm, plate.margins.leftMm);
    const rightMm = Math.max(inkMarginMm, plate.margins.rightMm);
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
