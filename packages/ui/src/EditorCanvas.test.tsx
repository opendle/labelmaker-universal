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
    onChangeElementDuringInteraction: vi.fn(),
    onDeleteSelection: vi.fn(),
    onDraw: vi.fn(),
    onEditImage: vi.fn(),
    onElementInteractionEnd: vi.fn(),
    onElementInteractionStart: vi.fn(),
    onOpenElementProperties: vi.fn(),
    onOpenIcons: vi.fn(),
    onOpenPlateSettings: vi.fn(),
    onSelectElement: vi.fn(),
    onUpdatePlate: vi.fn(),
    onZoom: vi.fn(),
    plate,
    platform: "linux",
    presentation: "desktop",
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
  it.each([
    [
      0,
      [
        [-55, 1],
        [25, 1],
        [25, 15],
        [-55, 15],
      ],
    ],
    [
      90,
      [
        [1, 65],
        [1, -15],
        [15, -15],
        [15, 65],
      ],
    ],
  ] as const)(
    "clips artwork to the printable rectangle at %s degrees",
    (rotationDeg, corners) => {
      const element = { ...textElement, xMm: 55, widthMm: 10, rotationDeg };
      const props = createProps({
        minimumLabelWidthMm: 80,
        printableMargins: { topMm: 3, bottomMm: 3 },
        zoom: 150,
        selectedElementId: element.id,
        plate: { ...plate, elements: [element] },
      });
      const { container } = render(<EditorCanvas {...props} />);
      const control = screen.getByRole("button", {
        name: "Text element: SELECT ALL",
      });
      const coordinates = control.style.clipPath.match(/-?[\d.e+-]+(?=px)/g);
      expect(coordinates).toHaveLength(8);
      corners.flat().forEach((value, index) => {
        expect(Number(coordinates![index])).toBeCloseTo(value * 13.5);
      });
      expect(
        container.querySelector<HTMLElement>(".canvas-element")!.style.clipPath,
      ).toBe("");
      expect(
        screen.getByRole("button", { name: "Resize text block se" }),
      ).not.toHaveStyle({ clipPath: control.style.clipPath });
      const clipPath = control.style.clipPath;
      fireEvent.doubleClick(control);
      expect(
        screen.getByRole("textbox", { name: "Edit text on label" })
          .parentElement!.style.clipPath,
      ).toBe(clipPath);
    },
  );
  it.each([
    ["move", "Text element: SELECT ALL"],
    ["resize", "Resize text block se"],
  ])("uses the visible width for pointer %s and snapping", (kind, name) => {
    const element = { ...textElement, xMm: 5, widthMm: 10 };
    const props = createProps({
      minimumLabelWidthMm: 80,
      selectedElementId: element.id,
      selectedText: element,
      plate: { ...plate, elements: [element] },
    });
    render(<EditorCanvas {...props} />);
    const canvas = screen.getByRole("region", { name: "Plate label canvas" });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 720,
      bottom: 180,
      width: 720,
      height: 180,
      toJSON: () => ({}),
    });
    const pointer = (type: string, x: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: 50,
      });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };
    fireEvent(
      screen.getByRole("button", { name }),
      pointer("pointerdown", 135),
    );
    fireEvent(window, pointer("pointermove", 315));
    expect(props.onChangeElementDuringInteraction).toHaveBeenLastCalledWith({
      ...element,
      ...(kind === "move" ? { xMm: 25 } : { widthMm: 30 }),
    });
    // The right edge is within 6 pixels of the full 80 mm label end.
    fireEvent(window, pointer("pointermove", 717));
    expect(props.onChangeElementDuringInteraction).toHaveBeenLastCalledWith({
      ...element,
      ...(kind === "move" ? { xMm: 70 } : { widthMm: 75 }),
    });
    expect(canvas).toHaveAttribute("data-plate-width-mm", "80");
    expect(props.onUpdatePlate).not.toHaveBeenCalled();
    fireEvent(window, pointer("pointerup", 717));
    expect(props.onElementInteractionEnd).toHaveBeenCalledOnce();
  });

  it.each([
    "Text element: SELECT ALL",
    "Resize text block se",
    "Rotate text block",
  ])("ends %s when the active plate changes", (name) => {
    const props = createProps({
      selectedElementId: textElement.id,
      selectedText: textElement,
    });
    const { rerender, unmount } = render(<EditorCanvas {...props} />);
    const canvas = screen.getByRole("region", { name: "Plate label canvas" });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 200,
      width: 600,
      height: 200,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(screen.getByRole("button", { name }), {
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 1,
    });
    expect(props.onElementInteractionStart).toHaveBeenCalledOnce();

    rerender(
      <EditorCanvas {...props} plate={{ ...plate, id: "another-plate" }} />,
    );
    expect(props.onElementInteractionEnd).toHaveBeenCalledOnce();
    fireEvent.pointerMove(window, { clientX: 30, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(props.onChangeElementDuringInteraction).not.toHaveBeenCalled();
    expect(props.onElementInteractionEnd).toHaveBeenCalledOnce();

    fireEvent.pointerDown(screen.getByRole("button", { name }), {
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 2,
    });
    unmount();
    expect(props.onElementInteractionEnd).toHaveBeenCalledTimes(2);
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40, pointerId: 2 });
    expect(props.onChangeElementDuringInteraction).not.toHaveBeenCalled();
  });

  it("shows the printer minimum width without changing the saved plate", () => {
    const props = createProps({ minimumLabelWidthMm: 80 });
    const { container, rerender } = render(<EditorCanvas {...props} />);
    expect(container.querySelector(".label-canvas")).toHaveAttribute(
      "data-plate-width-mm",
      "80",
    );
    expect(
      (
        container.querySelector(".canvas-element") as HTMLElement
      ).style.getPropertyValue("--element-width"),
    ).toBe("62.5%");
    expect(props.plate.size.widthMm).toBe(60);
    expect(props.onUpdatePlate).not.toHaveBeenCalled();
    rerender(<EditorCanvas {...props} minimumLabelWidthMm={0} />);
    expect(container.querySelector(".label-canvas")).toHaveAttribute(
      "data-plate-width-mm",
      "60",
    );
  });
  it("edits height and zero margins on the canvas without starting a gesture", () => {
    const props = createProps();
    const { container } = render(<EditorCanvas {...props} />);
    expect(
      container.querySelector(".editor-toolbar input[type=number]"),
    ).toBeNull();

    for (const name of ["Plate height", "Left margin", "Right margin"]) {
      const input = screen.getByRole("spinbutton", {
        name,
      }) as HTMLInputElement;
      expect(input.closest(".dimension-ruler")).not.toBeNull();
      const select = vi.spyOn(input, "select");
      fireEvent.pointerDown(input, { pointerId: 1, pointerType: "touch" });
      input.focus();
      expect(select).toHaveBeenCalled();
      fireEvent.keyDown(input, { key: "Enter" });
      expect(input).not.toHaveFocus();
    }
    expect(props.onSelectElement).not.toHaveBeenCalled();
    expect(props.onZoom).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Plate height"), {
      target: { value: "24" },
    });
    expect(props.onUpdatePlate).toHaveBeenLastCalledWith({
      ...plate,
      size: { ...plate.size, heightMm: 24 },
      elements: [{ ...textElement, yMm: 4 }],
    });
    fireEvent.change(screen.getByLabelText("Left margin"), {
      target: { value: "2.5" },
    });
    expect(props.onUpdatePlate).toHaveBeenLastCalledWith({
      ...plate,
      margins: { leftMm: 2.5, rightMm: 0 },
    });
    fireEvent.change(screen.getByLabelText("Right margin"), {
      target: { value: "-2" },
    });
    expect(props.onUpdatePlate).toHaveBeenLastCalledWith(plate);
  });

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

  it("keeps entered line breaks when a narrow text frame is edited", () => {
    const narrowText = {
      ...textElement,
      widthMm: 4,
      text: "A long line of text\nSecond line\n",
    };
    const props = createProps({ plate: { ...plate, elements: [narrowText] } });
    render(<EditorCanvas {...props} />);
    fireEvent.doubleClick(
      screen.getByRole("button", {
        name: /Text element: A long line of text/,
      }),
    );
    const editor = screen.getByRole("textbox", { name: "Edit text on label" });
    expect(editor).toHaveAttribute("wrap", "off");
    expect(editor).toHaveValue(narrowText.text);
    fireEvent.change(editor, {
      target: { value: `${narrowText.text}Third line` },
    });
    expect(props.onChangeElement).toHaveBeenCalledWith({
      ...narrowText,
      text: `${narrowText.text}Third line`,
    });
  });

  it("keeps a final empty line in the non-edit canvas layout", () => {
    const trailingLine = { ...textElement, text: "LINE 1\n" };
    const { container } = render(
      <EditorCanvas
        {...createProps({
          plate: { ...plate, elements: [trailingLine] },
        })}
      />,
    );

    expect(
      container.querySelector(".canvas-text .inline-text-editor")?.textContent,
    ).toBe("LINE 1\n\u200b");
  });

  it("clears browser selection when inline edit ends", () => {
    const removeAllRanges = vi.fn();
    vi.spyOn(globalThis.document, "getSelection").mockReturnValue({
      removeAllRanges,
    } as unknown as Selection);
    render(<EditorCanvas {...createProps()} />);
    fireEvent.doubleClick(
      screen.getByRole("button", { name: "Text element: SELECT ALL" }),
    );

    fireEvent.blur(screen.getByRole("textbox", { name: "Edit text on label" }));

    expect(removeAllRanges).toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", { name: "Edit text on label" }),
    ).toBeNull();
  });

  it.each([
    ["move", "Text element: SELECT ALL"],
    ["resize", "Resize text block se"],
    ["rotation", "Rotate text block"],
  ])("reports the start and end of a pointer %s", (_kind, controlName) => {
    const onChangeElementDuringInteraction = vi.fn();
    const onElementInteractionStart = vi.fn();
    const onElementInteractionEnd = vi.fn();
    render(
      <EditorCanvas
        {...createProps({
          onChangeElementDuringInteraction,
          onElementInteractionEnd,
          onElementInteractionStart,
          selectedElementId: textElement.id,
          selectedText: textElement,
        })}
      />,
    );
    const canvas = screen.getByRole("region", { name: "Plate label canvas" });
    const frame = screen
      .getByRole("button", { name: "Text element: SELECT ALL" })
      .closest<HTMLElement>(".canvas-element")!;
    const bounds = {
      bottom: 200,
      height: 200,
      left: 0,
      right: 600,
      top: 0,
      width: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(bounds);
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(bounds);
    const control = screen.getByRole("button", { name: controlName });

    fireEvent.pointerDown(control, {
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, {
      clientX: 30,
      clientY: 30,
      pointerId: 1,
    });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(onElementInteractionStart).toHaveBeenCalledOnce();
    expect(onChangeElementDuringInteraction).toHaveBeenCalledOnce();
    expect(onElementInteractionEnd).toHaveBeenCalledOnce();
  });

  it("keeps wheel zoom without an on-screen zoom control", () => {
    const onZoom = vi.fn();
    const { container } = render(<EditorCanvas {...createProps({ onZoom })} />);

    expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Zoom out" })).toBeNull();
    fireEvent.wheel(container.querySelector(".work-surface")!, {
      deltaMode: 1,
      deltaY: -1,
    });
    expect(onZoom).toHaveBeenCalledWith(110);
  });
});

