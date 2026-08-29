// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { afterEach, vi } from "vitest";

import {
  responsiveLayoutForViewport,
  useResponsiveLayout,
} from "./useResponsiveLayout.js";

class TestVisualViewport extends EventTarget {
  height: number;
  offsetTop = 0;

  constructor(height: number) {
    super();
    this.height = height;
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("responsiveLayoutForViewport", () => {
  it.each([
    [1_440, 960, "standard"],
    [1_100, 760, "standard"],
    [744, 1_024, "standard"],
    [601, 501, "standard"],
    [600, 852, "phone"],
    [393, 852, "phone"],
    [852, 393, "phone-short"],
    [1_000, 500, "phone-short"],
    [1_001, 500, "standard"],
  ] as const)("uses %s by %s as %s", (width, height, expected) => {
    expect(responsiveLayoutForViewport(width, height)).toBe(expected);
  });

  it("updates Phone mode across breakpoint and orientation changes", () => {
    vi.stubGlobal("innerWidth", 1_101);
    vi.stubGlobal("innerHeight", 1_024);
    const { result } = renderHook(() => useResponsiveLayout("linux"));
    expect(result.current.layout).toBe("standard");

    act(() => {
      vi.stubGlobal("innerWidth", 1_100);
      vi.stubGlobal("innerHeight", 852);
      globalThis.dispatchEvent(new Event("resize"));
    });
    expect(result.current.layout).toBe("phone");

    act(() => {
      vi.stubGlobal("innerWidth", 852);
      vi.stubGlobal("innerHeight", 393);
      globalThis.dispatchEvent(new Event("resize"));
    });
    expect(result.current.layout).toBe("phone-short");
  });

  it("uses the wider Phone breakpoint only for desktop hosts", () => {
    vi.stubGlobal("innerWidth", 900);
    vi.stubGlobal("innerHeight", 800);
    const desktop = renderHook(() => useResponsiveLayout("macos"));
    expect(desktop.result.current.layout).toBe("phone");
    desktop.unmount();

    const ipad = renderHook(() => useResponsiveLayout("ipados"));
    expect(ipad.result.current.layout).toBe("standard");
  });

  it("keeps the unobstructed iPad layout while the keyboard is open", () => {
    vi.stubGlobal("innerWidth", 744);
    vi.stubGlobal("innerHeight", 1_024);
    const viewport = new TestVisualViewport(1_024);
    vi.stubGlobal("visualViewport", viewport);
    const input = document.createElement("input");
    document.body.append(input);
    const { result } = renderHook(() => useResponsiveLayout("ipados"));

    act(() => input.focus());
    act(() => {
      viewport.height = 390;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({
      layout: "standard",
      softwareKeyboardOpen: true,
    });

    act(() => input.blur());
    expect(result.current.layout).toBe("standard");
    expect(result.current.softwareKeyboardOpen).toBe(true);

    act(() => {
      viewport.height = 1_024;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({
      layout: "standard",
      softwareKeyboardOpen: false,
    });
  });
});
