import { DEFAULT_TEXT_TYPEFACE } from "@labelmaker/domain";

export const DEFAULT_TYPEFACE = DEFAULT_TEXT_TYPEFACE;

export const TYPEFACES = [
  { label: "Avenir Next", value: DEFAULT_TYPEFACE },
  {
    label: "Helvetica Neue",
    value: '"Helvetica Neue", Arial, sans-serif',
  },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Trebuchet MS", value: '"Trebuchet MS", sans-serif' },
  { label: "Gill Sans", value: '"Gill Sans", Calibri, sans-serif' },
  { label: "Futura", value: 'Futura, "Century Gothic", sans-serif' },
  { label: "Georgia", value: "Georgia, serif" },
  {
    label: "Baskerville",
    value: 'Baskerville, "Times New Roman", serif',
  },
  { label: "Times New Roman", value: '"Times New Roman", serif' },
  { label: "Courier New", value: '"Courier New", monospace' },
  { label: "Menlo", value: "Menlo, Consolas, monospace" },
] as const;
