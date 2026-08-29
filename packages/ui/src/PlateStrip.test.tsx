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
  vi.useRealTimers();
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
    readonly onRenamePlate?: (plateId: string, name: string) => void;
  } = {},
) {
  const onMovePlate = overrides.onMovePlate ?? vi.fn();
  const onRenamePlate = overrides.onRenamePlate ?? vi.fn();
  const result = render(
    <PlateStrip
      activePlateId="plate-resistors"
      marginBottomMm={undefined}
      marginTopMm={undefined}
      onAddPlate={vi.fn()}
      onDeletePlate={vi.fn()}
      onMovePlate={onMovePlate}
      onRenamePlate={onRenamePlate}
      onSelectPlate={vi.fn()}
      printHeadSizeMm={undefined}
      workspace={sampleDocument}
    />,
  );
  return { ...result, onMovePlate, onRenamePlate };
}

describe("PlateStrip", () => {
  it("renames a plate after a double click or keyboard action", () => {
    const onRenamePlate = vi.fn();
    renderStrip({ onRenamePlate });

    fireEvent.doubleClick(
      screen.getByRole("button", { name: "Rename label 1: Resistors" }),
    );
    const input = screen.getByLabelText("Label name");
    fireEvent.change(input, { target: { value: "Parts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRenamePlate).toHaveBeenCalledWith("plate-resistors", "Parts");
  });

  it("moves a plate as soon as the pointer starts to drag", () => {
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
      pointerType: "touch",
    });
    act(() => {
      dispatchPointer(source, "pointermove", {
        clientX: 275,
        clientY: 25,
        pointerId: 1,
        pointerType: "touch",
      });
    });
    expect(source).toHaveAttribute("aria-grabbed", "true");
    expect(
      Array.from(container.querySelectorAll(".thumb-name"), (name) =>
        name.textContent?.trim(),
      ),
    ).toEqual(["Capacitors", "Connectors", "Resistors"]);
    expect(
      container.querySelector(".plate-thumb.dragging .thumb-name"),
    ).toHaveTextContent("Resistors");
    dispatchPointer(source, "pointerup", {
      clientX: 275,
      clientY: 25,
      pointerId: 2,
      pointerType: "touch",
    });
    expect(source).toHaveAttribute("aria-grabbed", "true");
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

  it("renames the active label from one Phone name tap", () => {
    const onRenamePlate = vi.fn();
    render(
      <PlateStrip
        activePlateId="plate-resistors"
        marginBottomMm={undefined}
        marginTopMm={undefined}
        onAddPlate={vi.fn()}
        onDeletePlate={vi.fn()}
        onMovePlate={vi.fn()}
        onRenamePlate={onRenamePlate}
        onSelectPlate={vi.fn()}
        phoneMode
        printHeadSizeMm={undefined}
        workspace={sampleDocument}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Rename label 1: Resistors" }),
    );
    const input = screen.getByLabelText("Label name");
    fireEvent.change(input, { target: { value: "Parts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRenamePlate).toHaveBeenCalledWith("plate-resistors", "Parts");
  });
});
