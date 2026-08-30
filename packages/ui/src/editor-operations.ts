import type {
  ImageElement,
  LabelDocument,
  LabelElement,
  LabelPlate,
  ShapeElement,
  TextElement,
} from "@labelmaker/domain";

import { replacePlate } from "./app-state.js";
import {
  renderPlateBlackBounds,
  type BlackPixelBounds,
} from "./browser-raster.js";
import type { PrintableMargins } from "./label-layout.js";
import { NEW_TEXT_WIDTH_MM, newElementFrame } from "./new-element-frame.js";
import { DEFAULT_TYPEFACE } from "./typefaces.js";

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const MIN_ZOOM = 60;
export const MAX_ZOOM = 300;

const makeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function createPlate(
  workspace: LabelDocument,
  printableMargins?: PrintableMargins,
): LabelPlate {
  const number = workspace.plates.length + 1;
  const size = workspace.defaultPlateSize;
  const plate: LabelPlate = {
    id: makeId("plate"),
    name: `Label ${number}`,
    size,
    margins: { leftMm: 0, rightMm: 0 },
    elements: [],
  };
  return {
    ...plate,
    elements: [
      {
        ...createText(plate, printableMargins),
        text: "NEW LABEL",
        fontSizePt: 16,
        fontWeight: 600,
      },
    ],
  };
}

export function createText(
  plate: LabelPlate,
  printableMargins?: PrintableMargins,
): TextElement {
  return {
    id: makeId("element"),
    kind: "text",
    ...newElementFrame(plate, NEW_TEXT_WIDTH_MM, printableMargins),
    rotationDeg: 0,
    text: "Text",
    fontFamily: DEFAULT_TYPEFACE,
    fontSizePt: 12,
    fontWeight: 500,
    align: "center",
  };
}

export function createImage(
  plate: LabelPlate,
  source: string,
  printableMargins?: PrintableMargins,
): ImageElement {
  const printableFrame = newElementFrame(plate, 1, printableMargins);
  const frame = newElementFrame(
    plate,
    printableFrame.heightMm,
    printableMargins,
  );
  return {
    id: makeId("element"),
    kind: "image",
    ...frame,
    rotationDeg: 0,
    source,
    fit: "contain",
    brightness: 128,
    contrast: 128,
    transparentBackground: true,
  };
}

export function createShape(
  plate: LabelPlate,
  shapeType: NonNullable<ShapeElement["shapeType"]>,
): ShapeElement {
  const circleDiameterMm = Math.max(
    1,
    Math.round(
      Math.min(10, plate.size.widthMm * 0.6, plate.size.heightMm * 0.6),
    ),
  );
  const widthMm =
    shapeType === "circle"
      ? circleDiameterMm
      : Math.max(1, Math.round(Math.min(18, plate.size.widthMm * 0.6)));
  const heightMm =
    shapeType === "circle"
      ? circleDiameterMm
      : Math.max(
          1,
          Math.round(
            Math.min(shapeType === "line" ? 2 : 8, plate.size.heightMm * 0.6),
          ),
        );
  return {
    id: makeId("element"),
    kind: "rectangle",
    shapeType,
    xMm: Math.max(0, Math.round((plate.size.widthMm - widthMm) / 2)),
    yMm: Math.max(0, Math.round((plate.size.heightMm - heightMm) / 2)),
    widthMm,
    heightMm,
    rotationDeg: 0,
    strokeWidthMm: 0.4,
    filled: false,
    cornerRadiusMm: 0,
  };
}

const FLAG_GAP_MM = 2;
const FLAG_PEER_SUFFIX = "--flag-peer";

const flagGuideId = (plate: LabelPlate) => `flag-guide-${plate.id}`;

const isFlagPeer = (element: LabelElement) =>
  element.id.endsWith(FLAG_PEER_SUFFIX);

export function isFlagGuideElement(
  plate: LabelPlate,
  element: LabelElement,
): boolean {
  return element.id === flagGuideId(plate);
}

function flagSourceElements(plate: LabelPlate): readonly LabelElement[] {
  return plate.elements.filter(
    (element) => !isFlagPeer(element) && !isFlagGuideElement(plate, element),
  );
}

export function editableElementCount(plate: LabelPlate): number {
  return isFlagPlate(plate)
    ? flagSourceElements(plate).length
    : plate.elements.length;
}

export function isFlagPlate(plate: LabelPlate): boolean {
  return plate.elements.some((element) => element.id === flagGuideId(plate));
}

export function plateEditorWidthMm(plate: LabelPlate): number {
  return isFlagPlate(plate)
    ? Math.max(1, (plate.size.widthMm - FLAG_GAP_MM) / 2)
    : plate.size.widthMm;
}

function mirroredFlagElement(
  element: LabelElement,
  id: string,
  outputWidthMm: number,
): LabelElement {
  return {
    ...element,
    id,
    xMm: outputWidthMm - element.xMm - element.widthMm,
  };
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
  const outputWidthMm = halfWidthMm * 2 + FLAG_GAP_MM;
  return [
    ...sourceElements,
    ...sourceElements.map((element) =>
      mirroredFlagElement(
        element,
        `${element.id}${FLAG_PEER_SUFFIX}`,
        outputWidthMm,
      ),
    ),
    flagGuide(plate, halfWidthMm),
  ];
}

