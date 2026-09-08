import { useEffect, useRef, type InputHTMLAttributes } from "react";
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
  const fieldRef = useRef<HTMLSpanElement>(null);
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
    onKeyDown: (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.currentTarget.blur();
    },
    step: 0.1,
    style: { width: `${Math.max(1, String(props.value).length)}ch` },
    title,
  } satisfies InputHTMLAttributes<HTMLInputElement>;

  return (
    <span className="dimension-value" ref={fieldRef} title={title}>
      {props.mode === "draft" ? (
        <input
          {...inputProps}
          required
          type="number"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      ) : (
        <NumberInput
          {...inputProps}
          value={props.value}
          normalizeValue={(next) => Math.max(props.min, next)}
          onValueChange={props.onChange}
        />
      )}
      <b aria-hidden="true">mm</b>
    </span>
  );
}
