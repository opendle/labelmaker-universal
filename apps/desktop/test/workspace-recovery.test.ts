import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBlankLabelDocument } from "@labelmaker/documents";
import { describe, expect, it } from "vitest";

import {
  createWorkspaceRecoveryRecord,
  readWorkspaceRecoveryFile,
  validateWorkspaceRecoveryInput,
  WorkspaceRecoveryStore,
  writeWorkspaceRecoveryFile,
} from "../src/main/workspace-recovery.js";

function recoveryInput() {
  const ids = ["workspace-1", "plate-1", "element-1"];
  const document = createBlankLabelDocument(() => ids.shift() ?? "unused-id");
  return {
    document,
    dirty: true,
    activePlateId: "plate-1",
    selectedElementId: "element-1",
    zoom: 120,
    savedAt: "2026-08-26T12:00:00.000Z",
  };
}

describe("workspace recovery", () => {
  it("round-trips validated editor state and its saved file association", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-recovery-"));
    const recoveryPath = join(directory, "workspace-recovery.json");
    const workspacePath = join(directory, "Workshop labels.lbl");
    const record = createWorkspaceRecoveryRecord(
      recoveryInput(),
      workspacePath,
    );

    try {
      await writeWorkspaceRecoveryFile(recoveryPath, record);
      await expect(readWorkspaceRecoveryFile(recoveryPath)).resolves.toEqual(
        record,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns no recovery state for missing, corrupt, or invalid data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-recovery-"));
    const recoveryPath = join(directory, "workspace-recovery.json");

    try {
      await expect(readWorkspaceRecoveryFile(recoveryPath)).resolves.toBeNull();
      await writeFile(recoveryPath, "not json", "utf8");
      await expect(readWorkspaceRecoveryFile(recoveryPath)).resolves.toBeNull();
      await writeFile(
        recoveryPath,
        JSON.stringify({
          version: 1,
          ...recoveryInput(),
          document: { schemaVersion: 100 },
          filePath: null,
        }),
        "utf8",
      );
      await expect(readWorkspaceRecoveryFile(recoveryPath)).resolves.toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses the recoverable backup when the primary state is corrupt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-recovery-"));
    const recoveryPath = join(directory, "workspace-recovery.json");
    const record = createWorkspaceRecoveryRecord(recoveryInput(), undefined);

    try {
      await writeFile(recoveryPath, "not json", "utf8");
      await writeFile(
        `${recoveryPath}.backup`,
        `${JSON.stringify(record)}\n`,
        "utf8",
      );
      await expect(readWorkspaceRecoveryFile(recoveryPath)).resolves.toEqual(
        record,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the document but safely clears stale selection IDs", () => {
    expect(
      validateWorkspaceRecoveryInput({
        ...recoveryInput(),
        activePlateId: "missing-plate",
        selectedElementId: "missing-element",
      }),
    ).toMatchObject({
      activePlateId: "plate-1",
      selectedElementId: null,
    });
  });

  it("rejects invalid document and editor metadata before storage", () => {
    expect(() =>
      validateWorkspaceRecoveryInput({
        ...recoveryInput(),
        document: { schemaVersion: 100 },
      }),
    ).toThrow();
    expect(() =>
      validateWorkspaceRecoveryInput({ ...recoveryInput(), zoom: 1_000 }),
    ).toThrow("Recovery zoom must be between 60 and 300");
  });

  it("debounces updates and flushes only the latest editor state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-recovery-"));
    const recoveryPath = join(directory, "workspace-recovery.json");
    const store = new WorkspaceRecoveryStore(recoveryPath, () => undefined);
    const first = createWorkspaceRecoveryRecord(recoveryInput(), undefined);
    const latest = createWorkspaceRecoveryRecord(
      { ...recoveryInput(), zoom: 300 },
      undefined,
    );

    try {
      store.update(first);
      store.update(latest);
      await store.flush();
      await expect(readWorkspaceRecoveryFile(recoveryPath)).resolves.toEqual(
        latest,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
