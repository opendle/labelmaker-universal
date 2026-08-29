// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Inspector } from "./Inspector.js";

describe("inspector controls", () => {
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
    for (const label of [
      "Image width",
      "Image height",
      "Image X position",
      "Image Y position",
      "Image rotation",
    ]) {
      expect(screen.getByLabelText(label)).not.toBeVisible();
    }

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
    for (const label of [
      "Text frame width",
      "Text frame height",
      "X position",
      "Y position",
      "Text frame rotation",
    ]) {
      expect(screen.getByLabelText(label)).not.toBeVisible();
    }
  });

  it("keeps shape geometry visible and snaps rotation near 45-degree angles", () => {
    const onUpdateShape = vi.fn();
    const shape = {
      id: "shape",
      kind: "rectangle" as const,
      shapeType: "rectangle" as const,
      xMm: 1,
      yMm: 1,
      widthMm: 10,
      heightMm: 5,
      rotationDeg: 0,
      strokeWidthMm: 0.5,
      filled: false,
      cornerRadiusMm: 0,
    };
    render(
      <Inspector
        hasMultipleElements={false}
        onDeleteSelection={vi.fn()}
        onMoveLayer={vi.fn()}
        onUpdateImage={vi.fn()}
        onUpdateShape={onUpdateShape}
        onUpdateText={vi.fn()}
        selectedImage={undefined}
        selectedShape={shape}
        selectedText={undefined}
      />,
    );

    expect(screen.getByLabelText("Shape width")).toBeVisible();
    const rotation = screen.getByLabelText("Shape rotation");
    expect(rotation).toBeVisible();
    expect(rotation).toHaveAttribute("step", "1");

    fireEvent.change(rotation, { target: { value: "68" } });

    expect(onUpdateShape).toHaveBeenCalledWith({
      ...shape,
      rotationDeg: 68,
    });

    fireEvent.change(rotation, { target: { value: "88" } });

    expect(onUpdateShape).toHaveBeenLastCalledWith({
      ...shape,
      rotationDeg: 90,
    });
  });
});
