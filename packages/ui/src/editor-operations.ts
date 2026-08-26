import type {
  ImageElement,
  LabelDocument,
  LabelElement,
  LabelPlate,
  TextElement,
} from "@labelmaker/domain";

import { replacePlate } from "./app-state.js";
import { DEFAULT_TYPEFACE } from "./typefaces.js";

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
        fontFamily: DEFAULT_TYPEFACE,
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
    fontFamily: DEFAULT_TYPEFACE,
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

const FLAG_GAP_MM = 2;
const FLAG_PEER_SUFFIX = "--flag-peer";

const flagGuideId = (plate: LabelPlate) => `flag-guide-${plate.id}`;

const isFlagPeer = (element: LabelElement) =>
  element.id.endsWith(FLAG_PEER_SUFFIX);

export function isFlagPlate(plate: LabelPlate): boolean {
  return plate.elements.some((element) => element.id === flagGuideId(plate));
}

export function plateEditorWidthMm(plate: LabelPlate): number {
  return isFlagPlate(plate)
    ? Math.max(1, (plate.size.widthMm - FLAG_GAP_MM) / 2)
    : plate.size.widthMm;
}

function shiftedElement(
  element: LabelElement,
  id: string,
  offsetX: number,
): LabelElement {
  return { ...element, id, xMm: element.xMm + offsetX };
}

function flagGuide(plate: LabelPlate, halfWidthMm: number): LabelElement {
  return {
    id: flagGuideId(plate),
    kind: "rectangle",
    xMm: halfWidthMm + FLAG_GAP_MM / 2 - 0.1,
    yMm: 1,
    widthMm: 0.2,
    heightMm: Math.max(1, plate.size.heightMm - 2),
    rotationDeg: 0,
    strokeWidthMm: 0,
    filled: true,
    cornerRadiusMm: 0,
  };
}

function buildFlagElements(
  plate: LabelPlate,
  sourceElements: readonly LabelElement[],
  halfWidthMm: number,
): readonly LabelElement[] {
  const offsetX = halfWidthMm + FLAG_GAP_MM;
  return [
    ...sourceElements,
    ...sourceElements.map((element) =>
      shiftedElement(element, `${element.id}${FLAG_PEER_SUFFIX}`, offsetX),
    ),
    flagGuide(plate, halfWidthMm),
  ];
}

export function updatePlateEditorWidth(
  plate: LabelPlate,
  widthMm: number,
): LabelPlate {
  const nextWidthMm = Math.max(1, widthMm);
  if (!isFlagPlate(plate)) {
    return { ...plate, size: { ...plate.size, widthMm: nextWidthMm } };
  }
  const sourceElements = plate.elements.filter(
    (element) => !isFlagPeer(element) && element.id !== flagGuideId(plate),
  );
  return {
    ...plate,
    size: {
      ...plate.size,
      widthMm: nextWidthMm * 2 + FLAG_GAP_MM,
    },
    elements: buildFlagElements(plate, sourceElements, nextWidthMm),
  };
}

/** Convert the active label to a reversible, two-sided flag. */
export function toggleFlagPlate(plate: LabelPlate): LabelPlate {
  if (isFlagPlate(plate)) {
    const halfWidthMm = plateEditorWidthMm(plate);
    return {
      ...plate,
      name: plate.name.replace(/^Flag\s+/, ""),
      size: { ...plate.size, widthMm: halfWidthMm },
      elements: plate.elements.filter(
        (element) => !isFlagPeer(element) && element.id !== flagGuideId(plate),
      ),
    };
  }
  const halfWidthMm = plate.size.widthMm;
  return {
    ...plate,
    name: `Flag ${plate.name}`,
    size: {
      ...plate.size,
      widthMm: halfWidthMm * 2 + FLAG_GAP_MM,
    },
    elements: buildFlagElements(plate, plate.elements, halfWidthMm),
  };
}

export function updateElementAndFlagPeer(
  plate: LabelPlate,
  updated: LabelElement,
): LabelPlate {
  if (!isFlagPlate(plate)) {
    return {
      ...plate,
      elements: plate.elements.map((element) =>
        element.id === updated.id ? updated : element,
      ),
    };
  }
  const halfWidthMm = plateEditorWidthMm(plate);
  const offsetX = halfWidthMm + FLAG_GAP_MM;
  const updatedIsPeer = isFlagPeer(updated);
  const sourceId = updatedIsPeer
    ? updated.id.slice(0, -FLAG_PEER_SUFFIX.length)
    : updated.id;
  const source = shiftedElement(
    updated,
    sourceId,
    updatedIsPeer ? -offsetX : 0,
  );
  const peer = shiftedElement(
    source,
    `${sourceId}${FLAG_PEER_SUFFIX}`,
    offsetX,
  );
  return {
    ...plate,
    elements: plate.elements.map((element) => {
      if (element.id === source.id) return source;
      if (element.id === peer.id) return peer;
      return element;
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
    if (isFlagPlate(plate)) {
      const normalPlate = toggleFlagPlate(plate);
      const normalWorkspace = replacePlate(
        workspace,
        plateId,
        () => normalPlate,
      );
      const trimmedNormal = trimPlate(
        normalWorkspace,
        plateId,
        measure,
      ).plates.find((item) => item.id === plateId);
      return trimmedNormal ? toggleFlagPlate(trimmedNormal) : plate;
    }
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
    const leftMm = plate.margins.leftMm;
    const rightMm = plate.margins.rightMm;
    const measuredWidthMm = maxX - minX + leftMm + rightMm;
    const widthMm = Math.ceil(Math.max(1, measuredWidthMm));
    const roundingPaddingMm = (widthMm - measuredWidthMm) / 2;
    const offsetX = leftMm + roundingPaddingMm - minX;
    return {
      ...plate,
      size: {
        ...plate.size,
        widthMm,
      },
      elements: plate.elements.map((element) => ({
        ...element,
        xMm: element.xMm + offsetX,
      })),
    };
  });
}
