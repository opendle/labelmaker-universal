import { describe, expect, it } from "vitest";

import { validateReleaseVersion } from "./release-version.mjs";

const validManifest = {
  schemaVersion: 1,
  productVersion: "1.0.0",
  buildNumbers: {
    android: 1,
    ios: 2,
    macos: 3,
    windows: 0,
    linux: 0,
  },
};

describe("release version manifest", () => {
  it("accepts one complete version manifest", () => {
    expect(validateReleaseVersion(validManifest)).toBe(validManifest);
  });

  it.each([
    [{ ...validManifest, schemaVersion: 2 }, "manifest"],
    [{ ...validManifest, productVersion: "1.0" }, "manifest"],
    [
      {
        ...validManifest,
        buildNumbers: { ...validManifest.buildNumbers, ios: undefined },
      },
      "iOS build number",
    ],
    [
      {
        ...validManifest,
        buildNumbers: { ...validManifest.buildNumbers, macos: 0 },
      },
      "macOS build number must be positive",
    ],
    [
      {
        ...validManifest,
        buildNumbers: {
          ...validManifest.buildNumbers,
          android: 2_100_000_001,
        },
      },
      "Android build number must not be more than 2100000000",
    ],
  ])("rejects invalid release data", (value, message) => {
    expect(() => validateReleaseVersion(value)).toThrow(message);
  });
});
