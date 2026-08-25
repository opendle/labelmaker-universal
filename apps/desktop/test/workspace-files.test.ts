import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

import { createBlankLabelDocument } from "@labelmaker/documents";
import { describe, expect, it } from "vitest";

import {
  readWorkspaceFile,
  writeWorkspaceFile,
} from "../src/main/workspace-files.js";

describe("desktop workspace files", () => {
  it("writes and reads a gzip-compressed YAML workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-workspace-"));
    const filePath = join(directory, "fixture.lbl");
    const ids = ["workspace-1", "plate-1", "element-1"];
    const document = createBlankLabelDocument(() => ids.shift() ?? "unused-id");

    try {
      await writeWorkspaceFile(filePath, document);

      expect(await readWorkspaceFile(filePath)).toEqual(document);
      const compressed = await readFile(filePath);
      expect([...compressed.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
      const yaml = await promisify(gunzip)(compressed);
      expect(yaml.toString("utf8")).toContain("schemaVersion: 1");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a workspace that is not gzip data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-workspace-"));
    const filePath = join(directory, "invalid.lbl");

    try {
      await writeFile(filePath, "schemaVersion: 1\n", "utf8");
      await expect(readWorkspaceFile(filePath)).rejects.toThrow(
        "Workspace file is not valid gzip data",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
