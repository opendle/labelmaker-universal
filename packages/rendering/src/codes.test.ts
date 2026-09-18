import type { QrData } from "@labelmaker/domain";
import { describe, expect, it } from "vitest";
import {
  BARCODE_FORMATS,
  buildQrPayload,
  generateCodeArtwork,
} from "./codes.js";
import { buildPlateSvg } from "./plate-raster.js";

const formCases: Array<[QrData, string]> = [
  [{ type: "text", text: "Café 🏠" }, "Café 🏠"],
  [
    { type: "url", url: "https://example.com/a?b=1&c=2" },
    "https://example.com/a?b=1&c=2",
  ],
  [
    {
      type: "wifi",
      ssid: 'Lab;A:B,"C"\\',
      password: "p;ass\\word",
      security: "WPA",
      hidden: true,
    },
    'WIFI:T:WPA;S:Lab\\;A\\:B\\,\\"C\\"\\\\;P:p\\;ass\\\\word;H:true;;',
  ],
  [
    {
      type: "email",
      address: "a@example.com",
      subject: "A & B",
      body: "Hi\nfriend",
    },
    "mailto:a@example.com?subject=A%20%26%20B&body=Hi%0Afriend",
  ],
  [{ type: "phone", number: "+33 (1) 23-45" }, "tel:+3312345"],
  [
    { type: "sms", number: "+33 12345", message: "A&B?" },
    "sms:+3312345?body=A%26B%3F",
  ],
  [{ type: "geo", latitude: -90, longitude: 180 }, "geo:-90,180"],
];

describe("QR payloads", () => {
  it.each(formCases)("encodes structured fields for %j", (data, expected) => {
    expect(buildQrPayload(data)).toBe(expected);
  });

  it("escapes contact fields and prevents extra vCard properties", () => {
    expect(
      buildQrPayload({
        type: "contact",
        firstName: "A;B",
        lastName: "C,D",
        organization: "Lab\nTEL:bad",
        phone: "",
        email: "",
        url: "",
        address: "Street\\1",
      }),
    ).toBe(
      "BEGIN:VCARD\r\nVERSION:3.0\r\nN:C\\,D;A\\;B;;;\r\nFN:A\\;B C\\,D\r\nORG:Lab\\nTEL:bad\r\nADR:;;Street\\\\1;;;;\r\nEND:VCARD",
    );
  });

  it("omits a stored password for an open Wi-Fi network", () => {
    expect(
      buildQrPayload({
        type: "wifi",
        ssid: "Guest",
        password: "old secret",
        security: "nopass",
        hidden: false,
      }),
    ).toBe("WIFI:T:nopass;S:Guest;H:false;;");
  });

  it.each<QrData>([
    { type: "text", text: " " },
    { type: "text", text: "é".repeat(2049) },
    { type: "url", url: "javascript:alert(1)" },
    { type: "email", address: "a@example.com?cc=other", subject: "", body: "" },
    { type: "phone", number: "+123\n456" },
    { type: "geo", latitude: 90.1, longitude: 0 },
    { type: "geo", latitude: 0, longitude: Number.NaN },
  ])("rejects invalid content %j", (data) => {
    expect(() => buildQrPayload(data)).toThrow();
  });
});

const values = {
  code128: "ABC-123",
  code39: "ABC-123",
  ean13: "5901234123457",
  ean8: "96385074",
  upca: "012345678905",
  itf14: "10012345000017",
  interleaved2of5: "123456",
  datamatrix: "ABC-123",
  pdf417: "ABC-123",
};

