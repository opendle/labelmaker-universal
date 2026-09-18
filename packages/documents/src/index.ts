import {
  DEFAULT_TEXT_TYPEFACE,
  type CodeElement,
  type ImageEditorSource,
  type ImageElement,
  type LabelDocument,
  type LabelElement,
  type LabelPlate,
  type PhysicalSize,
  type QrData,
  type QrOptions,
  type ShapeElement,
  type TextElement,
} from "@labelmaker/domain";
import { parse, stringify } from "yaml";

export const LABELMAKER_FILE_EXTENSION = ".lbl";
export const MAX_WORKSPACE_BYTES = 25 * 1024 * 1024;

const MAX_PLATES = 1_000;
const MAX_ELEMENTS_PER_PLATE = 10_000;
const MAX_SHORT_TEXT_LENGTH = 1_000;
const MAX_CONTENT_LENGTH = 20 * 1024 * 1024;
const MAX_MEASUREMENT_MM = 10_000;
const MAX_IMAGE_DIMENSION_PIXELS = 100_000;

export type DocumentErrorCode =
  | "INVALID_YAML"
  | "INVALID_GZIP"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_DOCUMENT"
  | "DOCUMENT_TOO_LARGE";

export class LabelDocumentError extends Error {
  readonly code: DocumentErrorCode;

  constructor(code: DocumentErrorCode, message: string) {
    super(message);
    this.name = "LabelDocumentError";
    this.code = code;
  }
}

