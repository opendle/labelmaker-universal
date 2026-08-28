export type Millimeters = number;
export type Degrees = number;

export const DEFAULT_TEXT_TYPEFACE = '"Avenir Next", "Segoe UI", sans-serif';

export interface PhysicalSize {
  readonly widthMm: Millimeters;
  readonly heightMm: Millimeters;
}

export interface PlateMargins {
  readonly leftMm: Millimeters;
  readonly rightMm: Millimeters;
}

export interface ElementFrame {
  readonly xMm: Millimeters;
  readonly yMm: Millimeters;
  readonly widthMm: Millimeters;
  readonly heightMm: Millimeters;
  readonly rotationDeg: Degrees;
}

interface LabelElementBase extends ElementFrame {
  readonly id: string;
}

export interface TextElement extends LabelElementBase {
  readonly kind: "text";
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSizePt: number;
  readonly fontWeight: number;
  /** Omitted by older schema-version 1 files; an omitted value means normal. */
  readonly fontStyle?: "normal" | "italic";
  /** Omitted for automatic line height equal to the font size. */
  readonly lineHeightPt?: number;
  readonly align: "left" | "center" | "right";
  /** Omitted by older schema-version 1 files; an omitted value means middle. */
  readonly verticalAlign?: "top" | "middle" | "bottom";
}

export interface ImageElement extends LabelElementBase {
  readonly kind: "image";
  readonly source: string;
  readonly fit: "contain" | "cover" | "stretch";
  readonly threshold: number;
}

export interface ShapeElement extends LabelElementBase {
  readonly kind: "rectangle";
  readonly strokeWidthMm: Millimeters;
  readonly filled: boolean;
  readonly cornerRadiusMm: Millimeters;
}

export interface CodeElement extends LabelElementBase {
  readonly kind: "qr" | "barcode";
  readonly value: string;
  readonly format?: string;
}

export type LabelElement =
  | TextElement
  | ImageElement
  | ShapeElement
  | CodeElement;

export interface LabelPlate {
  readonly id: string;
  readonly name: string;
  /** Mirror the printed output without changing the editor artwork. */
  readonly mirrorPrint?: boolean;
  readonly size: PhysicalSize;
  readonly margins: PlateMargins;
  readonly elements: readonly LabelElement[];
}

export interface LabelDocumentV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly defaultPlateSize: PhysicalSize;
  readonly plates: readonly LabelPlate[];
}

export type LabelDocument = LabelDocumentV1;

export const LABEL_DOCUMENT_SCHEMA_VERSION = 1 as const;
