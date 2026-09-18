import type { LabelDocument } from "@labelmaker/domain";
import { describe, expect, it, vi } from "vitest";
import { trimLatestWorkspace } from "./automatic-trim.js";
import { trimPlate } from "./editor-operations.js";

vi.mock("./editor-operations.js", () => ({ trimPlate: vi.fn() }));
const trim = vi.mocked(trimPlate);
const workspace: LabelDocument = {
  schemaVersion: 1,
  id: "workspace",
  name: "Labels",
  defaultPlateSize: { widthMm: 40, heightMm: 16 },
  plates: [
    {
      id: "plate",
      name: "Label",
      widthMode: "fixed",
      size: { widthMm: 40, heightMm: 16 },
      margins: { leftMm: 0, rightMm: 0 },
      elements: [],
    },
  ],
};

describe("automatic width", () => {
  it("does not measure or move a fixed plate", async () => {
    trim.mockClear();
    const apply = vi.fn();
    await trimLatestWorkspace("plate", () => workspace, apply);
    expect(trim).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledWith(workspace);
  });
  it("discards an in-flight trim if the plate becomes fixed", async () => {
    const auto: LabelDocument = {
      ...workspace,
      plates: workspace.plates.map((plate) => ({
        ...plate,
        widthMode: "auto",
      })),
    };
    let current = auto;
    trim.mockImplementationOnce(async () => {
      current = workspace;
      return auto;
    });
    const apply = vi.fn();
    await trimLatestWorkspace("plate", () => current, apply);
    expect(apply).toHaveBeenCalledExactlyOnceWith(workspace);
  });
  it("measures the plate when automatic width is restored", async () => {
    trim.mockClear();
    const auto: LabelDocument = {
      ...workspace,
      plates: workspace.plates.map((plate) => ({
        ...plate,
        widthMode: "auto",
      })),
    };
    trim.mockResolvedValueOnce(auto);
    await trimLatestWorkspace("plate", () => auto, vi.fn());
    expect(trim).toHaveBeenCalledExactlyOnceWith(auto, "plate");
  });
});
