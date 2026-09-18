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

import type { PrinterSettings, PrinterSummary } from "./host.js";
import { PrinterSettingsDialog } from "./PrinterSettingsDialog.js";

afterEach(cleanup);

const printer: PrinterSummary = {
  id: "printer",
  adapterId: "mock",
  deviceName: "Device printer",
  name: "Studio printer",
  model: "Mock model",
  transport: "mock",
  state: "ready",
  statusMessage: "Ready",
  dpi: 203,
  printableWidthMm: 12,
  rasterAlignment: "center",
  interLabelSpacingMm: 1,
};

function renderDialog({
  onClose = vi.fn(),
  onSave = vi.fn().mockResolvedValue(true),
  printerSummary = printer,
}: {
  readonly onClose?: () => void;
  readonly onSave?: (
    printerId: string,
    settings: PrinterSettings,
  ) => boolean | Promise<boolean>;
  readonly printerSummary?: PrinterSummary;
} = {}) {
  return render(
    <>
      <div className="application-content" />
      <PrinterSettingsDialog
        onClose={onClose}
        onSave={onSave}
        open
        printer={printerSummary}
      />
    </>,
  );
}

describe("PrinterSettingsDialog", () => {
  it("shows editable dimensions beside example labels and fixed resolution", () => {
    renderDialog();
    const diagram = screen.getByRole("figure", {
      name: "Printer label dimensions",
    });
    expect(diagram).not.toHaveTextContent("Example ribbon");
    expect(diagram).toHaveTextContent("Resolution: 203 dpi");
    expect(diagram).toHaveTextContent("Printhead alignment: Center");
    expect(diagram).not.toHaveTextContent("30 mm");
    expect(diagram).not.toHaveTextContent("Printhead area");
    expect(diagram.querySelectorAll(".printer-paper-blank")).toHaveLength(2);
    expect(diagram.querySelector(".printer-ribbon-head")).toBeInTheDocument();
    expect(screen.queryByLabelText("Top margin")).toBeNull();
    expect(screen.queryByLabelText("Bottom margin")).toBeNull();
    for (const name of ["Print head size", "Margin between labels"]) {
      expect(diagram).toContainElement(
        screen.getByRole("spinbutton", { name }),
      );
    }
    for (const [name, meaning] of [
      [
        "Print head size",
        "Print head size: physical head dimension across the paper",
      ],
      ["Margin between labels", "Label gap: space between two labels"],
    ] as const) {
      expect(screen.getByRole("spinbutton", { name })).toHaveAttribute(
        "title",
        `${meaning}. Click to edit in millimeters.`,
      );
    }
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it.each([
    ["start", 0, 4],
    ["center", 2, 2],
    ["end", 4, 0],
  ] as const)(
    "shows %s alignment in the example paper",
    (rasterAlignment, top, bottom) => {
      const { container } = renderDialog({
        printerSummary: { ...printer, rasterAlignment },
      });
      expect(
        screen.getByText(
          `Printhead alignment: ${{ start: "Top", center: "Center", end: "Bottom" }[rasterAlignment]}`,
        ),
      ).toHaveAttribute("title", "Reported by the printer");
      const preview = container.querySelector<HTMLElement>(
        ".printer-ribbon-preview",
      )!;
      expect(preview.style.getPropertyValue("--ribbon-height-mm")).toBe("16");
      expect(preview.style.getPropertyValue("--ribbon-head-mm")).toBe("12");
      expect(preview.style.getPropertyValue("--ribbon-top-mm")).toBe(
        String(top),
      );
      expect(preview.style.getPropertyValue("--ribbon-bottom-mm")).toBe(
        String(bottom),
      );
      expect(container.querySelectorAll(".printer-paper-blank")).toHaveLength(
        top && bottom ? 2 : 1,
      );
      expect(screen.queryByLabelText("Top margin")).toBeNull();
      expect(screen.queryByLabelText("Bottom margin")).toBeNull();
    },
  );

  it("shows missing alignment without claiming a printer value", () => {
    const { rasterAlignment: _alignment, ...unreported } = printer;
    renderDialog({ printerSummary: unreported });
    expect(
      screen.getByText("Printhead alignment: Not reported"),
    ).toBeInTheDocument();
  });

  it("rounds device geometry to tenths before display and save", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    renderDialog({
      onSave,
      printerSummary: {
        ...printer,
        dpi: 300,
        printableWidthMm: 12.2,
      },
    });
    expect(
      screen.getByRole("spinbutton", { name: "Print head size" }),
    ).toHaveValue(12.2);
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        "printer",
        expect.objectContaining({
          printHeadSizeMm: 12.2,
        }),
      ),
    );
  });

  it("saves each edited diagram dimension with its correct setting", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    renderDialog({ onSave });
    for (const [name, value] of [
      ["Print head size", "14.5"],
      ["Margin between labels", "3.1"],
      ["Feed after last label", "11.2"],
      ["Minimum label length", "16"],
    ] as const) {
      const input = screen.getByRole("spinbutton", { name });
      await user.clear(input);
      await user.type(input, value);
    }
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("printer", {
        displayName: "Studio printer",
        printHeadSizeMm: 14.5,
        interLabelSpacingMm: 3.1,
        feedAfterPrintMm: 11.2,
        minimumLabelWidthMm: 16,
      }),
    );
  });

  it("accepts a zero gap, and rejects invalid dimensions", () => {
    renderDialog();
    for (const name of ["Margin between labels"]) {
      fireEvent.change(screen.getByRole("spinbutton", { name }), {
        target: { value: "0" },
      });
    }
    const save = screen.getByRole("button", { name: "Save settings" });
    expect(save).toBeEnabled();
    const head = screen.getByRole("spinbutton", { name: "Print head size" });
    for (const value of ["", "0", "-1", "100.1", "12.34"]) {
      fireEvent.change(head, { target: { value } });
      expect(save).toBeDisabled();
    }
    fireEvent.change(head, { target: { value: "0.1" } });
    expect(save).toBeEnabled();
  });

  it("requests a decimal keyboard for each number field", () => {
    const { container } = renderDialog();

    for (const input of container.querySelectorAll('input[type="number"]')) {
      expect(input).toHaveAttribute("inputmode", "decimal");
    }
  });

  it.each(["Print head size", "Margin between labels"])(
    "accepts %s with Enter without saving the dialog",
    async (name) => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      const onSave = vi.fn().mockResolvedValue(true);
      renderDialog({ onClose, onSave });

      const input = screen.getByLabelText(name);
      await user.click(input);
      expect(input).toHaveFocus();
      await user.keyboard("{Enter}");

      expect(input).not.toHaveFocus();
      expect(onSave).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeVisible();
    },
  );

  it("does not close from the backdrop or Escape while a save is active", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    let finishSave!: (saved: boolean) => void;
    const onSave = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishSave = resolve;
        }),
    );
    renderDialog({ onClose, onSave });

    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const dialog = screen.getByRole("dialog", { name: "Printer settings" });
    fireEvent.pointerDown(dialog.closest(".modal-backdrop")!);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    finishSave(false);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save settings" }),
      ).toBeEnabled(),
    );
  });

  it("keeps the MakeID E1 darkness control and saves its value", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    renderDialog({
      onSave,
      printerSummary: {
        ...printer,
        adapterId: "makeid",
        model: "MakeID E1",
        darkness: {
          minimum: 0,
          maximum: 31,
          step: 1,
          defaultValue: 20,
          value: 20,
        },
      },
    });

    const darkness = screen.getByLabelText("Print darkness");
    fireEvent.change(darkness, { target: { value: "24" } });
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        "printer",
        expect.objectContaining({ darkness: 24 }),
      ),
    );
  });

  it("shows named density levels on the L1 slider and saves High", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    renderDialog({
      onSave,
      printerSummary: {
        ...printer,
        darkness: {
          minimum: 0,
          maximum: 2,
          step: 1,
          defaultValue: 1,
          value: 1,
          choices: [
            { value: 0, label: "Low" },
            { value: 1, label: "Medium" },
            { value: 2, label: "High" },
          ],
        },
      },
    });
    const slider = screen.getByRole("slider", { name: "Print darkness" });
    expect(slider).toHaveAttribute("aria-valuetext", "Medium");
    fireEvent.change(slider, { target: { value: "2" } });
    expect(slider).toHaveAttribute("aria-valuetext", "High");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        "printer",
        expect.objectContaining({ darkness: 2 }),
      ),
    );
  });

  it("does not show an unavailable-darkness message", () => {
    renderDialog();

    expect(
      screen.queryByText(/does not report an adjustable darkness setting/i),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeEnabled();
  });
});
