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
    saving: false,
  }));
  if (!open || !printer) return null;

  const parsedPrintHeadSizeMm = Number(form.printHeadSizeMm);
  const parsedMarginTopMm = Number(form.marginTopMm);
  const parsedMarginBottomMm = Number(form.marginBottomMm);
  const displayName = form.displayName.trim();
  const deviceName = printer.deviceName ?? printer.name;
  const displayNameIsValid =
    displayName.length > 0 &&
    displayName.length <= MAX_PRINTER_DISPLAY_NAME_LENGTH;
  const geometryIsValid =
    validMillimeterSetting(form.printHeadSizeMm, parsedPrintHeadSizeMm, 0.1) &&
    validMillimeterSetting(form.marginTopMm, parsedMarginTopMm, 0) &&
    validMillimeterSetting(form.marginBottomMm, parsedMarginBottomMm, 0);
  const save = async () => {
    if (form.saving || !geometryIsValid || !displayNameIsValid) return;
    const settings: PrinterSettings = {
      ...(displayName === deviceName ? {} : { displayName }),
      ...(printer.darkness ? { darkness: form.darkness } : {}),
      printHeadSizeMm: parsedPrintHeadSizeMm,
      marginTopMm: parsedMarginTopMm,
      marginBottomMm: parsedMarginBottomMm,
    };
    setForm((current) => ({ ...current, saving: true }));
    try {
      if (await onSave(printer.id, settings)) onClose();
    } finally {
      setForm((current) => ({ ...current, saving: false }));
    }
  };
  const geometryFields = [
    {
      key: "printHeadSizeMm" as const,
      label: "Print head size",
      minimum: 0.1,
    },
    { key: "marginTopMm" as const, label: "Top margin", minimum: 0 },
    { key: "marginBottomMm" as const, label: "Bottom margin", minimum: 0 },
  ];
  return (
    <Modal labelId="printer-settings-title" onClose={onClose}>
      <div className="dialog-header">
        <div>
          <h2 id="printer-settings-title">Printer settings</h2>
          <p>
            {printer.name} · {printer.model}
          </p>
        </div>
        <IconButton
          disabled={form.saving}
          label="Close printer settings"
          onClick={onClose}
        >
          <X size={18} />
        </IconButton>
      </div>
      <div className="printer-settings-content">
        <label className="printer-name-setting">
          <span>Printer name</span>
          <div className="printer-name-control">
            <input
              aria-label="Printer name"
              aria-describedby="printer-name-help"
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
          <small id="printer-name-help">
            This changes only the name shown in Labelmaker.
          </small>
        </label>
        <dl className="printer-capabilities">
          <div>
            <dt>Resolution</dt>
            <dd>
              {printer.dpi === undefined
                ? "Not reported"
                : `${printer.dpi} dpi`}
            </dd>
          </div>
          <div>
            <dt>Raster width</dt>
            <dd>
              {printer.rasterWidthPixels === undefined
                ? "Not reported"
                : `${printer.rasterWidthPixels} pixels`}
            </dd>
          </div>
        </dl>
        <fieldset className="printer-geometry-settings">
          <legend>Print head geometry</legend>
          <div className="printer-geometry-grid">
            {geometryFields.map((field) => (
              <label className="printer-number-setting" key={field.key}>
                <span>{field.label}</span>
                <span className="unit-input">
                  <input
                    aria-label={field.label}
                    disabled={form.saving}
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
        </fieldset>
        {printer.darkness ? (
          <label className="darkness-setting">
            <span>
              <strong>Darkness</strong>
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
          className="button secondary"
          disabled={form.saving}
          onClick={onClose}
          type="button"
        >
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!displayNameIsValid || !geometryIsValid || form.saving}
          onClick={() => void save()}
          type="button"
        >
          {form.saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </Modal>
  );
}
