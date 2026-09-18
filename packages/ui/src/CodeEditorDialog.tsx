import type {
  BarcodeFormat,
  CodeElement,
  QrData,
  QrErrorCorrection,
} from "@labelmaker/domain";
import { buildQrPayload, generateCodeArtwork } from "@labelmaker/rendering";
import { Barcode, QrCode, X } from "lucide-react";
import { useMemo, useState } from "react";

import {
  QR_FORMS,
  qrDataFromForm,
  qrFormValues,
  type QrFormValues,
} from "./qr-code-forms.js";
import { QrFields } from "./CodeEditorDialogForms.js";
import { IconButton } from "./controls.js";
import { Modal } from "./Modal.js";
import "./code-editor.css";

export type CodeConfiguration = Pick<
  CodeElement,
  "kind" | "value" | "format" | "qr" | "barcode" | "includeMargin"
>;

const BARCODE_FORMATS: Record<
  BarcodeFormat,
  {
    readonly label: string;
    readonly hint: string;
    readonly placeholder: string;
  }
> = {
  code128: {
    label: "Code 128",
    hint: "Use letters, numbers, and common symbols.",
    placeholder: "ABC-123456",
  },
  code39: {
    label: "Code 39",
    hint: "Use A–Z, 0–9, spaces, or - . $ / + %.",
    placeholder: "ABC-123456",
  },
  ean13: {
    label: "EAN-13",
    hint: "Enter 12 digits, or 13 digits with a valid check digit.",
    placeholder: "590123412345",
  },
  ean8: {
    label: "EAN-8",
    hint: "Enter 7 digits, or 8 digits with a valid check digit.",
    placeholder: "9638507",
  },
  upca: {
    label: "UPC-A",
    hint: "Enter 11 digits, or 12 digits with a valid check digit.",
    placeholder: "03600029145",
  },
  itf14: {
    label: "ITF-14",
    hint: "Enter 13 digits, or 14 digits with a valid check digit.",
    placeholder: "1001234500001",
  },
  interleaved2of5: {
    label: "Interleaved 2 of 5",
    hint: "Use an even number of digits.",
    placeholder: "12345678",
  },
  datamatrix: {
    label: "Data Matrix",
    hint: "Use text or numbers. This format makes a square code.",
    placeholder: "Part: ABC-123456",
  },
  pdf417: {
    label: "PDF417",
    hint: "Use text or numbers. This format makes a stacked code.",
    placeholder: "Part: ABC-123456",
  },
};

interface EditorState {
  readonly qrType: QrData["type"];
  readonly drafts: Partial<Record<QrData["type"], QrFormValues>>;
  readonly errorCorrection: QrErrorCorrection;
  readonly format: BarcodeFormat;
  readonly value: string;
  readonly showText: boolean;
  readonly includeMargin: boolean;
}
function initialState(code: CodeElement | undefined): EditorState {
  const data: QrData = code?.qr?.data ?? {
    type: "text",
    text: code?.kind === "qr" ? code.value : "",
  };
  return {
    qrType: data.type,
    drafts: { [data.type]: qrFormValues(data) },
    errorCorrection: code?.qr?.errorCorrection ?? "M",
    format:
      code?.format && Object.hasOwn(BARCODE_FORMATS, code.format)
        ? (code.format as BarcodeFormat)
        : "code128",
    value: code?.kind === "barcode" ? code.value : "",
    showText: code?.barcode?.showText ?? true,
    includeMargin: code?.includeMargin ?? false,
  };
}

