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

describe("workspace documents", () => {
  it("serializes and parses a version 1 workspace", () => {
    const serialized = serializeLabelDocument(document);

    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized).toContain("schemaVersion: 1");
    expect(parseLabelDocument(serialized)).toEqual(document);
  });

  it("accepts old text elements without a font style", () => {
    const oldDocument = structuredClone(document) as unknown as {
      plates: Array<{ elements: Array<Record<string, unknown>> }>;
    };
    delete oldDocument.plates[0]!.elements[0]!.fontStyle;

    const validated = validateLabelDocument(oldDocument);

    expect(validated.plates[0]!.elements[0]).not.toHaveProperty("fontStyle");
  });

  it("preserves italic text and rejects unknown font styles", () => {
    const italicDocument = structuredClone(document) as unknown as {
      plates: Array<{ elements: Array<Record<string, unknown>> }>;
    };
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
    const changed = structuredClone(document) as unknown as {
      plates: Array<{ elements: Array<Record<string, unknown>> }>;
    };
    changed.plates[0]!.elements[0]!.lineHeightPt = 18.5;
    changed.plates[0]!.elements[0]!.verticalAlign = "bottom";

    expect(
      parseLabelDocument(serializeLabelDocument(changed as never)).plates[0]!
        .elements[0],
    ).toMatchObject({ lineHeightPt: 18.5, verticalAlign: "bottom" });
  });

  it("rejects invalid line height and vertical alignment values", () => {
    const changed = structuredClone(document) as unknown as {
      plates: Array<{ elements: Array<Record<string, unknown>> }>;
    };
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
