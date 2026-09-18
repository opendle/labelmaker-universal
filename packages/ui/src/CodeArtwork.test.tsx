// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { CodeElement } from "@labelmaker/domain";
import * as rendering from "@labelmaker/rendering";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CodeArtwork } from "./CodeArtwork.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("reuses artwork during frame changes and updates changed code content", () => {
  const encode = vi.spyOn(rendering, "generateCodeArtwork");
  const element: CodeElement = {
    id: "code",
    kind: "qr",
    value: "Shelf A",
    xMm: 0,
    yMm: 0,
    widthMm: 16,
    heightMm: 16,
    rotationDeg: 0,
  };
  const view = render(<CodeArtwork element={element} />);
  const source = view.container.querySelector("img")?.src;
  expect(encode).toHaveBeenCalledOnce();
  view.rerender(
    <CodeArtwork
      element={{ ...element, xMm: 5, widthMm: 20, rotationDeg: 45 }}
    />,
  );
  expect(encode).toHaveBeenCalledOnce();
  expect(view.container.querySelector("img")?.src).toBe(source);
  view.rerender(<CodeArtwork element={{ ...element, value: "Shelf B" }} />);
  expect(encode).toHaveBeenCalledTimes(2);
  expect(view.container.querySelector("img")?.src).not.toBe(source);
  const noMargin = view.container.querySelector("img")?.src;
  view.rerender(
    <CodeArtwork
      element={{ ...element, value: "Shelf B", includeMargin: true }}
    />,
  );
  expect(view.container.querySelector("img")?.src).not.toBe(noMargin);
  expect(encode).toHaveBeenCalledTimes(3);
  view.rerender(<CodeArtwork element={{ ...element, value: "" }} />);
  expect(screen.getByLabelText("Invalid code")).toBeInTheDocument();
});
