// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { describe, expect, it, vi } from "vitest";

import {
  clearImageFileInputMarker,
  openImageFileInput,
} from "./image-file-input.js";

describe("Android image file input marker", () => {
  it("marks the hidden input before it opens the native file chooser", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.click = vi.fn();

    openImageFileInput(input);

    expect(input.dataset.labelmakerNativeImport).toBe("pending");
    expect(input.click).toHaveBeenCalledOnce();
  });

  it("removes a stale marker after the prior picker is canceled", () => {
    const staleInput = document.createElement("input");
    staleInput.dataset.labelmakerNativeImport = "pending";
    const currentInput = document.createElement("input");
    currentInput.click = vi.fn();
    document.body.append(staleInput, currentInput);

    openImageFileInput(currentInput);

    expect(staleInput).not.toHaveAttribute("data-labelmaker-native-import");
    expect(currentInput.dataset.labelmakerNativeImport).toBe("pending");
    staleInput.remove();
    currentInput.remove();
  });

  it("removes the marker after the file input changes", () => {
    const input = document.createElement("input");
    input.dataset.labelmakerNativeImport = "pending";

    clearImageFileInputMarker(input);

    expect(input).not.toHaveAttribute("data-labelmaker-native-import");
  });
});