export function appendElementAndFlagPeer(
  plate: LabelPlate,
  element: LabelElement,
): LabelPlate {
  if (!isFlagPlate(plate)) {
    return { ...plate, elements: [...plate.elements, element] };
  }
  const sourceElements = [...flagSourceElements(plate), element];
  return {
    ...plate,
    elements: buildFlagElements(
      plate,
      sourceElements,
      plateEditorWidthMm(plate),
    ),
  };
}

export function deleteElementAndFlagPeer(
  plate: LabelPlate,
  elementId: string,
): LabelPlate {
  if (!isFlagPlate(plate)) {
    return {
      ...plate,
      elements: plate.elements.filter((element) => element.id !== elementId),
    };
  }
  const sourceId = elementId.endsWith(FLAG_PEER_SUFFIX)
    ? elementId.slice(0, -FLAG_PEER_SUFFIX.length)
    : elementId;
  return {
    ...plate,
    elements: buildFlagElements(
      plate,
      flagSourceElements(plate).filter((element) => element.id !== sourceId),
      plateEditorWidthMm(plate),
    ),
  };
}

export function moveElementLayer(
  plate: LabelPlate,
  elementId: string,
  direction: "back" | "front",
): LabelPlate {
  const sourceId = elementId.endsWith(FLAG_PEER_SUFFIX)
    ? elementId.slice(0, -FLAG_PEER_SUFFIX.length)
    : elementId;
  const elements = isFlagPlate(plate)
    ? [...flagSourceElements(plate)]
    : [...plate.elements];
  const index = elements.findIndex((element) => element.id === sourceId);
  if (index < 0) return plate;
  const [selected] = elements.splice(index, 1);
  if (!selected) return plate;
  if (direction === "back") elements.unshift(selected);
  else elements.push(selected);
  return isFlagPlate(plate)
    ? {
        ...plate,
        elements: buildFlagElements(plate, elements, plateEditorWidthMm(plate)),
      }
    : { ...plate, elements };
}

export function updatePlateEditorWidth(
  plate: LabelPlate,
  widthMm: number,
): LabelPlate {
  const nextWidthMm = Math.max(1, widthMm);
  if (!isFlagPlate(plate)) {
    return { ...plate, size: { ...plate.size, widthMm: nextWidthMm } };
  }
  const sourceElements = flagSourceElements(plate);
  return {
    ...plate,
    size: {
      ...plate.size,
      widthMm: nextWidthMm * 2 + FLAG_GAP_MM,
    },
    elements: buildFlagElements(plate, sourceElements, nextWidthMm),
  };
}

/** Resize the label equally from its top and bottom edges. */
export function updatePlateEditorHeight(
  plate: LabelPlate,
  heightMm: number,
): LabelPlate {
  const nextHeightMm = Math.max(1, heightMm);
  const offsetMm = (nextHeightMm - plate.size.heightMm) / 2;
  const resizedPlate = {
    ...plate,
    size: { ...plate.size, heightMm: nextHeightMm },
  };
  const movedElements = (
    isFlagPlate(plate) ? flagSourceElements(plate) : plate.elements
  ).map((element) => ({ ...element, yMm: element.yMm + offsetMm }));

  return isFlagPlate(plate)
    ? {
        ...resizedPlate,
        elements: buildFlagElements(
          resizedPlate,
          movedElements,
          plateEditorWidthMm(plate),
        ),
      }
    : { ...resizedPlate, elements: movedElements };
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
  const outputWidthMm = halfWidthMm * 2 + FLAG_GAP_MM;
  const updatedIsPeer = isFlagPeer(updated);
  const sourceId = updatedIsPeer
    ? updated.id.slice(0, -FLAG_PEER_SUFFIX.length)
    : updated.id;
  const source = updatedIsPeer
    ? mirroredFlagElement(updated, sourceId, outputWidthMm)
    : { ...updated, id: sourceId };
  const peer = mirroredFlagElement(
    source,
    `${sourceId}${FLAG_PEER_SUFFIX}`,
    outputWidthMm,
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

export type PlateBlackBoundsProvider = (
  plate: LabelPlate,
) => Promise<BlackPixelBounds | null>;

function trimPlateToBlackBounds(
  workspace: LabelDocument,
  plateId: string,
  bounds: BlackPixelBounds | null,
): LabelDocument {
  return replacePlate(workspace, plateId, (plate) => {
    if (!bounds) return plate;
    const leftMm = plate.margins.leftMm;
    const rightMm = plate.margins.rightMm;
    const measuredWidthMm = bounds.maxX - bounds.minX + leftMm + rightMm;
    const widthMm = Math.ceil(Math.max(1, measuredWidthMm));
    const roundingPaddingMm = (widthMm - measuredWidthMm) / 2;
    const offsetX = leftMm + roundingPaddingMm - bounds.minX;
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

export async function trimPlate(
  workspace: LabelDocument,
  plateId: string,
  findBounds: PlateBlackBoundsProvider = renderPlateBlackBounds,
): Promise<LabelDocument> {
  const plate = workspace.plates.find((item) => item.id === plateId);
  if (!plate) return workspace;
  const flag = isFlagPlate(plate);
  const sourcePlate = flag ? toggleFlagPlate(plate) : plate;
  const bounds = await findBounds(sourcePlate);
  const sourceWorkspace = flag
    ? replacePlate(workspace, plateId, () => sourcePlate)
    : workspace;
  const trimmed = trimPlateToBlackBounds(sourceWorkspace, plateId, bounds);
  return flag
    ? replacePlate(trimmed, plateId, (item) => toggleFlagPlate(item))
    : trimmed;
}
