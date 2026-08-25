import { randomUUID } from "node:crypto";
import { copyFile, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  LabelDocumentError,
  MAX_WORKSPACE_BYTES,
  parseLabelDocument,
  serializeLabelDocument,
} from "@labelmaker/documents";
import type { LabelDocument } from "@labelmaker/domain";

export async function readWorkspaceFile(
  filePath: string,
): Promise<LabelDocument> {
  const metadata = await stat(filePath);
  if (metadata.size > MAX_WORKSPACE_BYTES) {
    throw new LabelDocumentError(
      "DOCUMENT_TOO_LARGE",
      `Workspace files must be smaller than ${MAX_WORKSPACE_BYTES} bytes`,
    );
  }
  return parseLabelDocument(await readFile(filePath, "utf8"));
}

export async function writeWorkspaceFile(
  filePath: string,
  document: LabelDocument,
): Promise<void> {
  const contents = serializeLabelDocument(document);
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }

  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      process.platform !== "win32" ||
      (code !== "EEXIST" && code !== "EPERM")
    ) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
    // Windows does not always replace an existing file with rename().
    try {
      await copyFile(temporaryPath, filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}
