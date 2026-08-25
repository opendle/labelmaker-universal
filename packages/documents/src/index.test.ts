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
    expect(parseLabelDocument(serialized)).toEqual(document);
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

  it("rejects invalid JSON with a safe message", () => {
    expect(() => parseLabelDocument("not-json")).toThrow(
      "Workspace file is not valid JSON",
    );
  });
});
