import { createBlankLabelDocument } from "@labelmaker/documents";
import { describe, expect, it, vi } from "vitest";

import {
  buildPlateSvg,
  renderPlateForPrinter,
} from "../src/main/plate-raster.js";

describe("desktop plate rasterization", () => {
  it("renders document text as escaped SVG", () => {
    const plate = createBlankLabelDocument(() => "id").plates[0];
    if (!plate) throw new Error("Expected a plate");
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
    const plate = createBlankLabelDocument(() => "id").plates[0];
    if (!plate) throw new Error("Expected a plate");
    const narrow = { ...plate, size: { ...plate.size, heightMm: 10 } };

    const svg = buildPlateSvg(narrow, 320, 96, 12);

    expect(svg).toContain('viewBox="0 -1 40 12"');
    expect(svg).toContain('height="10" fill="white"');
  });

  it("positions the print head with independent top and bottom margins", () => {
    const plate = createBlankLabelDocument(() => "id").plates[0];
    if (!plate) throw new Error("Expected a plate");

    const svg = buildPlateSvg(plate, 320, 96, 12, 1, 3);

    expect(svg).toContain('viewBox="0 1 40 12"');
  });

  it("renders line breaks and italic text as separate SVG lines", () => {
    const plate = createBlankLabelDocument(() => "id").plates[0];
    if (!plate) throw new Error("Expected a plate");
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
    const plate = createBlankLabelDocument(() => "id").plates[0];
    if (!plate) throw new Error("Expected a plate");
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
    const plate = createBlankLabelDocument(() => "id").plates[0];
    if (!plate) throw new Error("Expected a plate");

    const svg = buildPlateSvg({ ...plate, mirrorPrint: true }, 320, 96);

    expect(svg).toContain('<rect x="0" y="0" width="40"');
    expect(svg).toContain('<g transform="translate(40 0) scale(-1 1)">');
    expect(svg).toMatch(/<g[^>]+><text[\s\S]*<\/text><\/g><\/svg>$/);
  });

  it("transposes pixels and reverses the E1 feed-line order", async () => {
    const plate = createBlankLabelDocument(() => "id").plates[0];
    if (!plate) throw new Error("Expected a plate");
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
      { dpi: 25.4, rasterWidthPixels: 8, printableWidthMm: 8 },
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
});