it("uses smaller scroll steps on a mobile trackpad and ignores horizontal scroll", () => {
  const onZoom = vi.fn();
  const { container } = render(
    <EditorCanvas {...createProps({ onZoom, presentation: "mobile-touch" })} />,
  );
  const surface = container.querySelector(".work-surface")!;
  fireEvent.wheel(surface, { deltaY: -2, deltaMode: 0 });
  expect(onZoom).toHaveBeenLastCalledWith(100.3);
  fireEvent.wheel(surface, { deltaX: 10, deltaY: 0 });
  expect(onZoom).toHaveBeenCalledTimes(1);
});

it("keeps desktop mouse wheel steps for small pixel deltas", () => {
  const onZoom = vi.fn();
  const { container } = render(<EditorCanvas {...createProps({ onZoom })} />);
  fireEvent.wheel(container.querySelector(".work-surface")!, {
    deltaY: -2,
    deltaMode: 0,
  });
  expect(onZoom).toHaveBeenCalledWith(110);
});

it("does not scroll the work surface when an element receives pointer focus", () => {
  render(<EditorCanvas {...createProps({ presentation: "mobile-touch" })} />);
  const element = screen.getByRole("button", {
    name: "Text element: SELECT ALL",
  });
  const focus = vi.spyOn(element, "focus");
  fireEvent.pointerDown(element, { pointerId: 1, pointerType: "touch" });
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});

