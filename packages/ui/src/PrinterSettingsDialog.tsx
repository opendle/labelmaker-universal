import { X } from "lucide-react";
import { useState } from "react";

import { MAX_PRINTER_DISPLAY_NAME_LENGTH } from "@labelmaker/printing";

import { IconButton } from "./controls.js";
import type { PrinterSettings, PrinterSummary } from "./host.js";
import { Modal } from "./Modal.js";

interface PrinterSettingsForm {
  readonly displayName: string;
  readonly darkness: number;
  readonly printHeadSizeMm: string;
  readonly marginTopMm: string;
  readonly marginBottomMm: string;
  readonly interLabelSpacingMm: string;
  readonly saving: boolean;
}

function validMillimeterSetting(
  source: string,
  value: number,
  minimum: number,
): boolean {
  return (
    source.trim().length > 0 &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= 100 &&
    Math.abs(value * 10 - Math.round(value * 10)) < 1e-8
  );
}

export function PrinterSettingsDialog({
  open,
  printer,
  onClose,
  onSave,
}: {
  readonly open: boolean;
  readonly printer: PrinterSummary | undefined;
  readonly onClose: () => void;
  readonly onSave: (
    printerId: string,
    settings: PrinterSettings,
  ) => boolean | Promise<boolean>;
}) {
  const [form, setForm] = useState<PrinterSettingsForm>(() => ({
    displayName: printer?.name ?? "",
    darkness: printer?.darkness?.value ?? 0,
    printHeadSizeMm: String(printer?.printableWidthMm ?? ""),
    marginTopMm: String(printer?.marginTopMm ?? 0),
    marginBottomMm: String(printer?.marginBottomMm ?? 0),
    interLabelSpacingMm: String(printer?.interLabelSpacingMm ?? 1),
    saving: false,
  }));
  if (!open || !printer) return null;

  const parsedPrintHeadSizeMm = Number(form.printHeadSizeMm);
  const parsedMarginTopMm = Number(form.marginTopMm);
  const parsedMarginBottomMm = Number(form.marginBottomMm);
  const parsedInterLabelSpacingMm = Number(form.interLabelSpacingMm);
  const displayName = form.displayName.trim();
  const deviceName = printer.deviceName ?? printer.name;
  const displayNameIsValid =
    displayName.length > 0 &&
    displayName.length <= MAX_PRINTER_DISPLAY_NAME_LENGTH;
  const geometryIsValid =
    validMillimeterSetting(form.printHeadSizeMm, parsedPrintHeadSizeMm, 0.1) &&
    validMillimeterSetting(form.marginTopMm, parsedMarginTopMm, 0) &&
    validMillimeterSetting(form.marginBottomMm, parsedMarginBottomMm, 0) &&
    validMillimeterSetting(
      form.interLabelSpacingMm,
      parsedInterLabelSpacingMm,
      0,
    );
  const save = async () => {
    if (form.saving || !geometryIsValid || !displayNameIsValid) return;
    const settings: PrinterSettings = {
      ...(displayName === deviceName ? {} : { displayName }),
      ...(printer.darkness ? { darkness: form.darkness } : {}),
      printHeadSizeMm: parsedPrintHeadSizeMm,
      marginTopMm: parsedMarginTopMm,
      marginBottomMm: parsedMarginBottomMm,
      interLabelSpacingMm: parsedInterLabelSpacingMm,
    };
    setForm((current) => ({ ...current, saving: true }));
    try {
      if (await onSave(printer.id, settings)) onClose();
    } finally {
      setForm((current) => ({ ...current, saving: false }));
    }
  };
  const marginFields = [
    { key: "marginTopMm" as const, label: "Top margin", minimum: 0 },
    { key: "marginBottomMm" as const, label: "Bottom margin", minimum: 0 },
    {
      key: "interLabelSpacingMm" as const,
      label: "Margin between labels",
      minimum: 0,
    },
  ];
  return (
    <Modal labelId="printer-settings-title" onClose={onClose}>
      <div className="dialog-header">
        <div>
          <h2 id="printer-settings-title">Printer settings</h2>
          <p>{printer.model}</p>
        </div>
        <IconButton
          disabled={form.saving}
          label="Close printer settings"
          onClick={onClose}
        >
          <X size={18} />
        </IconButton>
      </div>
      <form
        className="printer-settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="printer-settings-content">
          <label className="printer-name-setting">
            <span>PRINTER NAME</span>
            <div className="printer-name-control">
              <input
                aria-label="Printer name"
                disabled={form.saving}
                maxLength={MAX_PRINTER_DISPLAY_NAME_LENGTH}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
                required
                type="text"
                value={form.displayName}
              />
              <button
                className="button secondary small"
                disabled={form.saving || form.displayName === deviceName}
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    displayName: deviceName,
                  }))
                }
                type="button"
              >
                Use device name
              </button>
            </div>
          </label>
          <div className="printer-geometry-settings">
            <div className="printer-geometry-grid printer-geometry-primary-grid">
              <label className="printer-readonly-setting">
                <span>RESOLUTION</span>
                <output>
                  {printer.dpi === undefined
                    ? "Not reported"
                    : `${printer.dpi} dpi`}
                </output>
              </label>
              <label className="printer-number-setting">
                <span>PRINT HEAD SIZE</span>
                <span className="unit-input">
                  <input
                    aria-label="Print head size"
                    disabled={form.saving}
                    inputMode="decimal"
                    max={100}
                    min={0.1}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        printHeadSizeMm: event.target.value,
                      }))
                    }
                    required
                    step={0.1}
                    type="number"
                    value={form.printHeadSizeMm}
                  />
                  <b>mm</b>
                </span>
              </label>
            </div>
            <div className="printer-geometry-grid printer-margin-grid">
              {marginFields.map((field) => (
                <label className="printer-number-setting" key={field.key}>
                  <span>{field.label.toUpperCase()}</span>
                  <span className="unit-input">
                    <input
                      aria-label={field.label}
                      disabled={form.saving}
                      inputMode="decimal"
                      max={100}
                      min={field.minimum}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                      required
                      step={0.1}
                      type="number"
                      value={form[field.key]}
                    />
                    <b>mm</b>
                  </span>
                </label>
              ))}
            </div>
          </div>
          {printer.darkness ? (
            <label className="darkness-setting">
              <span>
                <strong>DARKNESS</strong>
                <output>{form.darkness}</output>
              </span>
              <input
                aria-label="Print darkness"
                disabled={form.saving}
                max={printer.darkness.maximum}
                min={printer.darkness.minimum}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    darkness: Number(event.target.value),
                  }))
                }
                step={printer.darkness.step}
                type="range"
                value={form.darkness}
              />
              <small>
                {printer.darkness.minimum} lighter · {printer.darkness.maximum}{" "}
                darker
              </small>
            </label>
          ) : (
            <p className="printer-setting-unavailable">
              This printer does not report an adjustable darkness setting.
            </p>
          )}
        </div>
        <div className="dialog-footer end">
          <button
            className="button primary"
            disabled={!displayNameIsValid || !geometryIsValid || form.saving}
            type="submit"
          >
            {form.saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
