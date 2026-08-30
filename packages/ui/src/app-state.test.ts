import { describe, expect, it } from "vitest";

import { appReducer, initialAppState, movePlate } from "./app-state.js";
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

describe("saved state", () => {
  it("keeps a newer workspace edit dirty after an older save completes", () => {
    const savedWorkspace = { ...sampleDocument, name: "Saved version" };
    const newerWorkspace = { ...sampleDocument, name: "Newer edit" };
    const state = appReducer(
      { ...initialAppState, workspace: newerWorkspace, dirty: true },
      {
        type: "mark-saved",
        fileName: "labels.lbl",
        savedAt: "2026-08-30T00:00:00.000Z",
        workspace: savedWorkspace,
      },
    );

    expect(state.dirty).toBe(true);
    expect(state.workspace).toBe(newerWorkspace);
    expect(state.workspaceFileName).toBe("labels.lbl");
  });
});

describe("plate order", () => {
  it("moves one plate to a bounded target position", () => {
    const moved = movePlate(sampleDocument, "plate-resistors", 2);

    expect(moved.plates.map((plate) => plate.id)).toEqual([
      "plate-capacitors",
      "plate-connectors",
      "plate-resistors",
    ]);
    expect(movePlate(moved, "plate-resistors", 99).plates).toBe(moved.plates);
    expect(movePlate(moved, "missing", 0)).toBe(moved);
  });
});
