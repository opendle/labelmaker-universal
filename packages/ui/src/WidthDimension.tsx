import type { LabelPlate } from "@labelmaker/domain";
import { LockKeyhole, ScanLine } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  isFlagPlate,
  MAX_FIXED_PLATE_WIDTH_MM,
  setPlateFixedWidth,
} from "./editor-operations.js";
import { displayMillimeters } from "./label-layout.js";
import "./width-dimension.css";

export function WidthDimension({
  plate,
  outputWidthMm,
  onChange,
}: {
  readonly plate: LabelPlate;
  readonly outputWidthMm: number;
  readonly onChange: (plate: LabelPlate) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const canceledRef = useRef(false);
  const changedRef = useRef(false);
  const automaticPointerRef = useRef<number | null>(null);
  const canceledPointerClickRef = useRef(false);
  const minimum = isFlagPlate(plate) ? 4 : 1;

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    const blurOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !fieldRef.current?.contains(event.target)
      ) {
        inputRef.current?.blur();
      }
    };
    document.addEventListener("pointerdown", blurOutside, true);
    return () => document.removeEventListener("pointerdown", blurOutside, true);
  }, [editing]);

  function startEditing() {
    canceledRef.current = false;
    changedRef.current = false;
    setDraft(String(plate.size.widthMm));
    setEditing(true);
  }

  function finishEditing() {
    if (canceledRef.current) return;
    const value = Number(draft);
    if (
      changedRef.current &&
      draft.trim() &&
      Number.isFinite(value) &&
      value >= minimum &&
      value <= MAX_FIXED_PLATE_WIDTH_MM
    ) {
      onChange(setPlateFixedWidth(plate, value));
    }
    setEditing(false);
  }

  function restoreAutomaticWidth() {
    if (canceledRef.current) return;
    canceledRef.current = true;
    onChange({ ...plate, widthMode: "auto" });
    setEditing(false);
  }

  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    canceledRef.current = true;
    setEditing(false);
  }

  return (
    <div className="width-dimension" ref={fieldRef}>
      {editing ? (
        <>
          <label className="dimension-value width-dimension-field">
            <span className="dimension-number">
              <span aria-hidden="true">{draft || "0"}</span>
              <input
                aria-label="Plate width"
                inputMode="decimal"
                min={minimum}
                max={MAX_FIXED_PLATE_WIDTH_MM}
                onBlur={(event) => {
                  if (
                    event.relatedTarget instanceof Node &&
                    fieldRef.current?.contains(event.relatedTarget)
                  )
                    return;
                  finishEditing();
                }}
                onChange={(event) => {
                  changedRef.current = true;
                  setDraft(event.target.value);
                }}
                onKeyDown={(event) => {
                  cancelOnEscape(event);
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (!event.currentTarget.reportValidity()) return;
                    changedRef.current = true;
                    finishEditing();
                  }
                }}
                ref={inputRef}
                required
                step={0.1}
                type="number"
                value={draft}
              />
            </span>
            <b aria-hidden="true">mm</b>
          </label>
          <button
            aria-label="Use automatic width"
            className="width-auto-action"
            onBlur={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                fieldRef.current?.contains(event.relatedTarget)
              )
                return;
              finishEditing();
            }}
            onClick={(event) => {
              if (event.detail === 0 || !canceledPointerClickRef.current)
                restoreAutomaticWidth();
            }}
            onKeyDown={cancelOnEscape}
            onPointerDown={(event) => {
              event.preventDefault();
              automaticPointerRef.current = event.pointerId;
              canceledPointerClickRef.current = false;
              event.currentTarget.focus();
            }}
            onPointerCancel={() => {
              automaticPointerRef.current = null;
              canceledPointerClickRef.current = true;
            }}
            onPointerUp={(event) => {
              const startedHere =
                automaticPointerRef.current === event.pointerId;
              automaticPointerRef.current = null;
              const bounds = event.currentTarget.getBoundingClientRect();
              const releasedInside =
                startedHere &&
                event.clientX >= bounds.left &&
                event.clientX <= bounds.right &&
                event.clientY >= bounds.top &&
                event.clientY <= bounds.bottom;
              canceledPointerClickRef.current = !releasedInside;
              if (releasedInside && event.pointerType !== "mouse")
                restoreAutomaticWidth();
            }}
            title="Use automatic width"
            type="button"
          >
            <ScanLine aria-hidden="true" />
          </button>
        </>
      ) : (
        <button
          aria-label={`Plate width: ${displayMillimeters(outputWidthMm)} mm${plate.widthMode === "fixed" ? ", fixed" : ", automatic"}. Edit width`}
          className="width-dimension-display"
          onClick={startEditing}
          title="Label width. Click to set a fixed width in millimeters."
          type="button"
        >
          {displayMillimeters(outputWidthMm)} mm
          {plate.widthMode === "fixed" ? (
            <LockKeyhole aria-label="Fixed width" />
          ) : null}
        </button>
      )}
    </div>
  );
}
