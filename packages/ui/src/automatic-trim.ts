import type { LabelDocument } from "@labelmaker/domain";

import { trimPlate } from "./editor-operations.js";

export async function trimLatestWorkspace(
  plateId: string,
  getWorkspace: () => LabelDocument,
  applyWorkspace: (workspace: LabelDocument) => void,
): Promise<void> {
  const trimSnapshot = async () => {
    const source = getWorkspace();
    return { source, workspace: await trimPlate(source, plateId) };
  };
  const first = await trimSnapshot();
  if (getWorkspace() === first.source) {
    applyWorkspace(first.workspace);
    return;
  }
  const second = await trimSnapshot();
  if (getWorkspace() === second.source) {
    applyWorkspace(second.workspace);
    return;
  }
  const third = await trimSnapshot();
  if (getWorkspace() === third.source) {
    applyWorkspace(third.workspace);
    return;
  }
  throw new Error("The label changed while trim was running.");
}
