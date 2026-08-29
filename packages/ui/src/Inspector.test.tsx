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

    const checkbox = screen.getByRole("checkbox", {
      name: "Transparent image background",
    });
    expect(checkbox).toBeChecked();
    expect(checkbox.closest(".image-fit-row")).toContainElement(
      screen.getByRole("combobox", { name: "Image fit" }),
    );

    await user.click(checkbox);

    expect(onUpdateImage).toHaveBeenCalledWith({
      ...image,
      transparentBackground: false,
    });
  });
});
