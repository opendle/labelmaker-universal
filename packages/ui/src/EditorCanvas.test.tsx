// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type { LabelPlate, TextElement } from "@labelmaker/domain";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorCanvas } from "./EditorCanvas.js";

afterEach(cleanup);

const textElement: TextElement = {
  id: "text",
  kind: "text",
  xMm: 5,
  yMm: 2,
  widthMm: 50,
  heightMm: 10,
  rotationDeg: 0,
  text: "SELECT ALL",
  fontFamily: "sans-serif",
  fontSizePt: 16,
  fontWeight: 400,
  align: "right",
};

const plate: LabelPlate = {
  id: "plate",
  name: "Plate",
  size: { widthMm: 60, heightMm: 20 },
  margins: { leftMm: 0, rightMm: 0 },
  elements: [textElement],
};

function createProps(
  overrides: Partial<ComponentProps<typeof EditorCanvas>> = {},
): ComponentProps<typeof EditorCanvas> {
  return {
    layout: "standard",
    onAddImage: vi.fn(),
    onAddShape: vi.fn(),
    onAddSpecial: vi.fn(),
    onAddText: vi.fn(),
    onChangeElement: vi.fn(),
    onDeleteSelection: vi.fn(),
    onDraw: vi.fn(),
    onEditImage: vi.fn(),
    onOpenElementProperties: vi.fn(),
    onOpenIcons: vi.fn(),
    onOpenPlateSettings: vi.fn(),
    onSelectElement: vi.fn(),
    onTrim: vi.fn(),
    onUpdatePlate: vi.fn(),
    onZoom: vi.fn(),
    plate,
    platform: "linux",
    printableMargins: { topMm: 0, bottomMm: 0 },
    selectedElementId: null,
    selectedImage: undefined,
    selectedShape: undefined,
    selectedText: undefined,
    zoom: 100,
    ...overrides,
  };
}

describe("EditorCanvas", () => {
  it("applies horizontal text alignment to the canvas display", () => {
    render(<EditorCanvas {...createProps()} />);

    expect(
      screen.getByRole("button", { name: "Text element: SELECT ALL" }),
    ).toHaveStyle({ textAlign: "right" });
  });

  it("selects all text when a double click starts inline editing", () => {
    render(<EditorCanvas {...createProps()} />);

    fireEvent.doubleClick(
      screen.getByRole("button", { name: "Text element: SELECT ALL" }),
    );

    const editor = screen.getByRole("textbox", {
      name: "Edit text on label",
    }) as HTMLTextAreaElement;
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe(0);
    expect(editor.selectionEnd).toBe(textElement.text.length);
  });

  it("keeps wheel zoom without an on-screen zoom control", () => {
    const onZoom = vi.fn();
    const { container } = render(<EditorCanvas {...createProps({ onZoom })} />);

    expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Zoom out" })).toBeNull();
    fireEvent.wheel(container.querySelector(".work-surface")!, {
      deltaY: -1,
    });
    expect(onZoom).toHaveBeenCalledWith(110);
  });
});
