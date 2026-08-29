// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CanvasRulers } from "./CanvasGuides.js";

afterEach(cleanup);

describe("CanvasRulers", () => {
  it("merges vertical dimensions within the physical tolerance", () => {
    const { container } = render(
      <CanvasRulers
        canvasScale={8}
        heightMm={20}
        printableMargins={{ bottomMm: 0.02, topMm: 0.02 }}
        widthMm={40}
        zoom={100}
      />,
    );

    expect(
      container.querySelector(".dimension-ruler-printable-height"),
    ).not.toBeInTheDocument();
    expect(container.querySelector(".dimension-ruler-height")).toHaveClass(
      "dimension-ruler-height-merged",
    );
  });

  it("keeps distinct vertical dimensions outside the physical tolerance", () => {
    const { container } = render(
      <CanvasRulers
        canvasScale={8}
        heightMm={20}
        printableMargins={{ bottomMm: 0.03, topMm: 0.03 }}
        widthMm={40}
        zoom={100}
      />,
    );

    expect(
      container.querySelector(".dimension-ruler-printable-height"),
    ).toHaveTextContent("19.9 mm");
    expect(container.querySelector(".dimension-ruler-height")).not.toHaveClass(
      "dimension-ruler-height-merged",
    );
  });

  it("scales both ruler label sizes with zoom and keeps readable minimums", () => {
    const { container, rerender } = render(
      <CanvasRulers
        canvasScale={16}
        heightMm={20}
        printableMargins={{ bottomMm: 1, topMm: 1 }}
        widthMm={40}
        zoom={200}
      />,
    );

    expect(
      container
        .querySelector<HTMLElement>(".dimension-ruler")
        ?.style.getPropertyValue("--dimension-ruler-font-size"),
    ).toBe("20px");
    expect(
      container
        .querySelector<HTMLElement>(".ruler-top")
        ?.style.getPropertyValue("--interval-ruler-font-size"),
    ).toBe("17px");

    rerender(
      <CanvasRulers
        canvasScale={4.8}
        heightMm={20}
        printableMargins={{ bottomMm: 1, topMm: 1 }}
        widthMm={40}
        zoom={60}
      />,
    );

    expect(
      container
        .querySelector<HTMLElement>(".dimension-ruler")
        ?.style.getPropertyValue("--dimension-ruler-font-size"),
    ).toBe("10px");
    expect(
      container
        .querySelector<HTMLElement>(".ruler-top")
        ?.style.getPropertyValue("--interval-ruler-font-size"),
    ).toBe("8.5px");
  });
});
