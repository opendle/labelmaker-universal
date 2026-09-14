import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { NumberInput } from "./NumberInput.js";

type DimensionProps = {
  readonly label: string;
  readonly min: number;
  readonly max?: number;
  readonly disabled?: boolean;
  readonly description?: string;
} & (
  | {
      readonly mode?: "number";
      readonly value: number;
      readonly onChange: (value: number) => void;
    }
  | {
      readonly mode: "draft";
      readonly value: string;
      readonly onChange: (value: string) => void;
    }
);

export function EditableDimension(props: DimensionProps) {
  const [draftWidth, setDraftWidth] = useState<{
    value: number | string;
    text: string;
  } | null>(null);
  const widthText =
    draftWidth?.value === props.value ? draftWidth.text : String(props.value);
  const fieldRef = useRef<HTMLLabelElement>(null);
  useEffect(() => {
    const blurOutside = (event: PointerEvent) => {
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement &&
        fieldRef.current?.contains(active) &&
        event.target !== active
      )
        active.blur();
    };
    document.addEventListener("pointerdown", blurOutside, true);
    return () => document.removeEventListener("pointerdown", blurOutside, true);
  }, []);

  const title = `${props.description ?? props.label}. Click to edit in millimeters.`;
  const inputProps = {
    "aria-label": props.label,
    disabled: props.disabled,
    inputMode: "decimal",
    min: props.min,
    max: props.max,
    onFocus: (event) => event.currentTarget.select(),
    onMouseDown: (event) => {
      if (document.activeElement === event.currentTarget) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.select();
    },
    onBlur: () => setDraftWidth(null),
    onKeyDown: (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.currentTarget.blur();
    },
    step: 0.1,
    title,
  } satisfies InputHTMLAttributes<HTMLInputElement>;

  return (
    <label className="dimension-value" ref={fieldRef} title={title}>
      <span className="dimension-number">
        <span aria-hidden="true">{widthText || "0"}</span>
        {props.mode === "draft" ? (
          <input
            {...inputProps}
            required
            type="number"
            value={props.value}
            onChange={(event) => {
              const text = event.target.value;
              setDraftWidth({ value: text, text });
              props.onChange(text);
            }}
          />
        ) : (
          <NumberInput
            {...inputProps}
            value={props.value}
            normalizeValue={(next) => Math.max(props.min, next)}
            onValueChange={props.onChange}
            onDraftValueChange={(text, value) => setDraftWidth({ text, value })}
          />
        )}
      </span>
      <b aria-hidden="true">mm</b>
    </label>
  );
}
