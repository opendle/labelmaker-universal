import { gzipSync, gunzipSync } from "node:zlib";
import {
  createBlankLabelDocument,
  MAX_WORKSPACE_BYTES,
  parseLabelDocument,
  serializeLabelDocument,
} from "@labelmaker/documents";
import { describe, expect, it } from "vitest";

import { decodeWorkspace, encodeWorkspace } from "../src/document-codec.js";

describe("mobile workspace codec", () => {
  it("writes gzip YAML that the desktop codec can read", async () => {
    const document = createBlankLabelDocument();
    const encoded = await encodeWorkspace(document);
    const yaml = gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");

    expect(parseLabelDocument(yaml)).toEqual(document);
    await expect(decodeWorkspace(encoded)).resolves.toEqual(document);
  });

  it("reads gzip YAML from the desktop codec", async () => {
    const document = { ...createBlankLabelDocument(), name: "Labels é 日本語" };
    const encoded = gzipSync(serializeLabelDocument(document)).toString(
      "base64",
    );

    await expect(decodeWorkspace(encoded)).resolves.toEqual(document);
  });

  it("rejects invalid base64 and damaged gzip", async () => {
    await expect(decodeWorkspace("%invalid%")).rejects.toThrow("base64");
    await expect(decodeWorkspace("AAAA")).rejects.toThrow("gzip");
  });

  it("rejects invalid UTF-8 instead of changing saved text", async () => {
    const encoded = gzipSync(Uint8Array.of(0xff)).toString("base64");

    await expect(decodeWorkspace(encoded)).rejects.toThrow();
  });

  it("rejects gzip data that expands beyond the workspace limit", async () => {
    const encoded = gzipSync(
      Buffer.alloc(MAX_WORKSPACE_BYTES + 1, 0x20),
    ).toString("base64");

    await expect(decodeWorkspace(encoded)).rejects.toThrow("gzip");
  });

  it("rejects an unsupported schema before the workspace enters the editor", async () => {
    const document = { ...createBlankLabelDocument(), schemaVersion: 2 };
    const encoded = gzipSync(JSON.stringify(document)).toString("base64");

    await expect(decodeWorkspace(encoded)).rejects.toMatchObject({
      code: "UNSUPPORTED_SCHEMA_VERSION",
    });
  });
});
