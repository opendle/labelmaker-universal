// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
}: {
  readonly onClose?: () => void;
  readonly onSave?: (
    printerId: string,
    settings: PrinterSettings,
  ) => boolean | Promise<boolean>;
} = {}) {
  return render(
    <>
      <div className="application-content" />
      <PrinterSettingsDialog
        onClose={onClose}
        onSave={onSave}
        open
        printer={printer}
      />
    </>,
  );
}

describe("PrinterSettingsDialog", () => {
  it("groups the capability and geometry fields in two rows", () => {
    renderDialog();

    const firstRow =
      screen.getByText("RESOLUTION").parentElement?.parentElement;
    const marginRow = screen
      .getByLabelText("Top margin")
      .closest(".printer-geometry-grid");

    expect(firstRow).toHaveClass("printer-geometry-primary-grid");
    expect(firstRow).toContainElement(screen.getByLabelText("Print head size"));
    expect(firstRow).not.toContainElement(screen.getByLabelText("Top margin"));
    expect(
      screen.getByText("203 dpi").closest(".printer-readonly-setting"),
    ).toHaveAttribute("aria-disabled", "true");
    expect(marginRow).toContainElement(screen.getByLabelText("Bottom margin"));
    expect(marginRow).toContainElement(
      screen.getByLabelText("Margin between labels"),
    );
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
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
});
