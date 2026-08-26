import { describe, expect, it } from "vitest";

import { appReducer, initialAppState } from "./app-state.js";
import { sampleDocument } from "./sample.js";

describe("app session recovery", () => {
  it("restores editor state without creating undo history", () => {
    const workspace = sampleDocument;
    const activePlateId = workspace.plates[0]!.id;
    const selectedElementId = workspace.plates[0]!.elements[0]!.id;
    const state = appReducer(initialAppState, {
      type: "restore-session",
      workspace,
      activePlateId,
      selectedElementId,
      dirty: true,
      savedAt: "2026-08-26T12:00:00.000Z",
      fileName: "Recovered.lbl",
      zoom: 130,
    });

    expect(state).toMatchObject({
      workspace,
      activePlateId,
      selectedElementId,
      dirty: true,
      savedAt: "2026-08-26T12:00:00.000Z",
      workspaceFileName: "Recovered.lbl",
      zoom: 130,
      recoveryReady: true,
      past: [],
      future: [],
    });
  });
});
