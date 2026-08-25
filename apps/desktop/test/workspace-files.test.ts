import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createBlankLabelDocument } from "@labelmaker/documents";
import { describe, expect, it } from "vitest";

import {
  readWorkspaceFile,
  writeWorkspaceFile,
} from "../src/main/workspace-files.js";

describe("desktop workspace files", () => {
  it("writes and reads a validated workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-workspace-"));
    const filePath = join(directory, "fixture.labelmaker.json");
    const ids = ["workspace-1", "plate-1", "element-1"];
    const document = createBlankLabelDocument(() => ids.shift() ?? "unused-id");

    try {
      await writeWorkspaceFile(filePath, document);

      expect(await readWorkspaceFile(filePath)).toEqual(document);
      expect((await readFile(filePath, "utf8")).endsWith("\n")).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
