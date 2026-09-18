import { describe, expect, it } from "vitest";

import {
  assertApplicationSender,
  isApplicationUrl,
} from "../src/main/renderer-security.js";

const applicationUrl = "file:///Applications/Labelmaker/renderer/index.html";

describe("desktop renderer security", () => {
  it("accepts the local application page and its fragments", () => {
    expect(isApplicationUrl(applicationUrl, applicationUrl)).toBe(true);
    expect(isApplicationUrl(`${applicationUrl}#editor`, applicationUrl)).toBe(
      true,
    );
  });

  it.each([
    "https://example.com/renderer/index.html",
    "file:///tmp/index.html",
    `${applicationUrl}?source=other`,
    `${applicationUrl}/other.html`,
    "about:blank",
    "invalid URL",
  ])("rejects navigation to %s", (url) => {
    expect(isApplicationUrl(url, applicationUrl)).toBe(false);
  });

  it("accepts an IPC request from the registered application main frame", () => {
    const mainFrame = { url: applicationUrl };
    expect(() =>
      assertApplicationSender(
        { sender: { id: 1, mainFrame }, senderFrame: mainFrame },
        new Set([1]),
        applicationUrl,
      ),
    ).not.toThrow();
  });

  it("rejects other windows, child frames, and destroyed frames", () => {
    const mainFrame = { url: applicationUrl };
    for (const event of [
      { sender: { id: 2, mainFrame }, senderFrame: mainFrame },
      { sender: { id: 1, mainFrame }, senderFrame: { url: applicationUrl } },
      { sender: { id: 1, mainFrame }, senderFrame: null },
    ]) {
      expect(() =>
        assertApplicationSender(event, new Set([1]), applicationUrl),
      ).toThrow("The request did not come from the application window");
    }
  });

  it("rejects a registered main frame after navigation to another page", () => {
    const mainFrame = { url: "https://example.com" };
    expect(() =>
      assertApplicationSender(
        { sender: { id: 1, mainFrame }, senderFrame: mainFrame },
        new Set([1]),
        applicationUrl,
      ),
    ).toThrow("The request did not come from the application window");
  });
});
