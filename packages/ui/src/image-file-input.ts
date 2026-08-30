/** Mark the exact hidden input before Android WebChromeClient opens its picker. */
export function openImageFileInput(input: HTMLInputElement | null): void {
  if (!input) return;
  for (const pendingInput of document.querySelectorAll<HTMLInputElement>(
    'input[data-labelmaker-native-import="pending"]',
  )) {
    clearImageFileInputMarker(pendingInput);
  }
  input.dataset.labelmakerNativeImport = "pending";
  input.click();
}

export function clearImageFileInputMarker(input: HTMLInputElement): void {
  delete input.dataset.labelmakerNativeImport;
}