describe("code artwork", () => {
  it.each(BARCODE_FORMATS)("generates vector artwork for %s", (format) => {
    const artwork = generateCodeArtwork({
      kind: "barcode",
      format,
      value: values[format],
    });
    expect(artwork.svg).toContain("<path");
    expect(artwork.svg).toContain('fill="#FFFFFF"');
    expect(artwork.width).toBeGreaterThan(8);
    expect(artwork.height).toBeGreaterThan(8);
    expect(
      decodeURIComponent(artwork.dataUrl.split(",").slice(1).join(",")),
    ).toBe(artwork.svg);
  });

  it("keeps four QR modules clear and uses structured data as the source", () => {
    const structured = generateCodeArtwork({
      kind: "qr",
      value: "old",
      includeMargin: true,
      qr: { data: { type: "text", text: "hello" }, errorCorrection: "M" },
    });
    const legacy = generateCodeArtwork({
      kind: "qr",
      value: "hello",
      includeMargin: true,
    });
    expect(structured).toEqual(legacy);
    // Version 1 has 21 modules. Each module is 2 units, plus 8 units at each edge.
    expect(structured.width).toBe(58);
    expect(structured.height).toBe(58);
    expect(structured.svg).toContain("M8 ");
  });

  it.each(["qr", ...BARCODE_FORMATS] as const)(
    "adds no margin by default for %s",
    (format) => {
      const code =
        format === "qr"
          ? { kind: "qr" as const, value: "hello" }
          : { kind: "barcode" as const, format, value: values[format] };
      const plain = generateCodeArtwork(code);
      expect(plain).toEqual(
        generateCodeArtwork({ ...code, includeMargin: false }),
      );
      const bordered = generateCodeArtwork({ ...code, includeMargin: true });
      const padding =
        format === "qr"
          ? 8
          : format === "datamatrix" || format === "pdf417"
            ? 4
            : 24;
      expect(bordered.width - plain.width).toBe(padding * 2);
      expect(bordered.height - plain.height).toBe(padding * 2);
      if (format === "qr") expect(plain.width).toBe(42);
    },
  );

  it("keeps all four selected correction levels distinct for short content", () => {
    const previews = (["L", "M", "Q", "H"] as const).map(
      (errorCorrection) =>
        generateCodeArtwork({
          kind: "qr",
          value: "hello",
          qr: { data: { type: "text", text: "hello" }, errorCorrection },
        }).svg,
    );
    expect(new Set(previews).size).toBe(4);
  });

  it("uses correction level and the human-readable text option", () => {
    expect(
      generateCodeArtwork({
        kind: "qr",
        value: "",
        qr: {
          data: { type: "text", text: "Some QR content" },
          errorCorrection: "H",
        },
      }).svg,
    ).not.toBe(
      generateCodeArtwork({ kind: "qr", value: "Some QR content" }).svg,
    );
    expect(
      generateCodeArtwork({
        kind: "barcode",
        value: "ABC",
        barcode: { showText: true },
      }).svg,
    ).not.toBe(
      generateCodeArtwork({
        kind: "barcode",
        value: "ABC",
        barcode: { showText: false },
      }).svg,
    );
  });

  it("rejects incorrect check digits and unsupported or excessive content", () => {
    expect(() =>
      generateCodeArtwork({
        kind: "barcode",
        format: "ean13",
        value: "5901234123458",
      }),
    ).toThrow();
    expect(() =>
      generateCodeArtwork({ kind: "barcode", format: "unknown", value: "abc" }),
    ).toThrow();
    expect(() =>
      generateCodeArtwork({
        kind: "barcode",
        format: "code39",
        value: "lowercase",
      }),
    ).toThrow();
    expect(() =>
      generateCodeArtwork({ kind: "qr", value: "a".repeat(4097) }),
    ).toThrow();
  });

  it("prints the same SVG inside the frame with its aspect ratio and rotation", () => {
    const code = {
      id: "code",
      kind: "qr" as const,
      value: "hello",
      xMm: 2,
      yMm: 1,
      widthMm: 12,
      heightMm: 12,
      rotationDeg: 90,
    };
    const artwork = generateCodeArtwork(code);
    const svg = buildPlateSvg(
      {
        id: "plate",
        name: "",
        size: { widthMm: 40, heightMm: 16 },
        margins: { leftMm: 0, rightMm: 0 },
        elements: [code],
      },
      320,
      128,
    );
    expect(svg).toContain("rotate(90 8 7)");
    expect(svg).toContain(
      'x="2" y="1" width="12" height="12" preserveAspectRatio="xMidYMid meet"',
    );
    expect(svg).toContain(artwork.svg.slice(artwork.svg.indexOf("\n")));
    expect(svg).not.toContain("data:image/svg");
  });
});
