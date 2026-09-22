import { useState, type InputHTMLAttributes } from "react";

export function NumberInput({
  value,
  mixed = false,
  onValueChange,
  normalizeValue,
  onDraftValueChange,
  onBlur,
  onFocus,
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "type" | "value"
> & {
  readonly value: number;
  readonly mixed?: boolean;
  readonly onValueChange: (value: number) => void;
  readonly normalizeValue?: (value: number) => number;
  readonly onDraftValueChange?: (text: string, expectedValue: number) => void;
}) {
  const [draft, setDraft] = useState<{
    readonly text: string;
    readonly expectedValue: number;
    readonly expectedMixed: boolean;
  } | null>(null);
  const displayValue =
    draft !== null &&
    draft.expectedValue === value &&
    draft.expectedMixed === mixed
      ? draft.text
      : mixed
        ? ""
        : value;

  return (
    <input
      {...props}
      onBlur={(event) => {
        setDraft(null);
        onBlur?.(event);
      }}
      onChange={(event) => {
        const rawValue = event.target.value;
        if (rawValue.trim() === "") {
          setDraft({
            text: rawValue,
            expectedValue: value,
            expectedMixed: mixed,
          });
          onDraftValueChange?.(rawValue, value);
          return;
        }
        const nextValue = Number(rawValue);
        if (!Number.isFinite(nextValue)) return;
        const normalizedValue = normalizeValue?.(nextValue) ?? nextValue;
        setDraft({
          text: rawValue,
          expectedValue: normalizedValue,
          expectedMixed: false,
        });
        onDraftValueChange?.(rawValue, normalizedValue);
        onValueChange(normalizedValue);
      }}
      onFocus={(event) => {
        setDraft({
          text: mixed ? "" : String(value),
          expectedValue: value,
          expectedMixed: mixed,
        });
        onFocus?.(event);
      }}
      type="number"
      value={displayValue}
    />
  );
}
