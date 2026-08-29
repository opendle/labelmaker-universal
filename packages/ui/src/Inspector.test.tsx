// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Inspector } from "./Inspector.js";

describe("image inspector", () => {
  it("shows a default-on transparent background control next to Fit", async () => {
    const user = userEvent.setup();
    const onUpdateImage = vi.fn();
    const image = {
      id: "image",
      kind: "image" as const,
      xMm: 1,
      yMm: 1,
      widthMm: 10,
      heightMm: 5,
      rotationDeg: 0,
      source: "data:image/png;base64,image",
      fit: "contain" as const,
      brightness: 128,
      contrast: 128,
    };
    render(
      <Inspector
        hasMultipleElements={false}
        onDeleteSelection={vi.fn()}
        onMoveLayer={vi.fn()}
        onUpdateImage={onUpdateImage}
        onUpdateShape={vi.fn()}
        onUpdateText={vi.fn()}
        selectedImage={image}
        selectedShape={undefined}
        selectedText={undefined}
      />,
    );

    const toggle = screen.getByRole("button", {
      name: "Transparent image background",
    });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("FIT")).not.toBeInTheDocument();
    expect(toggle.closest(".image-fit-row")).toContainElement(
      screen.getByRole("combobox", { name: "Image fit" }),
    );

    await user.click(toggle);

    expect(onUpdateImage).toHaveBeenCalledWith({
      ...image,
      transparentBackground: false,
    });
  });

  it("uses accessible button groups without redundant visible labels", () => {
    render(
      <Inspector
        hasMultipleElements
        onDeleteSelection={vi.fn()}
        onMoveLayer={vi.fn()}
        onUpdateImage={vi.fn()}
        onUpdateShape={vi.fn()}
        onUpdateText={vi.fn()}
        selectedImage={undefined}
        selectedShape={undefined}
        selectedText={{
          id: "text",
          kind: "text",
          xMm: 1,
          yMm: 1,
          widthMm: 10,
          heightMm: 5,
          rotationDeg: 0,
          text: "Label",
          fontFamily: "Avenir Next",
          fontSizePt: 12,
          fontWeight: 400,
          align: "left",
        }}
      />,
    );

    for (const name of [
      "Weight and style",
      "Horizontal alignment",
      "Vertical alignment",
      "Layer order",
    ]) {
      expect(screen.getByRole("group", { name })).toBeInTheDocument();
    }
    for (const label of ["WEIGHT & STYLE", "HORIZONTAL", "VERTICAL", "LAYER"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Regular" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
