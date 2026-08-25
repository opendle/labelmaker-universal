// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LabelmakerHost } from "./host.js";
import { LabelmakerApp } from "./LabelmakerApp.js";
import { sampleDocument } from "./sample.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function createHost(overrides: Partial<LabelmakerHost> = {}): LabelmakerHost {
  return {
    platform: "linux",
    listPrinters: vi.fn().mockResolvedValue([
      {
        id: "mock-studio",
        adapterId: "mock",
        name: "Studio Labeler",
        model: "MakeID E1 · Mock adapter",
        transport: "mock",
        state: "ready",
        statusMessage: "Ready",
        batteryPercent: 82,
      },
    ]),
    discoverPrinters: vi.fn().mockResolvedValue([
      {
        id: "mock-workshop",
        adapterId: "mock",
        name: "Workshop Printer",
        model: "Universal 96 · Mock adapter",
        transport: "mock",
        state: "disconnected",
        statusMessage: "Printer is offline",
      },
    ]),
    addPrinter: vi.fn().mockResolvedValue([]),
    newWorkspace: vi.fn().mockResolvedValue({
      status: "created",
      document: {
        ...sampleDocument,
        id: "new-workspace",
        name: "Untitled workspace",
      },
    }),
    openWorkspace: vi.fn().mockResolvedValue({
      status: "opened",
      document: {
        ...sampleDocument,
        id: "opened-workspace",
        name: "Opened workspace",
      },
      fileName: "opened.lbl",
    }),
    saveWorkspace: vi.fn().mockResolvedValue({
      status: "saved",
      savedAt: "2026-08-25T00:00:00Z",
      fileName: "workshop.lbl",
    }),
    saveWorkspaceAs: vi.fn().mockResolvedValue({
      status: "saved",
      savedAt: "2026-08-25T00:00:00Z",
      fileName: "workshop-copy.lbl",
    }),
    print: vi
      .fn()
      .mockResolvedValue({ message: "1 label sent to Studio Labeler" }),
    ...overrides,
  };
}

