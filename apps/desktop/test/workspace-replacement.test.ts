import { describe, expect, it, vi } from "vitest";

import {
  replacementChoiceFromResponse,
  resolveWorkspaceReplacement,
} from "../src/main/workspace-replacement.js";

describe("workspace replacement guard", () => {
  it("maps the native Save, Discard, and Cancel buttons", () => {
    expect(replacementChoiceFromResponse(0)).toBe("save");
    expect(replacementChoiceFromResponse(1)).toBe("discard");
    expect(replacementChoiceFromResponse(2)).toBe("cancel");
  });

  it("saves the current document before replacement", async () => {
    const document = { name: "Edited workspace" };
    const save = vi.fn().mockResolvedValue({ status: "saved" as const });

    await expect(
      resolveWorkspaceReplacement(true, document, async () => "save", save),
    ).resolves.toEqual({ status: "proceed" });
    expect(save).toHaveBeenCalledWith(document);
  });

  it("does not replace the workspace when Save is canceled", async () => {
    await expect(
      resolveWorkspaceReplacement(
        true,
        {},
        async () => "save",
        async () => ({ status: "canceled" }),
      ),
    ).resolves.toEqual({ status: "canceled" });
  });

  it("does not prompt or save a clean workspace", async () => {
    const choose = vi.fn();
    const save = vi.fn();

    await expect(
      resolveWorkspaceReplacement(false, {}, choose, save),
    ).resolves.toEqual({ status: "proceed" });
    expect(choose).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
