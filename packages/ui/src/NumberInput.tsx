import { useState, type InputHTMLAttributes } from "react";

export function NumberInput({
  value,
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
  readonly onValueChange: (value: number) => void;
  readonly normalizeValue?: (value: number) => number;
  readonly onDraftValueChange?: (text: string, expectedValue: number) => void;
}) {
  const [draft, setDraft] = useState<{
    readonly text: string;
    readonly expectedValue: number;
  } | null>(null);
  const displayValue =
    draft !== null && draft.expectedValue === value ? draft.text : value;

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
          setDraft({ text: rawValue, expectedValue: value });
          onDraftValueChange?.(rawValue, value);
          return;
        }
        const nextValue = Number(rawValue);
        if (!Number.isFinite(nextValue)) return;
        const normalizedValue = normalizeValue?.(nextValue) ?? nextValue;
        setDraft({ text: rawValue, expectedValue: normalizedValue });
        onDraftValueChange?.(rawValue, normalizedValue);
        onValueChange(normalizedValue);
      }}
      onFocus={(event) => {
        setDraft({ text: String(value), expectedValue: value });
        onFocus?.(event);
      }}
      type="number"
      value={displayValue}
    />
  );
}
