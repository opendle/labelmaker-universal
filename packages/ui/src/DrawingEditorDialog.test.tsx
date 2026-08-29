// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DrawingEditorDialog } from "./DrawingEditorDialog.js";
import { EditorCanvas } from "./EditorCanvas.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DrawingEditorDialog", () => {
  it("offers pen and eraser tools and saves exact visible bounds", async () => {
    const user = userEvent.setup();
    let pixels = new Uint8ClampedArray(240 * 120 * 4).fill(255);
    const context = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      createImageData: vi.fn((width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      })),
      fill: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({ data: pixels })),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      putImageData: vi.fn(),
      stroke: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(
      function (this: HTMLCanvasElement) {
        return this.width === 240
          ? "data:image/png;base64,full-drawing"
          : "data:image/png;base64,cropped-drawing";
      },
    );
    const onSave = vi.fn();
    render(
      <>
        <div className="application-content" />
        <DrawingEditorDialog onClose={vi.fn()} onSave={onSave} />
      </>,
    );

    expect(screen.getByRole("button", { name: "Pen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByText(/Use the pointer/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Eraser" }));
    expect(screen.getByRole("button", { name: "Eraser" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Add drawing" }));
    expect(screen.getByText("Draw something before you save.")).toBeVisible();

    pixels = new Uint8ClampedArray(240 * 120 * 4).fill(255);
    const offset = (20 * 240 + 10) * 4;
    pixels[offset] = 0;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
    pixels[offset + 3] = 255;
    fireEvent.keyDown(screen.getByLabelText("Drawing canvas"), {
      key: "Enter",
    });

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "data:image/png;base64,cropped-drawing",
        widthPixels: 1,
        heightPixels: 1,
        bounds: { left: 10, top: 20, right: 10, bottom: 20 },
        editorSource: {
          source: "data:image/png;base64,full-drawing",
          widthPixels: 240,
          heightPixels: 120,
          bounds: { left: 10, top: 20, right: 10, bottom: 20 },
        },
      }),
    );
  });
});

describe("EditorCanvas drawing actions", () => {
  const image = {
    id: "image",
    kind: "image" as const,
    xMm: 10,
    yMm: 2,
    widthMm: 20,
    heightMm: 10,
    rotationDeg: 0,
    source: "data:image/png;base64,image",
    fit: "contain" as const,
    brightness: 128,
    contrast: 128,
  };
  const plate = {
    id: "plate",
    name: "Plate",
    size: { widthMm: 60, heightMm: 20 },
    margins: { leftMm: 0, rightMm: 0 },
    elements: [image],
  };

  it("opens a new drawing and sends an image for double-click editing", () => {
    const onDraw = vi.fn();
    const onEditImage = vi.fn();
    render(
      <EditorCanvas
        layout="standard"
        onAddImage={vi.fn()}
        onAddShape={vi.fn()}
        onAddSpecial={vi.fn()}
        onAddText={vi.fn()}
        onChangeElement={vi.fn()}
        onDraw={onDraw}
        onOpenIcons={vi.fn()}
        onOpenElementProperties={vi.fn()}
        onOpenPlateSettings={vi.fn()}
        onEditImage={onEditImage}
        onDeleteSelection={vi.fn()}
        onSelectElement={vi.fn()}
        onTrim={vi.fn()}
        onUpdatePlate={vi.fn()}
        onZoom={vi.fn()}
        plate={plate}
        platform="linux"
        printableMargins={{ topMm: 0, bottomMm: 0 }}
        selectedElementId={null}
        selectedImage={undefined}
        selectedShape={undefined}
        selectedText={undefined}
        zoom={100}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Draw" }));
    fireEvent.doubleClick(
      screen.getByRole("button", { name: "Image element" }),
    );

    expect(onDraw).toHaveBeenCalledOnce();
    expect(onEditImage).toHaveBeenCalledWith(image);
  });
});
