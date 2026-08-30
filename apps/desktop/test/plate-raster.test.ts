import { createBlankLabelDocument } from "@labelmaker/documents";
import { buildPlateSvg, renderPlateForPrinter } from "@labelmaker/rendering";
import { describe, expect, it, vi } from "vitest";

const plate = createBlankLabelDocument(() => "id").plates[0]!;

describe("desktop plate rasterization", () => {
  it("renders document text as escaped SVG", () => {
    const changed = {
      ...plate,
      elements: plate.elements.map((element) =>
        element.kind === "text"
          ? { ...element, text: "A < B & C", fontFamily: 'A "Font"' }
          : element,
      ),
    };

    const svg = buildPlateSvg(changed, 320, 96, 12);

    expect(svg).toContain("A &lt; B &amp; C");
    expect(svg).toContain('font-family="A &quot;Font&quot;"');
    expect(svg).toContain('viewBox="0 2 40 12"');
  });

  it("uses the full height of a label that is narrower than the print head", () => {
    const narrow = { ...plate, size: { ...plate.size, heightMm: 10 } };

    const svg = buildPlateSvg(narrow, 320, 96, 12);

    expect(svg).toContain('viewBox="0 -1 40 12"');
    expect(svg).toContain('height="10" fill="white"');
  });

  it("positions the print head with independent top and bottom margins", () => {
    const svg = buildPlateSvg(plate, 320, 96, 12, 1, 3);

    expect(svg).toContain('viewBox="0 1 40 12"');
  });

  it("keeps centered artwork centered on 16 mm MakeID E1 media", () => {
    const svg = buildPlateSvg(plate, 320, 96, 12, 2, 2, "start");

    expect(svg).toContain('viewBox="0 0 40 12"');
  });

  it.each([
    ["start", 0],
    ["center", -1],
    ["end", -2],
  ] as const)(
    "positions narrow media at the %s of the print head",
    (rasterAlignment, viewBoxY) => {
      const narrow = { ...plate, size: { ...plate.size, heightMm: 10 } };
      const svg = buildPlateSvg(narrow, 320, 96, 12, 0, 0, rasterAlignment);

      expect(svg).toContain(`viewBox="0 ${String(viewBoxY)} 40 12"`);
    },
  );

  it("renders line breaks and italic text as separate SVG lines", () => {
    const changed = {
      ...plate,
      elements: plate.elements.map((element) =>
        element.kind === "text"
          ? { ...element, text: "FIRST\nSECOND", fontStyle: "italic" as const }
          : element,
      ),
    };

    const svg = buildPlateSvg(changed, 320, 96);

    expect(svg).toContain('font-style="italic"');
    expect(svg).toMatch(
      /<tspan[^>]+>FIRST<\/tspan><tspan[^>]+>SECOND<\/tspan>/,
    );
  });

  it("uses fixed line height and vertical alignment in printed text", () => {
    const changed = {
      ...plate,
      elements: plate.elements.map((element) =>
        element.kind === "text"
          ? {
              ...element,
              align: "right" as const,
              lineHeightPt: 10,
              text: "FIRST\nSECOND",
              verticalAlign: "top" as const,
            }
          : element,
      ),
    };

    const svg = buildPlateSvg(changed, 320, 96);

    expect(svg).toContain('<text text-anchor="end"');
    expect(svg).toContain('<tspan x="36" y="5.763888888888889">FIRST');
    expect(svg).toContain('<tspan x="36" y="9.291666666666668">SECOND');
  });

  it("mirrors only the printed artwork when print mirroring is on", () => {
    const svg = buildPlateSvg({ ...plate, mirrorPrint: true }, 320, 96);

    expect(svg).toContain('<rect x="0" y="0" width="40"');
    expect(svg).toContain('<g transform="translate(40 0) scale(-1 1)">');
    expect(svg).toMatch(/<g[^>]+><text[\s\S]*<\/text><\/g><\/svg>$/);
  });

  it("renders line, rectangle, and circle shapes", () => {
    const frame = {
      kind: "rectangle" as const,
      xMm: 2,
      yMm: 3,
      widthMm: 8,
      heightMm: 6,
      rotationDeg: 0,
      strokeWidthMm: 0.5,
      filled: false,
      cornerRadiusMm: 0,
    };
    const changed = {
      ...plate,
      elements: [
        { ...frame, id: "line", shapeType: "line" as const },
        { ...frame, id: "rectangle", shapeType: "rectangle" as const },
        { ...frame, id: "circle", shapeType: "circle" as const },
      ],
    };

    const svg = buildPlateSvg(changed, 320, 96);

    expect(svg).toContain('<line x1="2" y1="6" x2="10" y2="6"');
    expect(svg).toContain('<rect x="2.25" y="3.25" width="7.5" height="5.5"');
    expect(svg).toContain('<ellipse cx="6" cy="6" rx="3.75" ry="2.75"');
    expect(svg).not.toContain('color="#');
  });

  it("fills shapes in black without drawing outside their frames", () => {
    const changed = {
      ...plate,
      elements: [
        {
          id: "filled-circle",
          kind: "rectangle" as const,
          shapeType: "circle" as const,
          xMm: 2,
          yMm: 3,
          widthMm: 8,
          heightMm: 6,
          rotationDeg: 0,
          strokeWidthMm: 0.5,
          filled: true,
          cornerRadiusMm: 0,
        },
      ],
    };

    const svg = buildPlateSvg(changed, 320, 96);

    expect(svg).toContain(
      '<ellipse cx="6" cy="6" rx="4" ry="3" fill="black" stroke="none" stroke-width="0"',
    );
  });

  it("transposes pixels and reverses the E1 feed-line order", async () => {
    const rasterize = vi.fn((_svg: string, width: number, height: number) => {
      const data = new Uint8Array(width * height * 4).fill(255);
      const blackPixel = (y: number, x: number): void => {
        const index = (y * width + x) * 4;
        data[index] = 0;
        data[index + 1] = 0;
        data[index + 2] = 0;
      };
      blackPixel(0, 0);
      blackPixel(height - 1, 1);
      return { widthPixels: width, heightPixels: height, data };
    });

    const page = await renderPlateForPrinter(
      plate,
      {
        dpi: 25.4,
        rasterWidthPixels: 8,
        printableWidthMm: 8,
        rasterAlignment: "center",
      },
      rasterize,
    );

    expect(page).toMatchObject({
      widthPixels: 8,
      heightPixels: 40,
      bytesPerRow: 1,
    });
    expect(page.data[page.data.length - 1]).toBe(0x80);
    expect(page.data[page.data.length - 2]).toBe(0x01);
    expect(page.data[0]).toBe(0);
  });

  it("applies each image tone setting before it composites the artwork", async () => {
    const image = {
      id: "image",
      kind: "image" as const,
      xMm: 1,
      yMm: 1,
      widthMm: 1,
      heightMm: 1,
      rotationDeg: 0,
      source: "data:image/png;base64,AA==",
      fit: "stretch" as const,
      brightness: 206,
      contrast: 128,
    };
    const imagePlate = { ...plate, elements: [...plate.elements, image] };
    const finalSvgs: string[] = [];
    const rasterize = vi.fn((svg: string, width: number, height: number) => {
      const data = new Uint8Array(width * height * 4).fill(255);
      if (svg.includes('viewBox="0 0 1 1"')) {
        data[0] = 100;
        data[1] = 100;
        data[2] = 100;
      } else {
        finalSvgs.push(svg);
      }
      return { widthPixels: width, heightPixels: height, data };
    });

    await renderPlateForPrinter(
      imagePlate,
      {
        dpi: 25.4,
        rasterWidthPixels: 8,
        printableWidthMm: 8,
        rasterAlignment: "center",
      },
      rasterize,
    );
    await renderPlateForPrinter(
      {
        ...imagePlate,
        elements: imagePlate.elements.map((element) =>
          element.kind === "image"
            ? { ...element, brightness: 106, contrast: 160 }
            : element,
        ),
      },
      {
        dpi: 25.4,
        rasterWidthPixels: 8,
        printableWidthMm: 8,
        rasterAlignment: "center",
      },
      rasterize,
    );

    const embeddedPixel = (svg: string) => {
      const encoded = svg.match(/data:image\/bmp;base64,([^&"]+)/)?.[1];
      if (!encoded) throw new Error("Expected an embedded BMP image");
      const bitmap = Buffer.from(encoded, "base64");
      const pixelOffset = bitmap.readUInt32LE(10);
      return {
        blue: bitmap[pixelOffset],
        alpha: bitmap[pixelOffset + 3],
      };
    };
    expect(embeddedPixel(finalSvgs[0] ?? "")).toEqual({
      blue: 255,
      alpha: 0,
    });
    expect(embeddedPixel(finalSvgs[1] ?? "")).toEqual({
      blue: 0,
      alpha: 255,
    });
    expect(finalSvgs[0]).toMatch(/<text[\s\S]*<image/);
  });
});
