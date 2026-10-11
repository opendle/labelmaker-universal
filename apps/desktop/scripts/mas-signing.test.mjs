import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import plist from "plist";
import { describe, expect, it } from "vitest";

import { masSigningOptions } from "./mas-signing.mjs";

const appPath = resolve("test/Label Maker.app");
const resourcesDirectory = resolve(import.meta.dirname, "../resources");
const options = (filePath, mode = "distribution") =>
  masSigningOptions(filePath, { appPath, resourcesDirectory, mode });
const entitlements = async (filePath, mode) =>
  plist.parse(await readFile(options(filePath, mode).entitlements, "utf8"));

describe("Mac App Store signing", () => {
  it("uses the release sandbox and Hardened Runtime in development", () => {
    const release = options(appPath);
    const development = options(appPath, "development");
    expect(development).toEqual({ ...release, timestamp: "none" });
    expect(release.hardenedRuntime).toBe(true);
  });

  it.each(["development", "distribution"])(
    "permits main-process JIT with no server permission in %s",
    async (mode) => {
      const rights = await entitlements(appPath, mode);
      expect(rights["com.apple.security.cs.allow-jit"]).toBe(true);
      expect(rights["com.apple.security.app-sandbox"]).toBe(true);
      expect(rights["com.apple.security.network.server"]).toBeUndefined();
      expect(
        rights["com.apple.security.cs.allow-unsigned-executable-memory"],
      ).toBeUndefined();
    },
  );

  it.each(["", " (Renderer)", " (GPU)", " (Plugin)"])(
    "permits JIT in the Electron helper %s and its executable",
    async (suffix) => {
      const helper = resolve(
        appPath,
        `Contents/Frameworks/Label Maker Helper${suffix}.app`,
      );
      for (const path of [
        helper,
        resolve(helper, `Contents/MacOS/Label Maker Helper${suffix}`),
      ]) {
        expect(await entitlements(path)).toEqual({
          "com.apple.security.app-sandbox": true,
          "com.apple.security.inherit": true,
          "com.apple.security.cs.allow-jit": true,
        });
        expect(options(path).hardenedRuntime).toBe(true);
      }
    },
  );

  it.each([
    "Contents/Resources/makeid-bluetooth-helper",
    "Contents/Library/LoginItems/Label Maker Login Helper.app",
    "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework",
  ])("keeps JIT permission out of native code: %s", async (relativePath) => {
    expect(await entitlements(resolve(appPath, relativePath))).toEqual({
      "com.apple.security.app-sandbox": true,
      "com.apple.security.inherit": true,
    });
  });
});
