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

import { IconLibraryDialog } from "./IconLibraryDialog.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDialog(onAdd = vi.fn()) {
  render(
    <>
      <div className="application-content" />
      <IconLibraryDialog onAdd={onAdd} onClose={vi.fn()} />
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
