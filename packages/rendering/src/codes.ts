import type { BarcodeFormat, CodeElement, QrData } from "@labelmaker/domain";
import {
  code128,
  code39,
  datamatrix,
  drawingSVG,
  ean13,
  ean8,
  interleaved2of5,
  itf14,
  pdf417,
  qrcode,
  upca,
} from "@bwip-js/generic";

// Named encoders let the build remove unsupported barcode formats.
const codeEncoders = {
  code128,
  code39,
  datamatrix,
  ean13,
  ean8,
  interleaved2of5,
  itf14,
  pdf417,
  qrcode,
  upca,
} satisfies Record<BarcodeFormat | "qrcode", typeof code128>;

export const BARCODE_FORMATS: readonly BarcodeFormat[] = [
  "code128",
  "code39",
  "ean13",
  "ean8",
  "upca",
  "itf14",
  "interleaved2of5",
  "datamatrix",
  "pdf417",
];

const MAX_CODE_LENGTH = 4_096;

function required(value: string, field: string): string {
  if (value.trim().length === 0) throw new Error(`Enter ${field}.`);
  return value;
}

function singleLine(value: string, field: string): string {
  if (/[\r\n\u0000]/.test(value))
    throw new Error(`${field} must use one line.`);
  return value;
}

function phoneNumber(value: string): string {
  required(value, "a phone number");
  if (!/^\+?[0-9 ().-]+$/.test(value) || !/[0-9]/.test(value)) {
    throw new Error("Use digits and phone number punctuation.");
  }
  return value.replace(/[ ().-]/g, "");
}

function emailAddress(value: string): string {
  if (!/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(value)) {
    throw new Error("Enter a complete email address.");
  }
  return value;
}

function webUrl(value: string): string {
  singleLine(value, "The web address");
  try {
    const parsed = new URL(value);
    if (!["https:", "http:"].includes(parsed.protocol) || !parsed.hostname) {
      throw new Error();
    }
  } catch {
    throw new Error(
      "Enter a complete web address that starts with https:// or http://.",
    );
  }
  return value;
}

const wifiEscape = (value: string): string =>
  value.replace(/[\\;,:\"]/g, "\\$&");
const vcardEscape = (value: string): string =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n?|\n/g, "\\n")
    .replace(/[;,]/g, "\\$&");

/** Convert saved form fields into the standard text read by a scanner. */
export function buildQrPayload(data: QrData): string {
  let result: string;
  switch (data.type) {
    case "text":
      result = required(data.text, "the code content");
      break;
    case "url":
      result = webUrl(data.url);
      break;
    case "wifi": {
      required(data.ssid, "a network name");
      singleLine(data.ssid, "The network name");
      singleLine(data.password, "The password");
      if (data.security !== "nopass")
        required(data.password, "a network password");
      result = `WIFI:T:${data.security};S:${wifiEscape(data.ssid)};${data.security === "nopass" ? "" : `P:${wifiEscape(data.password)};`}H:${data.hidden ? "true" : "false"};;`;
      break;
    }
    case "email":
      result = `mailto:${emailAddress(data.address)}?subject=${encodeURIComponent(data.subject)}&body=${encodeURIComponent(data.body)}`;
      break;
    case "phone":
      result = `tel:${phoneNumber(data.number)}`;
      break;
    case "sms":
      result = `sms:${phoneNumber(data.number)}?body=${encodeURIComponent(data.message)}`;
      break;
    case "geo":
      if (
        !Number.isFinite(data.latitude) ||
        data.latitude < -90 ||
        data.latitude > 90 ||
        !Number.isFinite(data.longitude) ||
        data.longitude < -180 ||
        data.longitude > 180
      ) {
        throw new Error(
          "Enter a latitude from -90 to 90 and a longitude from -180 to 180.",
        );
      }
      result = `geo:${data.latitude},${data.longitude}`;
      break;
    case "contact": {
      required(`${data.firstName} ${data.lastName}`, "a contact name");
      if (data.email) emailAddress(data.email);
      if (data.url) webUrl(data.url);
      if (data.phone) phoneNumber(data.phone);
      result = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `N:${vcardEscape(data.lastName)};${vcardEscape(data.firstName)};;;`,
        `FN:${vcardEscape(`${data.firstName} ${data.lastName}`.trim())}`,
        ...(data.organization ? [`ORG:${vcardEscape(data.organization)}`] : []),
        ...(data.phone ? [`TEL:${vcardEscape(data.phone)}`] : []),
        ...(data.email ? [`EMAIL:${vcardEscape(data.email)}`] : []),
        ...(data.url ? [`URL:${vcardEscape(data.url)}`] : []),
        ...(data.address ? [`ADR:;;${vcardEscape(data.address)};;;;`] : []),
        "END:VCARD",
      ].join("\r\n");
      break;
    }
  }
  if (new TextEncoder().encode(result).length > MAX_CODE_LENGTH) {
    throw new Error("The code content is too long. Use less text.");
  }
  return result;
}

export interface CodeArtwork {
  readonly svg: string;
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
}

export type CodeConfiguration = Pick<
  CodeElement,
  "kind" | "value" | "format" | "qr" | "barcode" | "includeMargin"
>;

/** Generate the same vector artwork for the editor, preview, and print output. */
export function generateCodeArtwork(code: CodeConfiguration): CodeArtwork {
  const value =
    code.kind === "qr" && code.qr
      ? buildQrPayload(code.qr.data)
      : required(code.value, "the code content");
  if (new TextEncoder().encode(value).length > MAX_CODE_LENGTH) {
    throw new Error("The code content is too long. Use less text.");
  }
  const format = code.kind === "qr" ? "qrcode" : (code.format ?? "code128");
  if (
    code.kind === "barcode" &&
    !BARCODE_FORMATS.includes(format as BarcodeFormat)
  ) {
    throw new Error("Select a supported barcode type.");
  }
  const matrix = ["qrcode", "datamatrix", "pdf417"].includes(format);
  let svg: string;
  try {
    svg = codeEncoders[format as keyof typeof codeEncoders](
      {
        bcid: format,
        text: value,
        scale: 1,
        backgroundcolor: "FFFFFF",
        barcolor: "000000",
        // QR modules are two SVG units wide at scale 1. Keep four modules clear.
        padding:
          code.includeMargin === true
            ? format === "qrcode"
              ? 8
              : matrix
                ? 4
                : 24
            : 0,
        ...(code.kind === "qr"
          ? { eclevel: code.qr?.errorCorrection ?? "M", fixedeclevel: true }
          : {}),
        ...(!matrix
          ? {
              height: 12,
              includetext: code.barcode?.showText ?? true,
              textxalign: "center" as const,
              textsize: 10,
            }
          : {}),
      },
      drawingSVG(),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // Keep encoder diagnostics useful without exposing the encoded content.
    const message = detail.replace(/^.*?bwipp\.[^:]+:\s*/, "");
    throw new Error(
      message.startsWith("Error:") ? message.slice(6).trim() : message,
    );
  }
  const dimensions = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  if (!dimensions) throw new Error("The code image has invalid dimensions.");
  return {
    svg,
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width: Number(dimensions[1]),
    height: Number(dimensions[2]),
  };
}
