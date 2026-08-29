// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IconCatalogEntry } from "./icon-catalog.js";
import { IconLibraryDialog } from "./IconLibraryDialog.js";

const testIconNames = [
  "AArrowDown",
  "Accessibility",
  "AirVent",
  "AlarmClock",
  "AlarmClockCheck",
  "AlarmClockMinus",
  "CircleStar",
  "MoonStar",
  "SquareStar",
  "Star",
  "StarHalf",
  "StarOff",
  "UserStar",
  "ZoomIn",
  "ZoomOut",
] as const;
const iconLabel = (name: string) =>
  name
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
const testIcons: readonly IconCatalogEntry[] = testIconNames.map((name) => ({
  name,
  label: iconLabel(name),
  node: [["circle", { cx: "12", cy: "12", r: "8", key: name }]],
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDialog(onAdd = vi.fn()) {
  render(
    <>
      <div className="application-content" />
      <IconLibraryDialog icons={testIcons} onAdd={onAdd} onClose={vi.fn()} />
    </>,
  );
  return onAdd;
}

describe("IconLibraryDialog", () => {
  it("focuses search, filters at once, and selects the first result", () => {
    renderDialog();
    const search = screen.getByRole("searchbox", { name: "Search icons" });

    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "air vent" } });

    const airVent = screen.getByRole("button", { name: "Air Vent" });
    expect(airVent).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("1 icon")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("keeps the dialog usable when the lazy catalog cannot open", () => {
    render(
      <>
        <div className="application-content" />
        <IconLibraryDialog icons={[]} onAdd={vi.fn()} onClose={vi.fn()} />
      </>,
    );

    expect(screen.getByText("The icon library could not open.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Add icon" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Close icon library" }),
    ).toBeEnabled();
  });

  it("keeps search focused and selects the first icon after loading", () => {
    const onAdd = vi.fn();
    const view = render(
      <>
        <div className="application-content" />
        <IconLibraryDialog icons={[]} loading onAdd={onAdd} onClose={vi.fn()} />
      </>,
    );
    const search = screen.getByRole("searchbox", { name: "Search icons" });
    expect(search).toHaveFocus();
    expect(screen.getByText("Loading icons…")).toBeVisible();

    view.rerender(
      <>
        <div className="application-content" />
        <IconLibraryDialog icons={testIcons} onAdd={onAdd} onClose={vi.fn()} />
      </>,
    );

    expect(search).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "A Arrow Down" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Add icon" }));
    expect(onAdd).toHaveBeenCalledWith("AArrowDown");
  });

  it("moves between search and results and adds the selected result with Enter", async () => {
    const user = userEvent.setup();
    const onAdd = renderDialog();
    const search = screen.getByRole("searchbox", { name: "Search icons" });
    await user.type(search, "alarm clock");
    await user.keyboard("{ArrowDown}");

    const iconButtons = within(
      screen.getByRole("list", { name: "Icons" }),
    ).getAllByRole("button");
    const first = iconButtons[0]!;
    expect(first).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    const second = iconButtons[1]!;
    expect(second).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onAdd).toHaveBeenCalledWith("AlarmClockCheck");

    await user.keyboard("{ArrowLeft}{ArrowUp}");
    expect(search).toHaveFocus();
  });

  it("adds the first filtered icon with Enter from search", async () => {
    const user = userEvent.setup();
    const onAdd = renderDialog();
    const search = screen.getByRole("searchbox", { name: "Search icons" });
    await user.type(search, "accessibility{Enter}");

    expect(onAdd).toHaveBeenCalledWith("Accessibility");
  });

  it("moves Arrow Up and Arrow Down between visual rows", async () => {
    const user = userEvent.setup();
    renderDialog();
    const search = screen.getByRole("searchbox", { name: "Search icons" });
    await user.type(search, "star");
    const list = screen.getByRole("list", { name: "Icons" });
    Object.defineProperty(list, "clientWidth", {
      configurable: true,
      value: 272,
    });
    const iconButtons = within(list).getAllByRole("button");

    await user.keyboard("{ArrowDown}");
    expect(iconButtons[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(iconButtons[3]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(iconButtons[0]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(search).toHaveFocus();
  });

  it("supports click selection, the Add icon action, and double click", async () => {
    const user = userEvent.setup();
    const onAdd = renderDialog();
    const search = screen.getByRole("searchbox", { name: "Search icons" });
    await user.type(search, "zoom");
    const zoomOut = screen.getByRole("button", { name: "Zoom Out" });

    await user.click(zoomOut);
    await user.click(screen.getByRole("button", { name: "Add icon" }));
    expect(onAdd).toHaveBeenLastCalledWith("ZoomOut");

    await user.dblClick(zoomOut);
    expect(onAdd).toHaveBeenLastCalledWith("ZoomOut");
    expect(onAdd).toHaveBeenCalledTimes(2);
  });
});