describe("LabelmakerApp", () => {
  it("shows the configured printer and adds a plate", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);

    expect(await screen.findByText("Studio Labeler")).toBeInTheDocument();
    expect(screen.getByText("3 labels")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add plate" }));

    expect(screen.getByText("4 labels")).toBeInTheDocument();
    expect(screen.getByLabelText("Plate name")).toHaveValue("Plate 4");
    expect(screen.getByText("Plate 4")).toBeInTheDocument();
    expect(screen.getByText("Edited")).toBeInTheDocument();
  });

  it("edits text and saves through the host interface", async () => {
    const host = createHost();
    const user = userEvent.setup();
    render(<LabelmakerApp host={host} />);

    await user.click(
      screen.getByRole("button", { name: "Text element: RESISTORS" }),
    );
    const content = screen.getByRole("textbox", { name: "Edit text on label" });
    fireEvent.change(content, { target: { value: "FASTENERS" } });
    fireEvent.blur(content);
    expect(
      screen.getByLabelText("Text element: FASTENERS"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(host.saveWorkspace).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("Saved workshop.lbl");
  });

  it("edits multiline text on the label and applies visible text styles", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);

    await user.click(
      screen.getByRole("button", { name: "Text element: RESISTORS" }),
    );
    const editor = screen.getByRole("textbox", { name: "Edit text on label" });
    const elementFrame = editor.closest<HTMLElement>(".canvas-element")!;
    const originalStyle = {
      family: elementFrame.style.getPropertyValue("--element-font-family"),
      size: elementFrame.style.getPropertyValue("--element-font-size"),
      weight: elementFrame.style.getPropertyValue("--element-font-weight"),
      justify: elementFrame.style.getPropertyValue("--element-justify"),
      rotation: elementFrame.style.getPropertyValue("--element-rotation"),
    };
    fireEvent.change(editor, { target: { value: "LINE 1\nLINE 2" } });
    fireEvent.pointerDown(document.body);
    expect(
      screen.queryByRole("textbox", { name: "Edit text on label" }),
    ).not.toBeInTheDocument();

    const element = screen.getByRole("button", {
      name: "Text element: LINE 1\nLINE 2",
    });
    const updatedFrame = element.closest<HTMLElement>(".canvas-element")!;
    expect(originalStyle).toEqual({
      family: updatedFrame.style.getPropertyValue("--element-font-family"),
      size: updatedFrame.style.getPropertyValue("--element-font-size"),
      weight: updatedFrame.style.getPropertyValue("--element-font-weight"),
      justify: updatedFrame.style.getPropertyValue("--element-justify"),
      rotation: updatedFrame.style.getPropertyValue("--element-rotation"),
    });
    await user.selectOptions(screen.getByLabelText("Typeface"), "Georgia");
    expect(updatedFrame.style.getPropertyValue("--element-font-family")).toBe(
      "Georgia",
    );
    await user.click(screen.getByRole("button", { name: "Italic" }));
    expect(updatedFrame.style.getPropertyValue("--element-font-style")).toBe(
      "italic",
    );
    await user.click(screen.getByRole("button", { name: "Regular" }));
    expect(updatedFrame.style.getPropertyValue("--element-font-weight")).toBe(
      "400",
    );
  });

  it("passes the dirty document to the new-workspace prompt", async () => {
    const newWorkspace = vi.fn().mockResolvedValue({ status: "canceled" });
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost({ newWorkspace })} />);

    const leftMargin = screen.getByLabelText("Left margin");
    await user.clear(leftMargin);
    await user.type(leftMargin, "2");
    await user.click(screen.getByRole("button", { name: "New workspace" }));

    await waitFor(() => expect(newWorkspace).toHaveBeenCalledOnce());
    expect(newWorkspace).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        plates: expect.arrayContaining([
          expect.objectContaining({ margins: { leftMm: 2, rightMm: 0 } }),
        ]),
      }),
    );
  });

  it("creates a new workspace through the host", async () => {
    const host = createHost();
    const user = userEvent.setup();
    render(<LabelmakerApp host={host} />);

    await user.click(screen.getByRole("button", { name: "New workspace" }));

    await waitFor(() =>
      expect(host.newWorkspace).toHaveBeenCalledWith(false, sampleDocument),
    );
    expect(screen.getByText("Untitled workspace")).toBeInTheDocument();
    expect(screen.getByText("Not saved")).toBeInTheDocument();
  });

  it("opens a workspace through the host", async () => {
    const host = createHost();
    const user = userEvent.setup();
    render(<LabelmakerApp host={host} />);

    await user.click(screen.getByRole("button", { name: "Open workspace…" }));

    await waitFor(() =>
      expect(host.openWorkspace).toHaveBeenCalledWith(false, sampleDocument),
    );
    expect(screen.getByText("Opened workspace")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Opened opened.lbl");
  });

  it("saves a copy through the Save As host operation", async () => {
    const host = createHost();
    const user = userEvent.setup();
    render(<LabelmakerApp host={host} />);

    await user.click(
      screen.getByRole("button", { name: "Save workspace as…" }),
    );

    await waitFor(() => expect(host.saveWorkspaceAs).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved workshop-copy.lbl",
    );
  });

  it("discovers a printer through the host interface", async () => {
    const host = createHost();
    const user = userEvent.setup();
    render(<LabelmakerApp host={host} />);

    await user.click(screen.getByRole("button", { name: "Add printer" }));

    expect(
      await screen.findByRole("dialog", { name: "Add a printer" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Workshop Printer")).toBeInTheDocument();
    expect(host.discoverPrinters).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "My printer is not listed" }),
    ).not.toBeInTheDocument();
  });

  it("shows printer add progress and closes after a successful add", async () => {
    const host = createHost();
    const user = userEvent.setup();
    render(<LabelmakerApp host={host} />);

    await user.click(screen.getByRole("button", { name: "Add printer" }));
    const add = await screen.findByRole("button", { name: "Add" });
    await user.click(add);

    await waitFor(() =>
      expect(host.addPrinter).toHaveBeenCalledWith("mock-workshop"),
    );
    expect(
      screen.queryByRole("dialog", { name: "Add a printer" }),
    ).not.toBeInTheDocument();
  });

  it("disables conflicting add controls while pairing is pending", async () => {
    let resolveAdd!: () => void;
    const host = createHost({
      addPrinter: vi.fn().mockImplementation(
        () =>
          new Promise<readonly never[]>((resolve) => {
            resolveAdd = () => resolve([]);
          }),
      ),
    });
    const user = userEvent.setup();
    render(<LabelmakerApp host={host} />);

    await user.click(screen.getByRole("button", { name: "Add printer" }));
    await user.click(await screen.findByRole("button", { name: "Add" }));

    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Search again" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Close add printer" }),
    ).toBeDisabled();

    resolveAdd();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Add a printer" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("adds an image as a movable plate element", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);

    const file = new File(["fixture"], "fixture.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Choose image"), file);

    expect(
      await screen.findByRole("button", { name: "Image element" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Image X position")).toBeInTheDocument();
    expect(screen.getByLabelText("Image Y position")).toBeInTheDocument();
    expect(screen.getByText("Edited")).toBeInTheDocument();
  });

  it("trims a plate to its content and horizontal margins", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);

    const leftMargin = screen.getByLabelText("Left margin");
    const rightMargin = screen.getByLabelText("Right margin");
    expect(leftMargin).toHaveValue(0);
    expect(rightMargin).toHaveValue(0);

    await user.clear(leftMargin);
    await user.type(leftMargin, "2");
    await user.clear(rightMargin);
    await user.type(rightMargin, "3");
    await user.click(
      screen.getByRole("button", { name: "Trim plate to content" }),
    );

    expect(screen.getByLabelText("Plate width")).toHaveValue(35.8);
    await user.click(
      screen.getByRole("button", { name: "Text element: RESISTORS" }),
    );
    expect(screen.getByLabelText("X position")).toHaveValue(-9.6);
  });

  it("toggles the current label into a flag without replacing its content", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);

    await user.click(screen.getByRole("button", { name: "Flag" }));

    expect(screen.getByText("3 labels")).toBeInTheDocument();
    expect(screen.getByLabelText("Plate name")).toHaveValue("Flag Resistors");
    expect(screen.getByText("Flag Resistors")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Text element: RESISTORS" }),
    ).toHaveLength(2);

    await user.click(
      screen.getAllByRole("button", { name: "Text element: RESISTORS" })[0]!,
    );
    const editor = screen.getByRole("textbox", { name: "Edit text on label" });
    fireEvent.change(editor, { target: { value: "SIGNAL" } });
    fireEvent.blur(editor);
    expect(
      screen.getAllByRole("button", { name: "Text element: SIGNAL" }),
    ).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Flag" }));
    expect(screen.getByLabelText("Plate name")).toHaveValue("Resistors");
    expect(
      screen.getAllByRole("button", { name: "Text element: SIGNAL" }),
    ).toHaveLength(1);
  });

  it("does not expose the removed wrap action", async () => {
    render(<LabelmakerApp host={createHost()} />);
    expect(
      screen.queryByRole("button", { name: "Wrap" }),
    ).not.toBeInTheDocument();
  });

  it("prints the current plate and all plates through distinct commands", async () => {
    const host = createHost();
    const user = userEvent.setup();
    render(<LabelmakerApp host={host} />);

    await screen.findByText("Studio Labeler");
    await user.click(screen.getByRole("button", { name: /^Print$/ }));
    await waitFor(() => expect(host.print).toHaveBeenCalledTimes(1));
    expect(host.print).toHaveBeenLastCalledWith(
      expect.objectContaining({ plateIds: ["plate-resistors"] }),
    );

    await user.click(screen.getByRole("button", { name: "Print options" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Print all 3 plates" }),
    );
    await waitFor(() => expect(host.print).toHaveBeenCalledTimes(2));
    expect(host.print).toHaveBeenLastCalledWith(
      expect.objectContaining({
        plateIds: ["plate-resistors", "plate-capacitors", "plate-connectors"],
      }),
    );
  });

  it("allows a print retry for an offline printer", async () => {
    const host = createHost({
      listPrinters: vi.fn().mockResolvedValue([
        {
          id: "offline",
          adapterId: "mock",
          name: "Offline Labeler",
          model: "Mock",
          transport: "mock",
          state: "disconnected",
          statusMessage: "Offline",
        },
      ]),
    });
    const user = userEvent.setup();
    render(<LabelmakerApp host={host} />);

    await screen.findByText("Offline Labeler");
    expect(screen.getByRole("button", { name: /^Print$/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Print options" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("button", { name: "Print plate" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Print plate" }));
    await waitFor(() => expect(host.print).toHaveBeenCalledTimes(1));
  });

  it("supports undo, redo, zoom, and delete keyboard shortcuts", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);

    await user.click(screen.getByRole("button", { name: "Add plate" }));
    expect(screen.getByText("4 labels")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByText("3 labels")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(screen.getByText("4 labels")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /4 NEW LABEL Plate 4/ }),
    );

    fireEvent.keyDown(window, { key: "+", ctrlKey: true });
    expect(screen.getByText("110%")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "-", ctrlKey: true });
    expect(screen.getByText("100%")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Delete" });
    expect(
      screen.queryByRole("button", { name: "Text element: NEW LABEL" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(
      screen.getByRole("button", { name: "Text element: NEW LABEL" }),
    ).toBeInTheDocument();
  });

  it("moves a selected canvas element with the keyboard", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);
    const element = screen.getByRole("button", {
      name: "Text element: RESISTORS",
    });
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    await user.click(element);
    expect(screen.getByLabelText("X position")).toHaveValue(4);
    await user.keyboard("{ArrowRight}");
    expect(screen.getByLabelText("X position")).toHaveValue(4.1);
  });

  it("updates element coordinates during a canvas drag", () => {
    render(<LabelmakerApp host={createHost()} />);
    const element = screen.getByRole("button", {
      name: "Text element: RESISTORS",
    });
    vi.spyOn(
      screen.getByRole("region", { name: "Resistors label canvas" }),
      "getBoundingClientRect",
    ).mockReturnValue({
      bottom: 180,
      height: 180,
      left: 0,
      right: 620,
      top: 0,
      width: 620,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const pointerEvent = (type: string, clientX: number, clientY: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, {
        clientX: { value: clientX },
        clientY: { value: clientY },
        pointerId: { value: 1 },
      });
      return event;
    };
    fireEvent(element, pointerEvent("pointerdown", 0, 0));
    fireEvent(window, pointerEvent("pointermove", 31, 10));
    fireEvent(window, pointerEvent("pointerup", 31, 10));
    expect(screen.getByLabelText("X position")).toHaveValue(7.1);
    expect(screen.getByLabelText("Y position")).toHaveValue(5.2);
  });

  it("resizes text with handles and allows keyboard overflow", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);
    const canvas = screen.getByRole("region", {
      name: "Resistors label canvas",
    });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      bottom: 180,
      height: 180,
      left: 0,
      right: 620,
      top: 0,
      width: 620,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const pointerEvent = (type: string, clientX: number, clientY: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, {
        button: { value: 0 },
        clientX: { value: clientX },
        clientY: { value: clientY },
        pointerId: { value: 1 },
      });
      return event;
    };
    fireEvent(
      screen.getByRole("button", { name: "Resize text block se" }),
      pointerEvent("pointerdown", 0, 0),
    );
    fireEvent(window, pointerEvent("pointermove", 62, 18));
    fireEvent(window, pointerEvent("pointerup", 62, 18));
    expect(
      Number.parseFloat(
        screen
          .getByRole("button", { name: "Text element: RESISTORS" })
          .closest<HTMLElement>(".canvas-element")!
          .style.getPropertyValue("--element-width"),
      ),
    ).toBeGreaterThan(90);

    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    let element = screen.getByRole("button", {
      name: "Text element: RESISTORS",
    });
    await user.click(element);
    for (let index = 0; index < 5; index += 1) {
      element = screen.getByRole("button", { name: "Text element: RESISTORS" });
      fireEvent.keyDown(element, { key: "ArrowLeft", shiftKey: true });
    }
    expect(screen.getByLabelText("X position")).toHaveValue(-1);
  });

  it("traps modal focus, closes with Escape, and returns focus", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);
    const opener = screen.getByRole("button", { name: "Add printer" });
    await user.click(opener);
    expect(
      await screen.findByRole("dialog", { name: "Add a printer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close add printer" }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Add a printer" }),
    ).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    const preview = screen.getByRole("button", { name: "Preview" });
    await user.click(preview);
    expect(
      screen
        .getAllByRole("button", { name: "Close preview" })
        .some((button) => button === document.activeElement),
    ).toBe(true);
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Print preview" }),
    ).not.toBeInTheDocument();
    expect(preview).toHaveFocus();
  });

  it("gives the print menu focus, arrow navigation, and Escape behavior", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);
    await screen.findByText("Studio Labeler");
    const trigger = screen.getByRole("button", { name: "Print options" });
    await user.click(trigger);
    const current = screen.getByRole("menuitem", {
      name: "Print current plate",
    });
    const all = screen.getByRole("menuitem", { name: "Print all 3 plates" });
    await waitFor(() => expect(current).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    expect(all).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("clears discovery progress and reports a discovery failure", async () => {
    const user = userEvent.setup();
    render(
      <LabelmakerApp
        host={createHost({
          discoverPrinters: vi.fn().mockRejectedValue(new Error("radio")),
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add printer" }));
    expect(
      await screen.findByText("Printer search failed. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search again" })).toBeEnabled();
    expect(screen.getByText("0 printers found")).toBeInTheDocument();
  });

  it("reports canceled and failed workspace operations", async () => {
    const user = userEvent.setup();
    const host = createHost({
      saveWorkspace: vi.fn().mockResolvedValue({ status: "canceled" }),
      openWorkspace: vi.fn().mockResolvedValue({ status: "canceled" }),
      newWorkspace: vi.fn().mockRejectedValue(new Error("dialog")),
    });
    render(<LabelmakerApp host={host} />);
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(await screen.findByText("Save canceled")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open workspace…" }));
    expect(await screen.findByText("Open canceled")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New workspace" }));
    expect(
      await screen.findByText(
        "A new workspace could not be created. Try again.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps dialogs usable after add and print host failures", async () => {
    const user = userEvent.setup();
    const host = createHost({
      addPrinter: vi.fn().mockRejectedValue(new Error("pairing")),
      print: vi.fn().mockRejectedValue(new Error("paper")),
    });
    render(<LabelmakerApp host={host} />);
    await screen.findByText("Studio Labeler");
    await user.click(screen.getByRole("button", { name: /^Print$/ }));
    expect(
      await screen.findByText(
        "The label could not be printed. Check the printer and try again.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add printer" }));
    await user.click(await screen.findByRole("button", { name: "Add" }));
    expect(
      await screen.findByText("The printer could not be added. Try again."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Add a printer" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Search again" })).toBeEnabled();
  });

  it("reports printer list failure without blocking the editor", async () => {
    render(
      <LabelmakerApp
        host={createHost({
          listPrinters: vi.fn().mockRejectedValue(new Error("list")),
        })}
      />,
    );
    expect(
      await screen.findByText("Printers could not be loaded. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add plate" })).toBeEnabled();
  });

  it("shows static icons for canceled and failed operations", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const user = userEvent.setup();
    const host = createHost({
      saveWorkspace: vi.fn().mockResolvedValue({ status: "canceled" }),
      listPrinters: vi.fn().mockRejectedValue(new Error("list")),
    });
    render(<LabelmakerApp host={host} />);

    const errorMessage = await screen.findByText(
      "Printers could not be loaded. Try again.",
    );
    const errorToast = errorMessage.closest("output");
    expect(errorToast).toHaveClass("error");
    expect(errorToast?.querySelector(".mini-spinner")).toBeNull();
    expect(errorToast?.querySelector("svg")).not.toBeNull();
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 8000);

    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    const canceledMessage = await screen.findByText("Save canceled");
    const canceledToast = canceledMessage.closest("output");
    expect(canceledToast?.querySelector(".mini-spinner")).toBeNull();
    expect(canceledToast?.querySelector("svg")).not.toBeNull();
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 6000);
  });

  it("uses a spinner only while a print operation is active", async () => {
    let finishPrint:
      | ((value: { readonly message: string }) => void)
      | undefined;
    const host = createHost({
      print: vi.fn().mockImplementation(
        () =>
          new Promise<{ readonly message: string }>((resolve) => {
            finishPrint = resolve;
          }),
      ),
    });
    const user = userEvent.setup();
    render(<LabelmakerApp host={host} />);
    await screen.findByText("Studio Labeler");

    await user.click(screen.getByRole("button", { name: /^Print$/ }));
    const sending = await screen.findByText("Sending label to printer…");
    expect(
      sending.closest("output")?.querySelector(".mini-spinner"),
    ).not.toBeNull();
    finishPrint?.({ message: "Printed" });
    await screen.findByText("Printed");
    expect(
      screen
        .getByText("Printed")
        .closest("output")
        ?.querySelector(".mini-spinner"),
    ).toBeNull();
  });

  it("shows macOS window controls only on macOS", () => {
    const linuxView = render(<LabelmakerApp host={createHost()} />);
    expect(linuxView.container.querySelector(".traffic-lights")).toBeNull();
    expect(
      linuxView.container.querySelector(".window-drag-spacer"),
    ).not.toBeNull();
    linuxView.unmount();

    const macView = render(
      <LabelmakerApp host={createHost({ platform: "macos" })} />,
    );
    expect(macView.container.querySelector(".traffic-lights")).toBeNull();
    expect(
      macView.container.querySelector(".window-drag-spacer.macos"),
    ).not.toBeNull();
  });
});
