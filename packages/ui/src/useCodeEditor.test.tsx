// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { CodeElement, LabelPlate } from "@labelmaker/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleDocument } from "./sample.js";
import { useCodeEditor } from "./useCodeEditor.js";

afterEach(cleanup);

describe("bulk code edits", () => {
  it.each(["qr", "barcode"] as const)(
    "applies %s content once and preserves each frame",
    (kind) => {
      const first: CodeElement = {
        id: "first",
        kind,
        format: kind === "qr" ? "qr" : "code128",
        value: "First",
        xMm: 2,
        yMm: 3,
        widthMm: 10,
        heightMm: 8,
        rotationDeg: 0,
      };
      const second: CodeElement = {
        ...first,
        id: "second",
        value: "Second",
        xMm: 25,
        yMm: 5,
        widthMm: 18,
        rotationDeg: 90,
      };
      const plate: LabelPlate = {
        ...sampleDocument.plates[0]!,
        elements: [first, second],
      };
      const editWorkspace = vi.fn();
      const selectElement = vi.fn();
      const { result } = renderHook(() =>
        useCodeEditor({
          activePlate: plate,
          workspace: { ...sampleDocument, plates: [plate] },
          printableMargins: { topMm: 0, bottomMm: 0 },
          editWorkspace,
          selectElement,
          selectedElementIds: [first.id, second.id],
        }),
      );
      act(() => result.current.openCode(first));
      act(() =>
        result.current.dialog?.props.onSave({
          kind,
          format: first.format,
          value: "Shared",
          includeMargin: true,
        }),
      );
      expect(editWorkspace).toHaveBeenCalledOnce();
      expect(editWorkspace.mock.calls[0]![0].plates[0].elements).toEqual([
        { ...first, value: "Shared", includeMargin: true },
        { ...second, value: "Shared", includeMargin: true },
      ]);
      expect(selectElement).not.toHaveBeenCalled();
      expect(result.current.isOpen).toBe(false);
    },
  );
});
