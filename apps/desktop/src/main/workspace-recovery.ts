import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

import {
  LABELMAKER_FILE_EXTENSION,
  MAX_WORKSPACE_BYTES,
  validateLabelDocument,
} from "@labelmaker/documents";
import type { LabelDocument } from "@labelmaker/domain";

const RECOVERY_VERSION = 1;
const RECOVERY_DELAY_MS = 400;

export interface WorkspaceRecoveryRecord {
  readonly version: 1;
  readonly document: LabelDocument;
  readonly dirty: boolean;
  readonly activePlateId: string;
  readonly selectedElementId: string | null;
  readonly zoom: number;
  readonly savedAt: string | null;
  readonly filePath: string | null;
}

export type WorkspaceRecoveryInput = Omit<
  WorkspaceRecoveryRecord,
  "version" | "filePath"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSavedAt(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length <= 64 &&
      !Number.isNaN(Date.parse(value)))
  );
}

function validWorkspacePath(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length <= 4096 &&
      isAbsolute(value) &&
      value.toLowerCase().endsWith(LABELMAKER_FILE_EXTENSION))
  );
}

export function validateWorkspaceRecoveryInput(
  value: unknown,
): WorkspaceRecoveryInput {
  if (!isRecord(value)) throw new TypeError("Recovery state must be an object");
  const document = validateLabelDocument(value.document);
  if (typeof value.dirty !== "boolean")
    throw new TypeError("Recovery dirty state must be a boolean");
  if (typeof value.activePlateId !== "string")
    throw new TypeError("Recovery active label ID must be a string");
  if (
    value.selectedElementId !== null &&
    typeof value.selectedElementId !== "string"
  ) {
    throw new TypeError(
      "Recovery selected element ID must be a string or null",
    );
  }
  if (
    typeof value.zoom !== "number" ||
    !Number.isFinite(value.zoom) ||
    value.zoom < 60 ||
    value.zoom > 300
  ) {
    throw new RangeError("Recovery zoom must be between 60 and 300");
  }
  if (!validSavedAt(value.savedAt))
    throw new TypeError("Recovery save time is invalid");

  const activePlate =
    document.plates.find((plate) => plate.id === value.activePlateId) ??
    document.plates[0];
  const selectedElementId = activePlate?.elements.some(
    (element) => element.id === value.selectedElementId,
  )
    ? (value.selectedElementId as string)
    : null;

  return {
    document,
    dirty: value.dirty,
    activePlateId: activePlate?.id ?? "",
    selectedElementId,
    zoom: value.zoom,
    savedAt: value.savedAt,
  };
}

function validateWorkspaceRecoveryRecord(
  value: unknown,
): WorkspaceRecoveryRecord {
  if (!isRecord(value) || value.version !== RECOVERY_VERSION)
    throw new TypeError("Recovery state has an unsupported version");
  const input = validateWorkspaceRecoveryInput(value);
  const filePath = value.filePath;
  if (!validWorkspacePath(filePath)) {
    throw new TypeError("Recovery file path is invalid");
  }
  return { version: RECOVERY_VERSION, ...input, filePath };
}

export function createWorkspaceRecoveryRecord(
  value: unknown,
  filePath: string | undefined,
): WorkspaceRecoveryRecord {
  const input = validateWorkspaceRecoveryInput(value);
  return {
    version: RECOVERY_VERSION,
    ...input,
    filePath: validWorkspacePath(filePath) ? filePath : null,
  };
}

export async function readWorkspaceRecoveryFile(
  filePath: string,
): Promise<WorkspaceRecoveryRecord | null> {
  for (const candidate of [filePath, `${filePath}.backup`]) {
    try {
      const metadata = await stat(candidate);
      if (metadata.size > MAX_WORKSPACE_BYTES) continue;
      const contents = await readFile(candidate, "utf8");
      return validateWorkspaceRecoveryRecord(JSON.parse(contents));
    } catch {
      // Try the recoverable backup before the app uses its default workspace.
    }
  }
  return null;
}

export async function writeWorkspaceRecoveryFile(
  filePath: string,
  value: WorkspaceRecoveryRecord,
): Promise<void> {
  const record = validateWorkspaceRecoveryRecord(value);
  const contents = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_WORKSPACE_BYTES)
    throw new RangeError("Recovery state is too large");
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const backupPath = `${filePath}.backup`;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        process.platform !== "win32" ||
        (code !== "EEXIST" && code !== "EPERM")
      ) {
        throw error;
      }
      await rm(backupPath, { force: true });
      await rename(filePath, backupPath);
      try {
        await rename(temporaryPath, filePath);
      } catch (replacementError) {
        await rename(backupPath, filePath).catch(() => undefined);
        throw replacementError;
      }
      await rm(backupPath, { force: true }).catch(() => undefined);
    }
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export class WorkspaceRecoveryStore {
  private pending: WorkspaceRecoveryRecord | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | undefined;

  public constructor(
    private readonly filePath: string,
    private readonly onWriteError: (error: unknown) => void,
  ) {}

  public update(record: WorkspaceRecoveryRecord): void {
    this.pending = record;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch(this.onWriteError);
    }, RECOVERY_DELAY_MS);
  }

  public async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.flushing) {
      this.flushing = this.flushPending().finally(() => {
        this.flushing = undefined;
      });
    }
    await this.flushing;
  }

  private async flushPending(): Promise<void> {
    while (this.pending) {
      const record = this.pending;
      this.pending = undefined;
      try {
        await writeWorkspaceRecoveryFile(this.filePath, record);
      } catch (error) {
        if (!this.pending) this.pending = record;
        throw error;
      }
    }
  }
}
