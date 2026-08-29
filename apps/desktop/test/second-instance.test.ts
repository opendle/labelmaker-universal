import { describe, expect, it, vi } from "vitest";

import { handleSecondInstance } from "../src/main/second-instance.js";

describe("second desktop instance", () => {
  it("relaunches a development app after its fresh build", () => {
    const focusCurrentWindow = vi.fn();
    const quit = vi.fn();
    const relaunch = vi.fn();

    handleSecondInstance({
      development: true,
      focusCurrentWindow,
      quit,
      relaunch,
    });

    expect(relaunch).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
    expect(focusCurrentWindow).not.toHaveBeenCalled();
  });

  it("focuses the existing packaged app", () => {
    const focusCurrentWindow = vi.fn();
    const quit = vi.fn();
    const relaunch = vi.fn();

    handleSecondInstance({
      development: false,
      focusCurrentWindow,
      quit,
      relaunch,
    });

    expect(focusCurrentWindow).toHaveBeenCalledOnce();
    expect(relaunch).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });
});
