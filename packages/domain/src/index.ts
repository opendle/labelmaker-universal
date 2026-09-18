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

export interface ImageEditorSource {
  readonly source: string;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly bounds: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
}

export interface ImageElement extends LabelElementBase {
  readonly kind: "image";
  readonly source: string;
  readonly fit: "contain" | "cover" | "stretch";
  /** Tone controls from 0 through 255. A value of 128 is neutral. */
  readonly brightness: number;
  readonly contrast: number;
  /** Exact white pixels reveal the label and earlier elements by default. */
  readonly transparentBackground?: boolean;
  /** Full pre-crop pixels and the visible bounds used by the drawing editor. */
  readonly editorSource?: ImageEditorSource;
}

export interface ShapeElement extends LabelElementBase {
  readonly kind: "rectangle";
  /** Omitted by older schema-version 1 files; an omitted value means rectangle. */
  readonly shapeType?: "line" | "rectangle" | "circle";
  readonly strokeWidthMm: Millimeters;
  readonly filled: boolean;
  readonly cornerRadiusMm: Millimeters;
}

export type QrErrorCorrection = "L" | "M" | "Q" | "H";

export type QrData =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "url"; readonly url: string }
  | {
      readonly type: "wifi";
      readonly ssid: string;
      readonly password: string;
      readonly security: "WPA" | "WEP" | "nopass";
      readonly hidden: boolean;
    }
  | {
      readonly type: "email";
      readonly address: string;
      readonly subject: string;
      readonly body: string;
    }
  | { readonly type: "phone"; readonly number: string }
  | { readonly type: "sms"; readonly number: string; readonly message: string }
  | {
      readonly type: "contact";
      readonly firstName: string;
      readonly lastName: string;
      readonly organization: string;
      readonly phone: string;
      readonly email: string;
      readonly url: string;
      readonly address: string;
    }
  | {
      readonly type: "geo";
      readonly latitude: number;
      readonly longitude: number;
    };

export interface QrOptions {
  readonly data: QrData;
  readonly errorCorrection: QrErrorCorrection;
}

export type BarcodeFormat =
  | "code128"
  | "code39"
  | "ean13"
  | "ean8"
  | "upca"
  | "itf14"
  | "interleaved2of5"
  | "datamatrix"
  | "pdf417";

export interface BarcodeOptions {
  readonly showText: boolean;
}

export interface CodeElement extends LabelElementBase {
  readonly kind: "qr" | "barcode";
  readonly value: string;
  readonly format?: string;
  /** Add a white border around the code. An omitted value means false. */
  readonly includeMargin?: boolean;
  readonly qr?: QrOptions;
  readonly barcode?: BarcodeOptions;
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
  /** An omitted value means automatic width. */
  readonly widthMode?: "auto" | "fixed";
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
