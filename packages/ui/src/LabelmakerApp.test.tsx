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

vi.mock("./browser-raster.js", () => ({
  renderPlateBlackBounds: vi.fn().mockResolvedValue({
    minX: 15.5,
    maxX: 46.5,
  }),
}));

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
        deviceName: "Studio Labeler",
        name: "Studio Labeler",
        model: "MakeID E1 · Mock adapter",
        transport: "mock",
        state: "ready",
        statusMessage: "Ready",
        batteryPercent: 82,
        dpi: 203,
        rasterWidthPixels: 96,
        printableWidthMm: 12,
        marginTopMm: 2,
        marginBottomMm: 2,
        darkness: {
          minimum: 0,
          maximum: 31,
          step: 1,
          defaultValue: 20,
          value: 20,
        },
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
    updatePrinterSettings: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

async function openAddPrinterDialog(user: ReturnType<typeof userEvent.setup>) {
  const printerTrigger = await screen.findByRole("button", {
    name: /^(Selected printer:|Choose printer)/,
  });
  expect(
    screen.queryByRole("button", { name: "Add printer" }),
  ).not.toBeInTheDocument();
  await user.click(printerTrigger);
  const menu = screen.getByRole("menu", { name: "Printers" });
  const menuItems = Array.from(
    menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
  );
  const addPrinter = screen.getByRole("menuitem", {
    name: "+ Add a printer",
  });
  expect(menuItems.at(-1)).toBe(addPrinter);
  await user.click(addPrinter);
  await screen.findByRole("dialog", { name: "Add a printer" });
  return printerTrigger;
}

