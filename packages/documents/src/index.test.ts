import { describe, expect, it } from "vitest";

import {
  createBlankLabelDocument,
  LabelDocumentError,
  parseLabelDocument,
  serializeLabelDocument,
  validateLabelDocument,
} from "./index.js";

const ids = ["workspace-1", "plate-1", "element-1"];
const document = createBlankLabelDocument(() => ids.shift() ?? "extra-id");

function mutableElementsDocument() {
  return structuredClone(document) as unknown as {
    plates: Array<{ elements: Array<Record<string, unknown>> }>;
  };
}

function imageElement<T extends Record<string, unknown>>(values: T) {
  return {
    id: "image",
    kind: "image",
    xMm: 1,
    yMm: 1,
    widthMm: 5,
    heightMm: 5,
    rotationDeg: 0,
    source: "data:image/png;base64,image",
    fit: "contain",
    ...values,
  };
}

describe("workspace documents", () => {
  it("names the first label by its position", () => {
    expect(document.plates[0]?.name).toBe("Label 1");
  });

  it("serializes and parses a version 1 workspace", () => {
    const serialized = serializeLabelDocument(document);

    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized).toContain("schemaVersion: 1");
    expect(parseLabelDocument(serialized)).toEqual(document);
  });

  it("accepts old text elements without a font style", () => {
    const oldDocument = mutableElementsDocument();
    delete oldDocument.plates[0]!.elements[0]!.fontStyle;

    const validated = validateLabelDocument(oldDocument);

    expect(validated.plates[0]!.elements[0]).not.toHaveProperty("fontStyle");
  });

  it("preserves italic text and rejects unknown font styles", () => {
    const italicDocument = mutableElementsDocument();
    italicDocument.plates[0]!.elements[0]!.fontStyle = "italic";
    expect(
      parseLabelDocument(serializeLabelDocument(italicDocument as never))
        .plates[0]!.elements[0],
    ).toMatchObject({ fontStyle: "italic" });

    italicDocument.plates[0]!.elements[0]!.fontStyle = "oblique";
    expect(() => validateLabelDocument(italicDocument)).toThrow(
      "fontStyle must be normal or italic",
    );
  });

  it("preserves optional line height and vertical alignment", () => {
    const changed = mutableElementsDocument();
    changed.plates[0]!.elements[0]!.lineHeightPt = 18.5;
    changed.plates[0]!.elements[0]!.verticalAlign = "bottom";

    expect(
      parseLabelDocument(serializeLabelDocument(changed as never)).plates[0]!
        .elements[0],
    ).toMatchObject({ lineHeightPt: 18.5, verticalAlign: "bottom" });
  });

  it("rejects invalid line height and vertical alignment values", () => {
    const changed = mutableElementsDocument();
    changed.plates[0]!.elements[0]!.lineHeightPt = 0;
    expect(() => validateLabelDocument(changed)).toThrow(
      "lineHeightPt must be between 0.1 and 1000",
    );

    changed.plates[0]!.elements[0]!.lineHeightPt = 12;
    changed.plates[0]!.elements[0]!.verticalAlign = "baseline";
    expect(() => validateLabelDocument(changed)).toThrow(
      "verticalAlign must be top, middle, or bottom",
    );
  });

  it("preserves the optional print mirror setting", () => {
    const mirrored = {
      ...document,
      plates: [{ ...document.plates[0]!, mirrorPrint: true }],
    };

    expect(parseLabelDocument(serializeLabelDocument(mirrored))).toEqual(
      mirrored,
    );
  });

  it("loads old image tone values and defaults contrast", () => {
    const changed = mutableElementsDocument();
    changed.plates[0]!.elements.push(
      imageElement({
        threshold: 50,
      }),
    );

    expect(validateLabelDocument(changed).plates[0]!.elements[1]).toMatchObject(
      { brightness: 206, contrast: 128, transparentBackground: true },
    );
  });

  it("preserves image tone controls and an opaque background", () => {
    const changed = mutableElementsDocument();
    changed.plates[0]!.elements.push(
      imageElement({
        brightness: 176,
        contrast: 92,
        transparentBackground: true,
      }),
    );
    changed.plates[0]!.elements[1]!.transparentBackground = false;
    changed.plates[0]!.elements[1]!.editorSource = {
      source: "data:image/png;base64,full-image",
      widthPixels: 100,
      heightPixels: 50,
      bounds: { left: 10, top: 5, right: 89, bottom: 44 },
    };
    expect(
      parseLabelDocument(serializeLabelDocument(changed as never)).plates[0]!
        .elements[1],
    ).toMatchObject({
      brightness: 176,
      contrast: 92,
      transparentBackground: false,
      editorSource: {
        source: "data:image/png;base64,full-image",
        widthPixels: 100,
        heightPixels: 50,
        bounds: { left: 10, top: 5, right: 89, bottom: 44 },
      },
    });
  });

  it("rejects invalid image tone values", () => {
    const changed = mutableElementsDocument();
    const image = imageElement({
      brightness: 128,
      contrast: 128,
    });
    changed.plates[0]!.elements.push(image);
    image.brightness = 256;
    expect(() => validateLabelDocument(changed)).toThrow(
      "brightness must be between 0 and 255",
    );

    image.brightness = 128;
    image.contrast = -1;
    expect(() => validateLabelDocument(changed)).toThrow(
      "contrast must be between 0 and 255",
    );
  });

  it("rejects an invalid image background setting", () => {
    const changed = mutableElementsDocument();
    changed.plates[0]!.elements.push(
      imageElement({
        threshold: 128,
        transparentBackground: "yes",
      }),
    );

    expect(() => validateLabelDocument(changed)).toThrow(
      "transparentBackground must be a boolean",
    );
  });

  it("rejects invalid full image editor bounds", () => {
    const changed = mutableElementsDocument();
    changed.plates[0]!.elements.push(
      imageElement({
        threshold: 128,
        editorSource: {
          source: "data:image/png;base64,full-image",
          widthPixels: 10,
          heightPixels: 10,
          bounds: { left: 0, top: 0, right: 10, bottom: 9 },
        },
      }),
    );

    expect(() => validateLabelDocument(changed)).toThrow(
      "editorSource.bounds.right must be between 0 and 9",
    );
  });

  it("preserves shape types and treats an omitted type as a rectangle", () => {
    const changed = mutableElementsDocument();
    const base = changed.plates[0]!.elements[0]!;
    changed.plates[0]!.elements.push({
      id: "shape",
      kind: "rectangle",
      shapeType: "circle",
      xMm: 1,
      yMm: 1,
      widthMm: 5,
      heightMm: 5,
      rotationDeg: 0,
      strokeWidthMm: 0.4,
      filled: false,
      cornerRadiusMm: 0,
    });
    changed.plates[0]!.elements.push({
      ...base,
      id: "old-rectangle",
      kind: "rectangle",
      strokeWidthMm: 0.4,
      filled: false,
      cornerRadiusMm: 0,
    });

    const elements = validateLabelDocument(changed).plates[0]!.elements;
    expect(elements[1]).toMatchObject({ shapeType: "circle" });
    expect(elements[2]).not.toHaveProperty("shapeType");
  });

  it("rejects an invalid shape type", () => {
    const changed = mutableElementsDocument();
    changed.plates[0]!.elements.push({
      id: "shape",
      kind: "rectangle",
      shapeType: "triangle",
      xMm: 1,
      yMm: 1,
      widthMm: 5,
      heightMm: 5,
      rotationDeg: 0,
      strokeWidthMm: 0.4,
      filled: false,
      cornerRadiusMm: 0,
    });

    expect(() => validateLabelDocument(changed)).toThrow(
      "shapeType must be line, rectangle, or circle",
    );
  });

  it("rejects an invalid print mirror setting", () => {
    const invalid = structuredClone(document) as unknown as {
      plates: Array<{ mirrorPrint: unknown }>;
    };
    invalid.plates[0]!.mirrorPrint = "yes";

    expect(() => validateLabelDocument(invalid)).toThrow(
      "workspace.plates[0].mirrorPrint must be a boolean",
    );
  });

  it("reports the path of an invalid nested value", () => {
    const invalid = structuredClone(document) as unknown as {
      plates: Array<{ size: { widthMm: unknown } }>;
    };
    invalid.plates[0]!.size.widthMm = -1;

    expect(() => validateLabelDocument(invalid)).toThrow(
      "workspace.plates[0].size.widthMm must be between 0.1 and 10000",
    );
  });

  it("rejects unsupported schema versions with a stable code", () => {
    try {
      parseLabelDocument('{"schemaVersion":2}');
      expect.fail("Expected parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LabelDocumentError);
      expect((error as LabelDocumentError).code).toBe(
        "UNSUPPORTED_SCHEMA_VERSION",
      );
    }
  });

  it("rejects duplicate IDs", () => {
    const invalid = structuredClone(document) as unknown as {
      plates: Array<{ id: string; elements: Array<{ id: string }> }>;
    };
    invalid.plates[0]!.elements[0]!.id = invalid.plates[0]!.id;

    expect(() => validateLabelDocument(invalid)).toThrow("duplicates the ID");
  });

  it("rejects invalid YAML with a safe message", () => {
    expect(() => parseLabelDocument("workspace: [not-closed")).toThrow(
      "Workspace file is not valid YAML",
    );
  });
});
