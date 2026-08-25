import { createBlankLabelDocument } from "@labelmaker/documents";
import { describe, expect, it } from "vitest";

import { validatePrintRequest } from "../src/main/print-request.js";

const ids = ["workspace-1", "plate-1", "element-1"];
const document = createBlankLabelDocument(() => ids.shift() ?? "unused-id");

describe("desktop print request validation", () => {
  it("accepts document plate IDs", () => {
    expect(
      validatePrintRequest({
        document,
        printerId: "printer-1",
        plateIds: ["plate-1"],
      }),
    ).toEqual({ document, printerId: "printer-1", plateIds: ["plate-1"] });
  });

  it.each([
    ["missing printer", { document, printerId: "", plateIds: ["plate-1"] }],
    ["empty plates", { document, printerId: "printer-1", plateIds: [] }],
    [
      "unknown plate",
      { document, printerId: "printer-1", plateIds: ["unknown"] },
    ],
    [
      "duplicate plate",
      {
        document,
        printerId: "printer-1",
        plateIds: ["plate-1", "plate-1"],
      },
    ],
  ])("rejects %s", (_name, request) => {
    expect(() => validatePrintRequest(request)).toThrow(TypeError);
  });
});