describe("LabelmakerApp", () => {
  it("restores the complete editor session before it stores recovery state", async () => {
    const recoveredDocument = {
      ...sampleDocument,
      name: "Recovered workspace",
    };
    const activePlate = recoveredDocument.plates[1]!;
    const selectedElement = activePlate.elements[0]!;
    const storeWorkspaceRecovery = vi.fn().mockResolvedValue(undefined);
    const host = createHost({
      loadWorkspaceRecovery: vi.fn().mockResolvedValue({
        document: recoveredDocument,
        dirty: true,
        activePlateId: activePlate.id,
        selectedElementId: selectedElement.id,
        zoom: 130,
        savedAt: "2026-08-26T12:00:00.000Z",
        fileName: "Recovered.lbl",
      }),
      storeWorkspaceRecovery,
    });

    render(<LabelmakerApp host={host} />);

    expect(await screen.findByText("Recovered workspace")).toBeInTheDocument();
    expect(screen.getByLabelText("Plate name")).toHaveValue(activePlate.name);
    expect(screen.getByText("130%")).toBeInTheDocument();
    expect(screen.getByText("Edited")).toBeInTheDocument();
    expect(
      screen
        .getByRole("button", {
          name: `Text element: ${selectedElement.kind === "text" ? selectedElement.text : ""}`,
        })
        .closest(".canvas-element"),
    ).toHaveClass("selected");
    await waitFor(() =>
      expect(storeWorkspaceRecovery).toHaveBeenLastCalledWith(
        expect.objectContaining({
          document: recoveredDocument,
          dirty: true,
          activePlateId: activePlate.id,
          selectedElementId: selectedElement.id,
          zoom: 130,
        }),
      ),
    );
  });

  it("uses the default workspace when recovery loading fails", async () => {
    const storeWorkspaceRecovery = vi.fn().mockResolvedValue(undefined);
    render(
      <LabelmakerApp
        host={createHost({
          loadWorkspaceRecovery: vi.fn().mockRejectedValue(new Error("bad")),
          storeWorkspaceRecovery,
        })}
      />,
    );

    expect(await screen.findByText("Workshop labels")).toBeInTheDocument();
    await waitFor(() =>
      expect(storeWorkspaceRecovery).toHaveBeenCalledWith(
        expect.objectContaining({ document: sampleDocument }),
      ),
    );
  });

  it("shows the configured printer and adds a plate", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);

    expect(await screen.findByText("Studio Labeler")).toBeInTheDocument();
    expect(screen.getByText("3 labels")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add label" }));

    expect(screen.getByText("4 labels")).toBeInTheDocument();
    expect(screen.getByLabelText("Plate name")).toHaveValue("Plate 4");
    expect(screen.getByText("Plate 4")).toBeInTheDocument();
    expect(screen.getByText("Edited")).toBeInTheDocument();
  });

  it("shows a direct add action when no printer is configured", async () => {
    const user = userEvent.setup();
    render(
      <LabelmakerApp
        host={createHost({ listPrinters: vi.fn().mockResolvedValue([]) })}
      />,
    );

    const addPrinter = await screen.findByRole("button", {
      name: "Add printer",
    });
    expect(
      screen.queryByRole("button", { name: "Choose printer" }),
    ).not.toBeInTheDocument();
    await user.click(addPrinter);
    expect(
      await screen.findByRole("dialog", { name: "Add a printer" }),
    ).toBeInTheDocument();
  });

  it("uses one preview scale and deletes labels from the strip", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);
    await screen.findByText("Studio Labeler");

    const resistorPreview = screen
      .getByRole("button", { name: "Select label 1: Resistors" })
      .closest<HTMLElement>(".plate-thumb")!;
    expect(
      resistorPreview.style.getPropertyValue("--label-preview-width"),
    ).toBe("201.5px");
    expect(
      resistorPreview.style.getPropertyValue("--label-preview-height"),
    ).toBe("52px");

    await user.click(
      screen.getByRole("button", { name: "Delete label Resistors" }),
    );
    expect(screen.getByText("2 labels")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Select label 1: Resistors" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Plate name")).toHaveValue("Capacitors");
    expect(screen.getByText("Edited")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Delete label Capacitors" }),
    );
    expect(screen.getByText("1 label")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete label Connectors" }),
    ).toBeDisabled();
  });

  it("scales label previews from physical text size and marks the printable area", async () => {
    render(<LabelmakerApp host={createHost()} />);
    await screen.findByText("Studio Labeler");

    const canvasElement = screen
      .getByRole("button", { name: "Text element: RESISTORS" })
      .closest<HTMLElement>(".canvas-element")!;
    expect(
      Number.parseFloat(
        canvasElement.style.getPropertyValue("--element-font-size"),
      ),
    ).toBeCloseTo(57.15, 1);
    const miniText = document.querySelector<HTMLElement>(
      ".mini-label .label-artwork-text",
    )!;
    expect(miniText.style.fontSize).toContain("cqi");
    expect(screen.getByText(/Printable area 62 ×\s*12 mm/)).toBeInTheDocument();
    const zones = screen
      .getByRole("region", { name: "Resistors label canvas" })
      .querySelectorAll<HTMLElement>(".nonprintable-zone");
    expect(zones).toHaveLength(2);
    expect(zones[0]).toHaveStyle({ height: "12.5%" });

    expect(miniText.style.left).toBe(
      canvasElement.style.getPropertyValue("--element-left"),
    );
    expect(miniText.style.top).toBe(
      canvasElement.style.getPropertyValue("--element-top"),
    );
    expect(miniText.style.width).toBe(
      canvasElement.style.getPropertyValue("--element-width"),
    );
    expect(miniText.style.height).toBe(
      canvasElement.style.getPropertyValue("--element-height"),
    );
  });

  it("removes non-printable margins when the label fits the print head", async () => {
    render(<LabelmakerApp host={createHost()} />);
    const height = screen.getByLabelText("Plate height");
    fireEvent.change(height, { target: { value: "10" } });

    expect(screen.getByText(/Printable area 62 ×\s*10 mm/)).toBeInTheDocument();
    const zones = screen
      .getByRole("region", { name: "Resistors label canvas" })
      .querySelectorAll<HTMLElement>(".nonprintable-zone");
    expect(zones[0]).toHaveStyle({ height: "0%" });
  });

  it("uses the selected printer printable width", async () => {
    const narrowHead = {
      id: "makeid:narrow",
      adapterId: "makeid",
      name: "Narrow head",
      model: "MakeID E1",
      transport: "bluetooth-classic" as const,
      state: "ready" as const,
      statusMessage: "Ready",
      dpi: 203,
      rasterWidthPixels: 96,
      printableWidthMm: 12,
    };
    const fullHead = {
      ...narrowHead,
      id: "makeid:full",
      name: "Full head",
      printableWidthMm: 16,
    };
    const user = userEvent.setup();
    render(
      <LabelmakerApp
        host={createHost({
          listPrinters: vi.fn().mockResolvedValue([narrowHead, fullHead]),
          getActivePrinterId: vi.fn().mockResolvedValue(narrowHead.id),
        })}
      />,
    );
    expect(
      await screen.findByText(/Printable area 62 ×\s*12 mm/),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Selected printer: Narrow head" }),
    );
    await user.click(screen.getByRole("menuitemradio", { name: /Full head/ }));

    expect(screen.getByText(/Printable area 62 ×\s*16 mm/)).toBeInTheDocument();
  });

  it("scales the label and its text by the same zoom ratio", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);
    const canvas = screen.getByRole("region", {
      name: "Resistors label canvas",
    });
    const frame = screen
      .getByRole("button", { name: "Text element: RESISTORS" })
      .closest<HTMLElement>(".canvas-element")!;
    const widthBefore = Number.parseFloat(canvas.style.width);
    const fontBefore = Number.parseFloat(
      frame.style.getPropertyValue("--element-font-size"),
    );

    await user.click(screen.getByRole("button", { name: "Zoom in" }));

    expect(Number.parseFloat(canvas.style.width) / widthBefore).toBeCloseTo(
      1.1,
      5,
    );
    expect(
      Number.parseFloat(frame.style.getPropertyValue("--element-font-size")) /
        fontBefore,
    ).toBeCloseTo(1.1, 5);
  });

  it("uses the ruler coordinates for every five millimeter grid line", () => {
    render(<LabelmakerApp host={createHost()} />);
    const canvas = screen.getByRole("region", {
      name: "Resistors label canvas",
    });
    const stage = canvas.closest<HTMLElement>(".canvas-stage")!;
    const horizontalGridLine = Array.from(
      stage.querySelectorAll<HTMLElement>(".canvas-grid .horizontal"),
    ).find((line) => line.style.top === "45px");
    const verticalRulerMark = Array.from(
      stage.querySelectorAll<HTMLElement>(".ruler-left span"),
    ).find((mark) => mark.textContent === "5 mm");
    const verticalGridLine = Array.from(
      stage.querySelectorAll<HTMLElement>(".canvas-grid .vertical"),
    ).find((line) => line.style.left === "45px");
    const horizontalRulerMark = Array.from(
      stage.querySelectorAll<HTMLElement>(".ruler-top span"),
    ).find((mark) => mark.textContent === "5 mm");

    expect(horizontalGridLine?.style.top).toBe(verticalRulerMark?.style.top);
    expect(verticalGridLine?.style.left).toBe(horizontalRulerMark?.style.left);

    const workSurface = stage.closest<HTMLElement>(".work-surface")!;
    expect(workSurface.style.getPropertyValue("--dot-grid-size")).toBe("9px");
    expect(workSurface.style.getPropertyValue("--dot-grid-x")).toBe(
      "calc(50% - 279px + 0px)",
    );
    const fadingLine = Array.from(
      stage.querySelectorAll<HTMLElement>(".canvas-grid .vertical"),
    ).find((line) => line.style.left === "-45px");
    expect(fadingLine?.style.opacity).toBe("0.5");
    expect(
      stage
        .querySelector<HTMLElement>(".canvas-grid")
        ?.style.getPropertyValue("--grid-fade-distance"),
    ).toBe("90px");
  });

  it("puts Preview beside Print and offers twelve typefaces", async () => {
    render(<LabelmakerApp host={createHost()} />);
    const preview = screen.getByRole("button", { name: "Preview" });
    const print = screen.getByRole("button", { name: /^Print$/ });
    expect(
      preview.compareDocumentPosition(print) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const typeface = screen.getByLabelText("Typeface");
    expect(typeface.querySelectorAll("option")).toHaveLength(12);
    expect(typeface).toHaveValue('"Avenir Next", "Segoe UI", sans-serif');
  });

  it("clears text editing and selection on the label background", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);
    const text = screen.getByRole("button", {
      name: "Text element: RESISTORS",
    });
    const frame = text.closest<HTMLElement>(".canvas-element")!;
    await user.click(text);
    expect(
      screen.getByRole("textbox", { name: "Edit text on label" }),
    ).toBeInTheDocument();

    const canvas = screen.getByRole("region", {
      name: "Resistors label canvas",
    });
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(
      screen.queryByRole("textbox", { name: "Edit text on label" }),
    ).not.toBeInTheDocument();
    expect(frame).not.toHaveClass("selected");
  });

  it("restores and updates the selected printer from the header menu", async () => {
    const first = {
      id: "makeid:first",
      adapterId: "makeid",
      name: "First printer",
      model: "MakeID E1",
      transport: "bluetooth-classic" as const,
      state: "ready" as const,
      statusMessage: "Ready",
      dpi: 203,
      rasterWidthPixels: 96,
      printableWidthMm: 12,
    };
    const second = { ...first, id: "makeid:second", name: "Second printer" };
    const setActivePrinterId = vi.fn().mockResolvedValue(undefined);
    const removePrinter = vi.fn().mockResolvedValue([second]);
    const user = userEvent.setup();
    render(
      <LabelmakerApp
        host={createHost({
          getActivePrinterId: vi.fn().mockResolvedValue(second.id),
          listPrinters: vi.fn().mockResolvedValue([first, second]),
          removePrinter,
          setActivePrinterId,
        })}
      />,
    );

    const trigger = await screen.findByRole("button", {
      name: "Selected printer: Second printer",
    });
    await user.click(trigger);
    await user.click(
      screen.getByRole("menuitemradio", { name: /First printer/ }),
    );
    await waitFor(() =>
      expect(setActivePrinterId).toHaveBeenCalledWith(first.id),
    );

    await user.click(
      screen.getByRole("button", { name: "Selected printer: First printer" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Remove First printer" }),
    );
    await waitFor(() => expect(removePrinter).toHaveBeenCalledWith(first.id));
  });

  it("edits print-head geometry independently from the current label", async () => {
    const updatePrinterSettings = vi.fn().mockImplementation(
      async (
        _printerId: string,
        settings: {
          darkness?: number;
          printHeadSizeMm?: number;
          marginTopMm?: number;
          marginBottomMm?: number;
        },
      ) => [
        {
          id: "mock-studio",
          adapterId: "mock",
          name: "Studio Labeler",
          model: "MakeID E1 · Mock adapter",
          transport: "mock" as const,
          state: "ready" as const,
          statusMessage: "Ready",
          dpi: 203,
          rasterWidthPixels: 96,
          printableWidthMm: settings.printHeadSizeMm ?? 12,
          marginTopMm: settings.marginTopMm ?? 2,
          marginBottomMm: settings.marginBottomMm ?? 2,
          darkness: {
            minimum: 0,
            maximum: 31,
            step: 1,
            defaultValue: 20,
            value: settings.darkness ?? 20,
          },
        },
      ],
    );
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost({ updatePrinterSettings })} />);
    await user.click(
      await screen.findByRole("button", {
        name: "Selected printer: Studio Labeler",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Settings for Studio Labeler" }),
    );

    expect(screen.getByRole("dialog")).toHaveTextContent("203 dpi");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Current label");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Print output");
    expect(screen.getByRole("dialog")).not.toHaveTextContent(
      "Settings apply to this printer only",
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent(
      "Use 0.1 mm steps",
    );
    expect(screen.getByLabelText("Print head size")).toHaveValue(12);
    expect(screen.getByLabelText("Top margin")).toHaveValue(2);
    expect(screen.getByLabelText("Bottom margin")).toHaveValue(2);
    fireEvent.change(screen.getByLabelText("Print head size"), {
      target: { value: "11.8" },
    });
    fireEvent.change(screen.getByLabelText("Top margin"), {
      target: { value: "1.4" },
    });
    fireEvent.change(screen.getByLabelText("Bottom margin"), {
      target: { value: "2.6" },
    });
    const darkness = screen.getByLabelText("Print darkness");
    fireEvent.change(darkness, { target: { value: "24" } });
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(updatePrinterSettings).toHaveBeenCalledWith("mock-studio", {
        darkness: 24,
        printHeadSizeMm: 11.8,
        marginTopMm: 1.4,
        marginBottomMm: 2.6,
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("changes only the printer name shown in Labelmaker", async () => {
    const updatePrinterSettings = vi.fn().mockResolvedValue([]);
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost({ updatePrinterSettings })} />);
    await user.click(
      await screen.findByRole("button", {
        name: "Selected printer: Studio Labeler",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Settings for Studio Labeler" }),
    );

    const name = screen.getByLabelText("Printer name");
    await user.clear(name);
    await user.type(name, "Workbench printer");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(updatePrinterSettings).toHaveBeenCalledWith("mock-studio", {
        displayName: "Workbench printer",
        darkness: 20,
        printHeadSizeMm: 12,
        marginTopMm: 2,
        marginBottomMm: 2,
      }),
    );
  });

  it("restores the unchanged device name", async () => {
    const updatePrinterSettings = vi.fn().mockResolvedValue([]);
    const listPrinters = vi.fn().mockResolvedValue([
      {
        id: "mock-studio",
        adapterId: "mock",
        deviceName: "Studio Labeler",
        name: "Workbench printer",
        model: "MakeID E1 · Mock adapter",
        transport: "mock" as const,
        state: "ready" as const,
        statusMessage: "Ready",
        dpi: 203,
        rasterWidthPixels: 96,
        printableWidthMm: 12,
        marginTopMm: 2,
        marginBottomMm: 2,
      },
    ]);
    const user = userEvent.setup();
    render(
      <LabelmakerApp
        host={createHost({ listPrinters, updatePrinterSettings })}
      />,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Selected printer: Workbench printer",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Settings for Workbench printer" }),
    );
    await user.click(screen.getByRole("button", { name: "Use device name" }));
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(updatePrinterSettings).toHaveBeenCalledWith("mock-studio", {
        printHeadSizeMm: 12,
        marginTopMm: 2,
        marginBottomMm: 2,
      }),
    );
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
    expect(editor.style.getPropertyValue("--editor-line-count")).toBe("1");
    const elementFrame = editor.closest<HTMLElement>(".canvas-element")!;
    const originalStyle = {
      family: elementFrame.style.getPropertyValue("--element-font-family"),
      size: elementFrame.style.getPropertyValue("--element-font-size"),
      weight: elementFrame.style.getPropertyValue("--element-font-weight"),
      justify: elementFrame.style.getPropertyValue("--element-justify"),
      rotation: elementFrame.style.getPropertyValue("--element-rotation"),
    };
    fireEvent.change(editor, { target: { value: "LINE 1\nLINE 2" } });
    expect(editor.style.getPropertyValue("--editor-line-count")).toBe("2");
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
      "Georgia, serif",
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

  it("uses automatic or fixed line height and both text alignments", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);

    const automatic = screen.getByRole("checkbox", {
      name: "Use automatic line height",
    });
    const lineHeight = screen.getByLabelText("Line height");
    const fontSize = screen.getByLabelText("Font size");
    expect(automatic).toBeChecked();
    expect(lineHeight).toBeDisabled();
    expect(lineHeight).toHaveValue(18);
    expect(fontSize).toHaveAttribute("step", "1");
    fireEvent.change(fontSize, { target: { value: "18.6" } });
    expect(fontSize).toHaveValue(19);

    await user.click(automatic);
    expect(lineHeight).toBeEnabled();
    await user.clear(lineHeight);
    await user.type(lineHeight, "24");
    await user.click(screen.getByRole("button", { name: "Align right" }));
    await user.click(screen.getByRole("button", { name: "Align top" }));

    const frame = screen
      .getByRole("button", { name: "Text element: RESISTORS" })
      .closest<HTMLElement>(".canvas-element")!;
    expect(
      Number.parseFloat(frame.style.getPropertyValue("--element-line-height")),
    ).toBeCloseTo(76.2, 5);
    expect(frame.style.getPropertyValue("--element-align-items")).toBe(
      "flex-start",
    );
    expect(frame.style.textAlign).toBe("right");

    await user.click(screen.getByRole("button", { name: "Preview" }));
    const previewText = screen
      .getByRole("dialog", { name: "Print preview" })
      .querySelector<HTMLElement>(".label-artwork-text")!;
    expect(previewText.style.textAlign).toBe("right");
    expect(previewText.style.alignItems).toBe("flex-start");
    expect(Number(previewText.style.lineHeight)).toBeCloseTo(24 / 19, 5);
  });

  it("passes the dirty document to the new-workspace prompt", async () => {
    const newWorkspace = vi.fn().mockResolvedValue({ status: "canceled" });
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost({ newWorkspace })} />);

    const leftMargin = screen.getByLabelText("Left margin");
    await user.clear(leftMargin);
    await user.type(leftMargin, "2");
    await user.click(screen.getByRole("button", { name: "New" }));

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

    await user.click(screen.getByRole("button", { name: "New" }));

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

    await user.click(screen.getByRole("button", { name: "Open" }));

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

    fireEvent.keyDown(window, { key: "s", ctrlKey: true, shiftKey: true });

    await waitFor(() => expect(host.saveWorkspaceAs).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved workshop-copy.lbl",
    );
  });

  it("discovers a printer through the host interface", async () => {
    const host = createHost();
    const user = userEvent.setup();
    render(<LabelmakerApp host={host} />);

    await openAddPrinterDialog(user);

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

    await openAddPrinterDialog(user);
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

    await openAddPrinterDialog(user);
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
    expect(screen.getByLabelText("Image black level")).toHaveValue("128");
    expect(
      screen.getByRole("button", { name: "Resize image block se" }),
    ).toBeInTheDocument();
    const width = screen.getByLabelText("Image width");
    const x = screen.getByLabelText("Image X position");
    expect(
      width.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Image black level"), {
      target: { value: "180" },
    });
    expect(screen.getByLabelText("Image black level")).toHaveValue("180");
    expect(screen.getByText("Edited")).toBeInTheDocument();
  });

  it("rejects an image format which the print renderer cannot use", async () => {
    render(<LabelmakerApp host={createHost()} />);

    const file = new File(["fixture"], "fixture.svg", {
      type: "image/svg+xml",
    });
    fireEvent.change(screen.getByLabelText("Choose image"), {
      target: { files: [file] },
    });

    expect(
      await screen.findByText("Choose a PNG, JPEG, GIF, WebP, or BMP image."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Image element" }),
    ).not.toBeInTheDocument();
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

    await waitFor(() =>
      expect(screen.getByLabelText("Plate width")).toHaveValue(36),
    );
    await user.click(
      screen.getByRole("button", { name: "Text element: RESISTORS" }),
    );
    expect(screen.getByLabelText("X position")).toHaveValue(-9.5);
  });

  it.each(["Plate width", "Plate height", "Left margin", "Right margin"])(
    "trims the plate when Enter is pressed in %s",
    async (fieldName) => {
      render(<LabelmakerApp host={createHost()} />);

      fireEvent.keyDown(screen.getByLabelText(fieldName), { key: "Enter" });

      await waitFor(() =>
        expect(screen.getByLabelText("Plate width")).toHaveValue(31),
      );
    },
  );

  it("keeps manual label widths in whole millimeters", () => {
    render(<LabelmakerApp host={createHost()} />);
    const width = screen.getByLabelText("Plate width");

    fireEvent.change(width, { target: { value: "41.6" } });

    expect(width).toHaveValue(42);
  });

  it("toggles the current label into a flag without replacing its content", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);

    const flag = screen.getByRole("button", { name: "Flag" });
    expect(flag).toHaveAttribute("aria-pressed", "false");
    await user.click(flag);
    expect(flag).toHaveAttribute("aria-pressed", "true");
    expect(flag).toHaveClass("active");

    expect(screen.getByText("3 labels")).toBeInTheDocument();
    expect(screen.getByLabelText("Plate name")).toHaveValue("Flag Resistors");
    expect(screen.getByLabelText("Plate width")).toHaveValue(62);
    expect(
      screen.getByRole("region", { name: "Flag Resistors label canvas" }),
    ).toHaveStyle({ width: "720px" });
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
    expect(flag).toHaveAttribute("aria-pressed", "false");
    expect(flag).not.toHaveClass("active");
    expect(screen.getByLabelText("Plate name")).toHaveValue("Resistors");
    expect(screen.getByLabelText("Plate width")).toHaveValue(62);
    expect(
      screen.getAllByRole("button", { name: "Text element: SIGNAL" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "Text element: SIGNAL" }),
    ).toHaveLength(1);
  });

  it("saves print mirroring without changing the editor artwork", async () => {
    const host = createHost();
    const user = userEvent.setup();
    render(<LabelmakerApp host={host} />);

    const mirror = screen.getByRole("button", { name: "Mirror" });
    const artwork = screen.getByRole("button", {
      name: "Text element: RESISTORS",
    });
    const artworkStyle = artwork.getAttribute("style");
    expect(mirror).toHaveAttribute("aria-pressed", "false");

    await user.click(mirror);

    expect(mirror).toHaveAttribute("aria-pressed", "true");
    expect(mirror).toHaveClass("active");
    expect(artwork).toBeInTheDocument();
    expect(artwork.getAttribute("style")).toBe(artworkStyle);

    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(
      screen
        .getByRole("dialog", { name: "Print preview" })
        .querySelector(".preview-label"),
    ).toHaveStyle({ transform: "scaleX(-1)" });
    await user.click(
      screen.getAllByRole("button", { name: "Close preview" }).at(-1)!,
    );

    await screen.findByText("Studio Labeler");
    await user.click(screen.getByRole("button", { name: /^Print$/ }));
    await waitFor(() => expect(host.print).toHaveBeenCalledTimes(1));
    expect(
      vi
        .mocked(host.print)
        .mock.calls[0]?.[0].document.plates.find(
          (plate) => plate.id === "plate-resistors",
        )?.mirrorPrint,
    ).toBe(true);

    await user.click(mirror);
    expect(mirror).toHaveAttribute("aria-pressed", "false");
  });

  it("does not expose the removed wrap action", async () => {
    render(<LabelmakerApp host={createHost()} />);
    expect(
      screen.queryByRole("button", { name: "Wrap" }),
    ).not.toBeInTheDocument();
  });

  it("prints the current label and all labels through distinct commands", async () => {
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
      screen.getByRole("menuitem", { name: "Print all 3 labels" }),
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
    expect(screen.getByRole("button", { name: "Print label" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Print label" }));
    await waitFor(() => expect(host.print).toHaveBeenCalledTimes(1));
  });

  it("supports undo, redo, zoom, and delete keyboard shortcuts", async () => {
    const user = userEvent.setup();
    render(<LabelmakerApp host={createHost()} />);

    await user.click(screen.getByRole("button", { name: "Add label" }));
    expect(screen.getByText("4 labels")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByText("3 labels")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(screen.getByText("4 labels")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Select label 4: Plate 4" }),
    );

    fireEvent.keyDown(window, { key: "+", ctrlKey: true });
    expect(screen.getByText("110%")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "-", ctrlKey: true });
    expect(screen.getByText("100%")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Text element: NEW LABEL" }),
    );
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
    expect(screen.getByLabelText("Y position")).toHaveValue(4.1);
  });

  it("snaps a dragged element to printable left and top limits", async () => {
    render(<LabelmakerApp host={createHost()} />);
    await screen.findByText("Studio Labeler");
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
    fireEvent(window, pointerEvent("pointermove", -36, -9));
    fireEvent(window, pointerEvent("pointerup", -36, -9));

    expect(screen.getByLabelText("X position")).toHaveValue(0);
    expect(screen.getByLabelText("Y position")).toHaveValue(2);
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
    const opener = await openAddPrinterDialog(user);
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
      name: "Print current label",
    });
    const all = screen.getByRole("menuitem", { name: "Print all 3 labels" });
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
    await openAddPrinterDialog(user);
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
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("Open canceled")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New" }));
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
      print: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Error invoking remote method 'labelmaker:print': MakeIdAdapterError: Printer needs attention",
          ),
        ),
    });
    render(<LabelmakerApp host={host} />);
    await screen.findByText("Studio Labeler");
    await user.click(screen.getByRole("button", { name: /^Print$/ }));
    expect(
      await screen.findByText("Printer needs attention"),
    ).toBeInTheDocument();
    await openAddPrinterDialog(user);
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
    expect(screen.getByRole("button", { name: "Add label" })).toBeEnabled();
  });

  it("does not overlap periodic printer refresh requests", async () => {
    let finishList!: (printers: readonly []) => void;
    let runInterval!: () => void;
    const listPrinters = vi.fn(
      () =>
        new Promise<readonly []>((resolve) => {
          finishList = resolve;
        }),
    );
    const nativeSetInterval = globalThis.setInterval;
    vi.spyOn(globalThis, "setInterval").mockImplementation(
      (handler, timeout, ...arguments_) => {
        if (timeout === 5000) {
          runInterval = handler as () => void;
          return 1;
        }
        return nativeSetInterval(handler, timeout, ...arguments_);
      },
    );
    render(<LabelmakerApp host={createHost({ listPrinters })} />);
    await waitFor(() => expect(listPrinters).toHaveBeenCalledOnce());

    runInterval();
    runInterval();
    expect(listPrinters).toHaveBeenCalledOnce();

    finishList([]);
    await waitFor(() => {
      runInterval();
      expect(listPrinters).toHaveBeenCalledTimes(2);
    });
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
    expect(screen.getByRole("button", { name: /^Print$/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /^Print$/ }));
    expect(host.print).toHaveBeenCalledOnce();
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