it("supports trackpad pinch through wheel and WebKit scale events", () => {
  const onZoom = vi.fn();
  const { container } = render(<EditorCanvas {...createProps({ onZoom })} />);
  const surface = container.querySelector(".work-surface")!;
  fireEvent.wheel(surface, { deltaY: -10, ctrlKey: true });
  expect(onZoom.mock.lastCall?.[0]).toBeCloseTo(100 * Math.exp(0.1));
  const gesture = (name: string, scale: number) => {
    const event = new Event(name, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "scale", { value: scale });
    fireEvent(surface, event);
    return event;
  };
  expect(gesture("gesturestart", 1).defaultPrevented).toBe(true);
  gesture("gesturechange", 1.5);
  expect(onZoom.mock.lastCall?.[0]).toBeCloseTo(150 * Math.exp(0.1));
  fireEvent.wheel(surface, { deltaY: -10, ctrlKey: true });
  expect(onZoom).toHaveBeenCalledTimes(2);
  gesture("gesturechange", 8);
  expect(onZoom).toHaveBeenLastCalledWith(300);
  gesture("gestureend", 8);
  fireEvent.wheel(surface, { deltaY: 1, deltaMode: 1 });
  expect(onZoom).toHaveBeenLastCalledWith(290);
});

it("does not apply WebKit pinch a second time for touch pointers", () => {
  const onZoom = vi.fn();
  const { container } = render(
    <EditorCanvas {...createProps({ onZoom, presentation: "mobile-touch" })} />,
  );
  const surface = container.querySelector(".work-surface")!;
  const pointer = new Event("pointerdown", { bubbles: true });
  Object.assign(pointer, { pointerType: "touch", pointerId: 5 });
  fireEvent(surface, pointer);
  fireEvent(surface, new Event("gesturestart", { bubbles: true }));
  const change = new Event("gesturechange", { bubbles: true });
  Object.assign(change, { scale: 1.5 });
  fireEvent(surface, change);
  expect(onZoom).not.toHaveBeenCalled();
});

