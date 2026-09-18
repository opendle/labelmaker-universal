// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlateStrip } from "./PlateStrip.js";
import { sampleDocument } from "./sample.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function dispatchPointer(
  target: Element,
  type: string,
  properties: Record<string, unknown>,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(
    event,
    Object.fromEntries(
      Object.entries(properties).map(([name, value]) => [
        name,
        { configurable: true, value },
      ]),
    ),
  );
  target.dispatchEvent(event);
}

function renderStrip(
  overrides: {
    readonly onMovePlate?: (plateId: string, targetIndex: number) => void;
    readonly onSelectPlate?: (
      plateId: string,
      elementId: string | null,
    ) => void;
  } = {},
) {
  const onMovePlate = overrides.onMovePlate ?? vi.fn();
  const onSelectPlate = overrides.onSelectPlate ?? vi.fn();
  const result = render(
    <PlateStrip
      activePlateId="plate-resistors"
      onAddPlate={vi.fn()}
      onDeletePlate={vi.fn()}
      onMovePlate={onMovePlate}
      onSelectPlate={onSelectPlate}
      printHeadSizeMm={undefined}
      workspace={sampleDocument}
    />,
  );
  return { ...result, onMovePlate, onSelectPlate };
}

describe("PlateStrip", () => {
  it("does not show plate names", () => {
    const { container } = renderStrip();

    expect(container.querySelector(".thumb-name")).toBeNull();
    expect(screen.queryByLabelText("Label name")).toBeNull();
  });

  it("shows full thumbnail artwork without non-printable overlays", () => {
    const { container } = renderStrip();

    expect(container.querySelectorAll(".mini-label")).toHaveLength(3);
    expect(container.querySelector(".artwork-nonprintable")).toBeNull();
  });

  it.each([
    [16, 2, 12],
    [14, 1, 12],
    [12, 0, 12],
    [9, 0, 9],
  ])(
    "crops %s mm paper to the calculated head overlap",
    (heightMm, top, height) => {
      const workspace = {
        ...sampleDocument,
        plates: sampleDocument.plates.map((plate) => ({
          ...plate,
          size: { ...plate.size, heightMm },
        })),
      };
      const { container } = render(
        <PlateStrip
          activePlateId="plate-resistors"
          onAddPlate={vi.fn()}
          onDeletePlate={vi.fn()}
          onMovePlate={vi.fn()}
          onSelectPlate={vi.fn()}
          printHeadSizeMm={12}
          workspace={workspace}
        />,
      );
      const artwork = container.querySelector<HTMLElement>(".mini-label")!;
      const text = artwork.querySelector<HTMLElement>(".label-artwork-text")!;
      expect(artwork).toHaveStyle({ aspectRatio: String(62 / height) });
      expect(text.style.top).toBe(`${((3.2 - top) / height) * 100}%`);
      expect(text.style.height).toBe(`${(9.6 / height) * 100}%`);
      expect(artwork.querySelector(".nonprintable-zone")).toBeNull();
    },
  );

  it("shows minimum-width paper without stretching the thumbnail artwork", () => {
    const { container } = render(
      <PlateStrip
        activePlateId="plate-resistors"
        printHeadSizeMm={16}
        minimumLabelWidthMm={80}
        workspace={sampleDocument}
        onAddPlate={vi.fn()}
        onDeletePlate={vi.fn()}
        onMovePlate={vi.fn()}
        onSelectPlate={vi.fn()}
      />,
    );
    const thumbnail = container.querySelector<HTMLElement>(".plate-thumb")!;
    expect(thumbnail.style.getPropertyValue("--label-preview-width")).toBe(
      "260px",
    );
    expect(thumbnail.querySelector(".mini-label")).toHaveStyle({
      aspectRatio: "5",
    });
    expect(thumbnail.querySelector(".label-artwork-content")).toHaveStyle({
      width: "77.5%",
    });
  });

  it("remounts thumbnail paint nodes after the native app returns to the foreground", () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(globalThis.document, "visibilityState", "get").mockReturnValue(
      "hidden",
    );
    const { container } = renderStrip();
    const scroller = container.querySelector<HTMLElement>(".plate-thumbnails")!;
    const oldArtwork = container.querySelector<HTMLElement>(".mini-label")!;
    const oldDelete = screen.getByRole("button", {
      name: "Delete label Resistors",
    });
    scroller.scrollLeft = 37;

    fireEvent(globalThis.window, new Event("labelmaker:foreground"));

    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();

    const newArtwork = container.querySelector<HTMLElement>(".mini-label")!;
    const newDelete = screen.getByRole("button", {
      name: "Delete label Resistors",
    });
    expect(newArtwork).toBeVisible();
    expect(newDelete).toBeVisible();
    expect(newArtwork).not.toBe(oldArtwork);
    expect(newDelete).not.toBe(oldDelete);
    expect(scroller).toBe(container.querySelector(".plate-thumbnails"));
    expect(scroller.scrollLeft).toBe(37);
  });

  it("moves a plate as soon as a mouse pointer starts to drag", () => {
    const onMovePlate = vi.fn();
    const { container } = renderStrip({ onMovePlate });
    const plates = Array.from(
      container.querySelectorAll<HTMLElement>(".plate-thumb"),
    );
    plates.forEach((plate, index) => {
      plate.getBoundingClientRect = () =>
        ({
          left: index * 100,
          width: 100,
        }) as DOMRect;
    });
    const source = plates[0]!;

    dispatchPointer(source, "pointerdown", {
      button: 0,
      clientX: 25,
      clientY: 25,
      isPrimary: true,
      pointerId: 1,
      pointerType: "mouse",
    });
    act(() => {
      dispatchPointer(source, "pointermove", {
        clientX: 275,
        clientY: 25,
        pointerId: 1,
        pointerType: "mouse",
      });
    });
    expect(source).toHaveAttribute("aria-grabbed", "true");
    expect(
      Array.from(container.querySelectorAll(".plate-thumb-select"), (button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Select label 1: Capacitors",
      "Select label 2: Connectors",
      "Select label 3: Resistors",
    ]);
    expect(
      container
        .querySelector(".plate-thumb.dragging .plate-thumb-select")
        ?.getAttribute("aria-label"),
    ).toBe("Select label 3: Resistors");
    dispatchPointer(source, "pointerup", {
      clientX: 275,
      clientY: 25,
      pointerId: 2,
      pointerType: "mouse",
    });
    expect(source).toHaveAttribute("aria-grabbed", "true");
    dispatchPointer(source, "pointerup", {
      clientX: 275,
      clientY: 25,
      pointerId: 1,
      pointerType: "mouse",
    });

    expect(onMovePlate).toHaveBeenCalledWith("plate-resistors", 2);
  });

  it("lets a touch movement scroll before the reorder delay", () => {
    vi.useFakeTimers();
    const onMovePlate = vi.fn();
    const { container, onSelectPlate } = renderStrip({ onMovePlate });
    const source = container.querySelector<HTMLElement>(".plate-thumb")!;
    const scroller = container.querySelector<HTMLElement>(".plate-thumbnails")!;

    dispatchPointer(source, "pointerdown", {
      button: 0,
      clientX: 25,
      clientY: 25,
      isPrimary: true,
      pointerId: 1,
      pointerType: "touch",
    });
    dispatchPointer(source, "pointermove", {
      clientX: -25,
      clientY: 25,
      pointerId: 1,
      pointerType: "touch",
    });
    act(() => vi.advanceTimersByTime(425));
    dispatchPointer(source, "pointerup", {
      clientX: -25,
      clientY: 25,
      pointerId: 1,
      pointerType: "touch",
    });

    expect(source).toHaveAttribute("aria-grabbed", "false");
    expect(scroller.scrollLeft).toBe(50);
    expect(onMovePlate).not.toHaveBeenCalled();
    expect(onSelectPlate).not.toHaveBeenCalled();
  });

  it("reorders with touch after a long press", () => {
    vi.useFakeTimers();
    const onMovePlate = vi.fn();
    const { container, onSelectPlate } = renderStrip({ onMovePlate });
    const plates = Array.from(
      container.querySelectorAll<HTMLElement>(".plate-thumb"),
    );
    plates.forEach((plate, index) => {
      plate.getBoundingClientRect = () =>
        ({ left: index * 100, width: 100 }) as DOMRect;
    });
    const source = plates[0]!;

    dispatchPointer(source, "pointerdown", {
      button: 0,
      clientX: 25,
      clientY: 25,
      isPrimary: true,
      pointerId: 1,
      pointerType: "touch",
    });
    act(() => vi.advanceTimersByTime(425));
    expect(source).toHaveAttribute("aria-grabbed", "true");
    expect(onSelectPlate).toHaveBeenCalledWith("plate-resistors", null);
    act(() => {
      dispatchPointer(source, "pointermove", {
        clientX: 275,
        clientY: 25,
        pointerId: 1,
        pointerType: "touch",
      });
    });
    dispatchPointer(source, "pointerup", {
      clientX: 275,
      clientY: 25,
      pointerId: 1,
      pointerType: "touch",
    });

    expect(onMovePlate).toHaveBeenCalledWith("plate-resistors", 2);
  });

  it("does not move a plate when the pointer does not travel", () => {
    const onMovePlate = vi.fn();
    const { container } = renderStrip({ onMovePlate });
    const source = container.querySelector<HTMLElement>(".plate-thumb")!;

    dispatchPointer(source, "pointerdown", {
      button: 0,
      clientX: 25,
      clientY: 25,
      isPrimary: true,
      pointerId: 1,
      pointerType: "touch",
    });
    dispatchPointer(source, "pointerup", {
      clientX: 25,
      clientY: 25,
      pointerId: 1,
      pointerType: "touch",
    });

    expect(onMovePlate).not.toHaveBeenCalled();
    expect(source).toHaveAttribute("aria-grabbed", "false");
  });

  it("moves a focused plate with Alt and an arrow key", () => {
    const onMovePlate = vi.fn();
    renderStrip({ onMovePlate });

    fireEvent.keyDown(
      screen.getByRole("button", { name: "Select label 2: Capacitors" }),
      { altKey: true, key: "ArrowLeft" },
    );

    expect(onMovePlate).toHaveBeenCalledWith("plate-capacitors", 0);
  });

  it("selects a label from one Phone thumbnail tap", () => {
    const onSelectPlate = vi.fn();
    render(
      <PlateStrip
        activePlateId="plate-resistors"
        onAddPlate={vi.fn()}
        onDeletePlate={vi.fn()}
        onMovePlate={vi.fn()}
        onSelectPlate={onSelectPlate}
        printHeadSizeMm={undefined}
        phoneMode
        workspace={sampleDocument}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Select label 1: Resistors" }),
    );

    expect(onSelectPlate).toHaveBeenCalledWith("plate-resistors", null);
  });

  it("does not show label delete buttons in Phone mode", () => {
    render(
      <PlateStrip
        activePlateId="plate-resistors"
        onAddPlate={vi.fn()}
        onDeletePlate={vi.fn()}
        onMovePlate={vi.fn()}
        onSelectPlate={vi.fn()}
        printHeadSizeMm={undefined}
        phoneMode
        workspace={sampleDocument}
      />,
    );

    expect(screen.queryByRole("button", { name: /Delete label/ })).toBeNull();
  });
});