function fail(message: string): never {
  throw new LabelDocumentError("INVALID_DOCUMENT", message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(
  value: unknown,
  path: string,
  maximumLength = MAX_SHORT_TEXT_LENGTH,
  allowEmpty = true,
): string {
  if (typeof value !== "string") fail(`${path} must be a string`);
  if (!allowEmpty && value.trim().length === 0)
    fail(`${path} must not be empty`);
  if (value.length > maximumLength) {
    fail(`${path} must be at most ${maximumLength} characters`);
  }
  return value;
}

function numberValue(
  value: unknown,
  path: string,
  minimum: number,
  maximum = MAX_MEASUREMENT_MM,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${path} must be a finite number`);
  }
  if (value < minimum || value > maximum) {
    fail(`${path} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function integerValue(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  const result = numberValue(value, path, minimum, maximum);
  if (!Number.isInteger(result)) fail(`${path} must be an integer`);
  return result;
}

function arrayValue(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  if (value.length > maximum) fail(`${path} has too many items`);
  return value;
}

function sizeValue(value: unknown, path: string): PhysicalSize {
  const item = record(value, path);
  return {
    widthMm: numberValue(item.widthMm, `${path}.widthMm`, 0.1),
    heightMm: numberValue(item.heightMm, `${path}.heightMm`, 0.1),
  };
}

function baseElement(value: Record<string, unknown>, path: string) {
  return {
    id: stringValue(value.id, `${path}.id`, MAX_SHORT_TEXT_LENGTH, false),
    xMm: numberValue(value.xMm, `${path}.xMm`, -MAX_MEASUREMENT_MM),
    yMm: numberValue(value.yMm, `${path}.yMm`, -MAX_MEASUREMENT_MM),
    widthMm: numberValue(value.widthMm, `${path}.widthMm`, 0.1),
    heightMm: numberValue(value.heightMm, `${path}.heightMm`, 0.1),
    rotationDeg: numberValue(
      value.rotationDeg,
      `${path}.rotationDeg`,
      -360_000,
      360_000,
    ),
  };
}

function textElement(
  value: Record<string, unknown>,
  path: string,
): TextElement {
  const align = stringValue(value.align, `${path}.align`);
  if (align !== "left" && align !== "center" && align !== "right") {
    fail(`${path}.align must be left, center, or right`);
  }
  const fontStyle = value.fontStyle;
  if (
    fontStyle !== undefined &&
    fontStyle !== "normal" &&
    fontStyle !== "italic"
  ) {
    fail(`${path}.fontStyle must be normal or italic`);
  }
  const verticalAlign = value.verticalAlign;
  if (
    verticalAlign !== undefined &&
    verticalAlign !== "top" &&
    verticalAlign !== "middle" &&
    verticalAlign !== "bottom"
  ) {
    fail(`${path}.verticalAlign must be top, middle, or bottom`);
  }
  const lineHeightPt = value.lineHeightPt;
  return {
    ...baseElement(value, path),
    kind: "text",
    text: stringValue(value.text, `${path}.text`, MAX_CONTENT_LENGTH),
    fontFamily: stringValue(
      value.fontFamily,
      `${path}.fontFamily`,
      MAX_SHORT_TEXT_LENGTH,
      false,
    ),
    fontSizePt: numberValue(value.fontSizePt, `${path}.fontSizePt`, 0.1, 1_000),
    fontWeight: integerValue(value.fontWeight, `${path}.fontWeight`, 1, 1_000),
    ...(fontStyle === undefined ? {} : { fontStyle }),
    ...(lineHeightPt === undefined
      ? {}
      : {
          lineHeightPt: numberValue(
            lineHeightPt,
            `${path}.lineHeightPt`,
            0.1,
            1_000,
          ),
        }),
    align,
    ...(verticalAlign === undefined ? {} : { verticalAlign }),
  };
}

function imageElement(
  value: Record<string, unknown>,
  path: string,
): ImageElement {
  const fit = stringValue(value.fit, `${path}.fit`);
  if (fit !== "contain" && fit !== "cover" && fit !== "stretch") {
    fail(`${path}.fit must be contain, cover, or stretch`);
  }
  const transparentBackground = value.transparentBackground;
  if (
    transparentBackground !== undefined &&
    typeof transparentBackground !== "boolean"
  ) {
    fail(`${path}.transparentBackground must be a boolean`);
  }
  const editorSource = value.editorSource;
  const legacyThreshold =
    value.brightness === undefined
      ? integerValue(value.threshold, `${path}.threshold`, 0, 255)
      : undefined;
  return {
    ...baseElement(value, path),
    kind: "image",
    source: stringValue(
      value.source,
      `${path}.source`,
      MAX_CONTENT_LENGTH,
      false,
    ),
    fit,
    brightness:
      legacyThreshold === undefined
        ? integerValue(value.brightness, `${path}.brightness`, 0, 255)
        : Math.min(255, 256 - legacyThreshold),
    contrast:
      value.contrast === undefined
        ? 128
        : integerValue(value.contrast, `${path}.contrast`, 0, 255),
    transparentBackground: transparentBackground ?? true,
    ...(editorSource === undefined
      ? {}
      : {
          editorSource: imageEditorSource(editorSource, `${path}.editorSource`),
        }),
  };
}

function imageEditorSource(value: unknown, path: string): ImageEditorSource {
  const item = record(value, path);
  const widthPixels = integerValue(
    item.widthPixels,
    `${path}.widthPixels`,
    1,
    MAX_IMAGE_DIMENSION_PIXELS,
  );
  const heightPixels = integerValue(
    item.heightPixels,
    `${path}.heightPixels`,
    1,
    MAX_IMAGE_DIMENSION_PIXELS,
  );
  const bounds = record(item.bounds, `${path}.bounds`);
  const left = integerValue(
    bounds.left,
    `${path}.bounds.left`,
    0,
    widthPixels - 1,
  );
  const top = integerValue(
    bounds.top,
    `${path}.bounds.top`,
    0,
    heightPixels - 1,
  );
  const right = integerValue(
    bounds.right,
    `${path}.bounds.right`,
    left,
    widthPixels - 1,
  );
  const bottom = integerValue(
    bounds.bottom,
    `${path}.bounds.bottom`,
    top,
    heightPixels - 1,
  );
  return {
    source: stringValue(
      item.source,
      `${path}.source`,
      MAX_CONTENT_LENGTH,
      false,
    ),
    widthPixels,
    heightPixels,
    bounds: { left, top, right, bottom },
  };
}

function shapeElement(
  value: Record<string, unknown>,
  path: string,
): ShapeElement {
  if (typeof value.filled !== "boolean")
    fail(`${path}.filled must be a boolean`);
  const shapeType = value.shapeType;
  if (
    shapeType !== undefined &&
    shapeType !== "line" &&
    shapeType !== "rectangle" &&
    shapeType !== "circle"
  ) {
    fail(`${path}.shapeType must be line, rectangle, or circle`);
  }
  return {
    ...baseElement(value, path),
    kind: "rectangle",
    ...(shapeType === undefined ? {} : { shapeType }),
    strokeWidthMm: numberValue(value.strokeWidthMm, `${path}.strokeWidthMm`, 0),
    filled: value.filled,
    cornerRadiusMm: numberValue(
      value.cornerRadiusMm,
      `${path}.cornerRadiusMm`,
      0,
    ),
  };
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(`${path} must be a boolean`);
  return value;
}

function qrOptions(value: unknown, path: string): QrOptions {
  const item = record(value, path);
  const errorCorrection = item.errorCorrection;
  if (
    errorCorrection !== "L" &&
    errorCorrection !== "M" &&
    errorCorrection !== "Q" &&
    errorCorrection !== "H"
  ) {
    fail(`${path}.errorCorrection must be L, M, Q, or H`);
  }
  const fields = record(item.data, `${path}.data`);
  const field = (key: string) =>
    stringValue(fields[key], `${path}.data.${key}`, 4_096);
  let data: QrData;
  switch (fields.type) {
    case "text":
      data = { type: "text", text: field("text") };
      break;
    case "url":
      data = { type: "url", url: field("url") };
      break;
    case "wifi": {
      const security = fields.security;
      if (security !== "WPA" && security !== "WEP" && security !== "nopass")
        fail(`${path}.data.security is not supported`);
      data = {
        type: "wifi",
        ssid: field("ssid"),
        password: field("password"),
        security,
        hidden: booleanValue(fields.hidden, `${path}.data.hidden`),
      };
      break;
    }
    case "email":
      data = {
        type: "email",
        address: field("address"),
        subject: field("subject"),
        body: field("body"),
      };
      break;
    case "phone":
      data = { type: "phone", number: field("number") };
      break;
    case "sms":
      data = {
        type: "sms",
        number: field("number"),
        message: field("message"),
      };
      break;
    case "contact":
      data = {
        type: "contact",
        firstName: field("firstName"),
        lastName: field("lastName"),
        organization: field("organization"),
        phone: field("phone"),
        email: field("email"),
        url: field("url"),
        address: field("address"),
      };
      break;
    case "geo":
      data = {
        type: "geo",
        latitude: numberValue(
          fields.latitude,
          `${path}.data.latitude`,
          -90,
          90,
        ),
        longitude: numberValue(
          fields.longitude,
          `${path}.data.longitude`,
          -180,
          180,
        ),
      };
      break;
    default:
      fail(`${path}.data.type is not supported`);
  }
  return { data, errorCorrection };
}

function codeElement(
  value: Record<string, unknown>,
  path: string,
  kind: "qr" | "barcode",
): CodeElement {
  const format = value.format;
  if (
    kind === "barcode" &&
    format !== undefined &&
    ![
      "code128",
      "code39",
      "ean13",
      "ean8",
      "upca",
      "itf14",
      "interleaved2of5",
      "datamatrix",
      "pdf417",
    ].includes(String(format))
  ) {
    fail(`${path}.format is not supported`);
  }
  if (kind === "qr" && value.barcode !== undefined)
    fail(`${path}.barcode is not valid for a QR code`);
  if (kind === "barcode" && value.qr !== undefined)
    fail(`${path}.qr is not valid for a barcode`);
  return {
    ...baseElement(value, path),
    kind,
    value: stringValue(value.value, `${path}.value`, 4_096),
    ...(value.includeMargin === undefined
      ? {}
      : {
          includeMargin: booleanValue(
            value.includeMargin,
            `${path}.includeMargin`,
          ),
        }),
    ...(format === undefined
      ? {}
      : { format: stringValue(format, `${path}.format`) }),
    ...(value.qr === undefined
      ? {}
      : { qr: qrOptions(value.qr, `${path}.qr`) }),
    ...(value.barcode === undefined
      ? {}
      : {
          barcode: {
            showText: booleanValue(
              record(value.barcode, `${path}.barcode`).showText,
              `${path}.barcode.showText`,
            ),
          },
        }),
  };
}

function elementValue(value: unknown, path: string): LabelElement {
  const item = record(value, path);
  switch (item.kind) {
    case "text":
      return textElement(item, path);
    case "image":
      return imageElement(item, path);
    case "rectangle":
      return shapeElement(item, path);
    case "qr":
    case "barcode":
      return codeElement(item, path, item.kind);
    default:
      fail(`${path}.kind is not supported`);
  }
}

function plateValue(
  value: unknown,
  path: string,
  usedIds: Set<string>,
): LabelPlate {
  const item = record(value, path);
  const id = uniqueId(item.id, `${path}.id`, usedIds);
  const margins = record(item.margins, `${path}.margins`);
  const elements = arrayValue(
    item.elements,
    `${path}.elements`,
    MAX_ELEMENTS_PER_PLATE,
  ).map((element, index) => {
    const result = elementValue(element, `${path}.elements[${index}]`);
    uniqueId(result.id, `${path}.elements[${index}].id`, usedIds);
    return result;
  });
  return {
    id,
    name: stringValue(item.name, `${path}.name`),
    ...(item.mirrorPrint === undefined
      ? {}
      : typeof item.mirrorPrint === "boolean"
        ? { mirrorPrint: item.mirrorPrint }
        : fail(`${path}.mirrorPrint must be a boolean`)),
    ...(item.widthMode === undefined
      ? {}
      : item.widthMode === "auto" || item.widthMode === "fixed"
        ? { widthMode: item.widthMode }
        : fail(`${path}.widthMode must be auto or fixed`)),
    size: sizeValue(item.size, `${path}.size`),
    margins: {
      leftMm: numberValue(margins.leftMm, `${path}.margins.leftMm`, 0),
      rightMm: numberValue(margins.rightMm, `${path}.margins.rightMm`, 0),
    },
    elements,
  };
}

function uniqueId(value: unknown, path: string, usedIds: Set<string>): string {
  const id = stringValue(value, path, MAX_SHORT_TEXT_LENGTH, false);
  if (usedIds.has(id)) fail(`${path} duplicates the ID ${JSON.stringify(id)}`);
  usedIds.add(id);
  return id;
}

export function validateLabelDocument(value: unknown): LabelDocument {
  const item = record(value, "workspace");
  if (item.schemaVersion !== 1) {
    throw new LabelDocumentError(
      "UNSUPPORTED_SCHEMA_VERSION",
      `workspace.schemaVersion must be 1; received ${JSON.stringify(item.schemaVersion)}`,
    );
  }
  const usedIds = new Set<string>();
  const id = uniqueId(item.id, "workspace.id", usedIds);
  const rawPlates = arrayValue(item.plates, "workspace.plates", MAX_PLATES);
  if (rawPlates.length === 0)
    fail("workspace.plates must contain at least one plate");
  return {
    schemaVersion: 1,
    id,
    name: stringValue(item.name, "workspace.name"),
    defaultPlateSize: sizeValue(
      item.defaultPlateSize,
      "workspace.defaultPlateSize",
    ),
    plates: rawPlates.map((plate, index) =>
      plateValue(plate, `workspace.plates[${index}]`, usedIds),
    ),
  };
}

export function parseLabelDocument(text: string): LabelDocument {
  if (new TextEncoder().encode(text).byteLength > MAX_WORKSPACE_BYTES) {
    throw new LabelDocumentError(
      "DOCUMENT_TOO_LARGE",
      `Workspace files must be smaller than ${MAX_WORKSPACE_BYTES} bytes`,
    );
  }
  let value: unknown;
  try {
    value = parse(text, {
      maxAliasCount: 100,
      prettyErrors: false,
      uniqueKeys: true,
    });
  } catch {
    throw new LabelDocumentError(
      "INVALID_YAML",
      "Workspace file is not valid YAML",
    );
  }
  return validateLabelDocument(value);
}

export function serializeLabelDocument(document: LabelDocument): string {
  const validated = validateLabelDocument(document);
  const text = stringify(validated, { lineWidth: 0 });
  if (new TextEncoder().encode(text).byteLength > MAX_WORKSPACE_BYTES) {
    throw new LabelDocumentError(
      "DOCUMENT_TOO_LARGE",
      `Workspace files must be smaller than ${MAX_WORKSPACE_BYTES} bytes`,
    );
  }
  return text;
}

export function createBlankLabelDocument(
  createId: () => string = () => globalThis.crypto.randomUUID(),
): LabelDocument {
  const size = { widthMm: 40, heightMm: 16 };
  return {
    schemaVersion: 1,
    id: createId(),
    name: "Untitled workspace",
    defaultPlateSize: { ...size },
    plates: [
      {
        id: createId(),
        name: "Label 1",
        size: { ...size },
        margins: { leftMm: 0, rightMm: 0 },
        elements: [
          {
            id: createId(),
            kind: "text",
            xMm: 4,
            yMm: 4,
            widthMm: 32,
            heightMm: 8,
            rotationDeg: 0,
            text: "NEW LABEL",
            fontFamily: DEFAULT_TEXT_TYPEFACE,
            fontSizePt: 14,
            fontWeight: 600,
            fontStyle: "normal",
            align: "center",
          },
        ],
      },
    ],
  };
}