export function CodeEditorDialog({
  kind,
  initialCode,
  onSave,
  onClose,
}: {
  readonly kind: "qr" | "barcode";
  readonly initialCode?: CodeElement | undefined;
  readonly onSave: (code: CodeConfiguration) => void;
  readonly onClose: () => void;
}) {
  const [state, setState] = useState(() => initialState(initialCode));
  const result = useMemo(() => {
    try {
      let code: CodeConfiguration;
      if (kind === "qr") {
        const data = qrDataFromForm(
          state.qrType,
          state.drafts[state.qrType] ?? QR_FORMS[state.qrType].defaults ?? {},
        );
        code = {
          kind: "qr",
          includeMargin: state.includeMargin,
          format: "qr",
          value: buildQrPayload(data),
          qr: { data, errorCorrection: state.errorCorrection },
        };
      } else {
        code = {
          kind: "barcode",
          includeMargin: state.includeMargin,
          value: state.value,
          format: state.format,
          barcode: { showText: state.showText },
        };
      }
      return { code, artwork: generateCodeArtwork(code), error: "" };
    } catch (error) {
      return {
        code: null,
        artwork: null,
        error:
          error instanceof Error
            ? error.message
            : "The code could not be made. Check its content.",
      };
    }
  }, [kind, state]);
  const name = kind === "qr" ? "QR code" : "barcode";
  const values =
    state.drafts[state.qrType] ?? QR_FORMS[state.qrType].defaults ?? {};
  const updateField = (key: string, value: string | boolean) =>
    setState((previous) => ({
      ...previous,
      drafts: {
        ...previous.drafts,
        [previous.qrType]: {
          ...(previous.drafts[previous.qrType] ??
            QR_FORMS[previous.qrType].defaults),
          [key]: value,
        },
      },
    }));

  return (
    <Modal
      className="code-editor-modal"
      labelId="code-editor-title"
      onClose={onClose}
    >
      <form
        className="code-editor-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (result.code) onSave(result.code);
        }}
      >
        <div className="dialog-header code-editor-header">
          <h2 id="code-editor-title">
            {initialCode ? "Edit" : "Add"} {name}
          </h2>
          <IconButton label={`Close ${name} editor`} onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="code-editor-body">
          <div className="code-editor-fields">
            {kind === "qr" ? (
              <>
                <label className="code-field">
                  <span>QR code type</span>
                  <select
                    aria-label="QR code type"
                    data-autofocus
                    onChange={(event) =>
                      setState((previous) => ({
                        ...previous,
                        qrType: event.target.value as QrData["type"],
                      }))
                    }
                    value={state.qrType}
                  >
                    {Object.entries(QR_FORMS).map(([type, definition]) => (
                      <option key={type} value={type}>
                        {definition.label}
                      </option>
                    ))}
                  </select>
                </label>
                <QrFields
                  onChange={updateField}
                  type={state.qrType}
                  values={values}
                />
                <label className="code-field">
                  <span>Error correction</span>
                  <select
                    aria-label="Error correction"
                    onChange={(event) =>
                      setState((previous) => ({
                        ...previous,
                        errorCorrection: event.target
                          .value as QrErrorCorrection,
                      }))
                    }
                    value={state.errorCorrection}
                  >
                    <option value="L">Low (7%)</option>
                    <option value="M">Medium (15%)</option>
                    <option value="Q">High (25%)</option>
                    <option value="H">Maximum (30%)</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <label className="code-field">
                  <span>Barcode type</span>
                  <select
                    aria-label="Barcode type"
                    data-autofocus
                    onChange={(event) =>
                      setState((previous) => ({
                        ...previous,
                        format: event.target.value as BarcodeFormat,
                      }))
                    }
                    value={state.format}
                  >
                    {Object.entries(BARCODE_FORMATS).map(
                      ([format, definition]) => (
                        <option key={format} value={format}>
                          {definition.label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="code-field">
                  <span>Content</span>
                  <textarea
                    aria-label="Content"
                    aria-describedby="barcode-format-help code-editor-status"
                    autoCapitalize="off"
                    autoComplete="off"
                    maxLength={4096}
                    onChange={(event) =>
                      setState((previous) => ({
                        ...previous,
                        value: event.target.value,
                      }))
                    }
                    placeholder={BARCODE_FORMATS[state.format].placeholder}
                    rows={3}
                    spellCheck={false}
                    value={state.value}
                  />
                </label>
                <p className="code-help" id="barcode-format-help">
                  {BARCODE_FORMATS[state.format].hint}
                </p>
                {state.format !== "datamatrix" && state.format !== "pdf417" && (
                  <label className="code-checkbox">
                    <input
                      aria-label="Show text below the bars"
                      checked={state.showText}
                      onChange={(event) =>
                        setState((previous) => ({
                          ...previous,
                          showText: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    Show text below the bars
                  </label>
                )}
              </>
            )}
          </div>
          <aside aria-label="Code preview" className="code-editor-preview">
            <div
              className={`code-preview-paper${kind === "barcode" ? " code-preview-barcode" : ""}`}
            >
              {result.artwork ? (
                <img
                  alt={`${name} preview`}
                  draggable={false}
                  height={result.artwork.height}
                  src={result.artwork.dataUrl}
                  width={result.artwork.width}
                />
              ) : (
                <div className="code-preview-empty">
                  {kind === "qr" ? (
                    <QrCode aria-hidden="true" size={40} />
                  ) : (
                    <Barcode aria-hidden="true" size={40} />
                  )}
                  <span>Enter content to see the code.</span>
                </div>
              )}
            </div>
            <label className="code-checkbox">
              <input
                aria-label="Add margin"
                checked={state.includeMargin}
                onChange={(event) =>
                  setState((previous) => ({
                    ...previous,
                    includeMargin: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              Add margin
            </label>
          </aside>
        </div>
        <div className="dialog-footer code-editor-footer">
          <p
            aria-live="polite"
            className="code-editor-status"
            id="code-editor-status"
            role="status"
          >
            {result.error}
          </p>
          <button
            className="button primary"
            disabled={!result.code}
            type="submit"
          >
            {initialCode ? "Save" : "Add"} {name}
          </button>
        </div>
      </form>
    </Modal>
  );
}