it.each(["desktop", "mobile-touch"] as const)(
  "rotates from the %s handle position without a half turn",
  (presentation) => {
    const props = createProps({
      presentation,
      selectedElementId: textElement.id,
      selectedText: textElement,
    });
    render(<EditorCanvas {...props} />);
    const handle = screen.getByRole("button", { name: "Rotate text block" });
    vi.spyOn(handle.parentElement!, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 40),
    );
    const pointer = (name: string, x: number, y: number) => {
      const event = new MouseEvent(name, {
        bubbles: true,
        clientX: x,
        clientY: y,
      });
      Object.assign(event, { pointerId: 1, pointerType: "mouse" });
      return event;
    };
    const y = presentation === "mobile-touch" ? 70 : -30;
    fireEvent(handle, pointer("pointerdown", 50, y));
    fireEvent(window, pointer("pointermove", 50, y));
    expect(props.onChangeElementDuringInteraction).toHaveBeenLastCalledWith(
      expect.objectContaining({ rotationDeg: 0 }),
    );
    fireEvent(window, pointer("pointermove", 100, 20));
    expect(props.onChangeElementDuringInteraction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rotationDeg: presentation === "mobile-touch" ? 270 : 90,
      }),
    );
    fireEvent(window, pointer("pointerup", 100, 20));
  },
);
