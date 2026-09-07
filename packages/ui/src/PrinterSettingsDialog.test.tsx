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
  marginTopMm: 1,
  marginBottomMm: 2,
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
    expect(diagram).toHaveTextContent("Example labels · not to scale");
    expect(diagram).toHaveTextContent("Resolution: 203 dpi");
    expect(diagram).toHaveTextContent("Printable area");
    for (const name of [
      "Print head size",
      "Top margin",
      "Bottom margin",
      "Margin between labels",
    ]) {
      expect(diagram).toContainElement(
        screen.getByRole("spinbutton", { name }),
      );
    }
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("saves each edited diagram dimension with its correct setting", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    renderDialog({ onSave });
    for (const [name, value] of [
      ["Print head size", "14.5"],
      ["Top margin", "0.3"],
      ["Bottom margin", "2.7"],
      ["Margin between labels", "3.1"],
    ] as const) {
      const input = screen.getByRole("spinbutton", { name });
      await user.clear(input);
      await user.type(input, value);
    }
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("printer", {
        displayName: "Studio printer",
        printHeadSizeMm: 14.5,
        marginTopMm: 0.3,
        marginBottomMm: 2.7,
        interLabelSpacingMm: 3.1,
      }),
    );
  });

  it("accepts zero margins and gap, and rejects invalid dimensions", () => {
    renderDialog();
    for (const name of [
      "Top margin",
      "Bottom margin",
      "Margin between labels",
    ]) {
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

  it("saves and closes with Enter from a setting", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue(true);
    renderDialog({ onClose, onSave });

    await user.click(screen.getByLabelText("Bottom margin"));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });

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

  it("does not show an unavailable-darkness message", () => {
    renderDialog();

    expect(
      screen.queryByText(/does not report an adjustable darkness setting/i),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeEnabled();
  });
});
