import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withReleaseVersionLock } from "../../../scripts/release-version-lock.mjs";
import { reserveIosUploadBuild } from "./reserve-upload-build.mjs";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, rename: vi.fn(actual.rename) };
});
const manifest = {
  schemaVersion: 1,
  productVersion: "1.0.0",
  buildNumbers: { android: 1, ios: 3, macos: 4, windows: 0, linux: 0 },
};
const project =
  "Debug: CURRENT_PROJECT_VERSION = 3;\nRelease: CURRENT_PROJECT_VERSION = 3;\nMARKETING_VERSION = 1.0;\n";
let directory;
let options;
let nextBuildNumber;
beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "labelmaker-ios-build-test-"));
  options = {
    versionPath: resolve(directory, "version.json"),
    projectFilePath: resolve(directory, "project.pbxproj"),
    bundleId: "com.example.labels",
    credentials: { keyId: "EXAMPLE123", issuerId: "example" },
  };
  await writeFile(options.versionPath, JSON.stringify(manifest));
  await writeFile(options.projectFilePath, project);
  nextBuildNumber = vi.fn().mockResolvedValue(4);
});
afterEach(async () => {
  vi.mocked(rename).mockClear();
  await rm(directory, { recursive: true, force: true });
});
const reserve = () => reserveIosUploadBuild(options, { nextBuildNumber });
const readVersion = async () =>
  JSON.parse(await readFile(options.versionPath, "utf8"));

describe("iOS upload version files", () => {
  it("saves the new number in both files and preserves the Mac number", async () => {
    const version = await reserve();
    expect(version.buildNumbers).toEqual({ ...manifest.buildNumbers, ios: 4 });
    expect(await readVersion()).toEqual(version);
    expect(await readFile(options.projectFilePath, "utf8")).toBe(
      project.replaceAll("VERSION = 3", "VERSION = 4"),
    );
    expect(nextBuildNumber).toHaveBeenCalledWith({
      ...options.credentials,
      bundleId: options.bundleId,
      platform: "IOS",
      currentBuildNumber: 3,
    });
    nextBuildNumber.mockResolvedValue(5);
    expect((await reserve()).buildNumbers.ios).toBe(5);
  });

  it("prevents a Mac reservation from replacing an active iOS reservation", async () => {
    const entered = Promise.withResolvers();
    const resume = Promise.withResolvers();
    nextBuildNumber.mockImplementationOnce(async () => {
      entered.resolve();
      await resume.promise;
      return 4;
    });
    const iosReservation = reserve();
    await entered.promise;
    const reserveMac = vi.fn(async () => {
      const version = await readVersion();
      version.buildNumbers.macos = 5;
      await writeFile(options.versionPath, JSON.stringify(version));
    });
    try {
      await expect(
        withReleaseVersionLock(options.versionPath, reserveMac),
      ).rejects.toThrow("release version lock exists");
      expect(reserveMac).not.toHaveBeenCalled();
    } finally {
      resume.resolve();
      await iosReservation;
    }
    await withReleaseVersionLock(options.versionPath, reserveMac);
    expect((await readVersion()).buildNumbers).toEqual({
      ...manifest.buildNumbers,
      ios: 4,
      macos: 5,
    });
  });

  it("does not change either file after a failed API check", async () => {
    nextBuildNumber.mockRejectedValue(new Error("HTTP 403"));
    await expect(reserve()).rejects.toThrow("HTTP 403");
    expect(await readVersion()).toEqual(manifest);
    expect(await readFile(options.projectFilePath, "utf8")).toBe(project);
  });

  it("preserves edits made during the API check", async () => {
    nextBuildNumber.mockImplementation(async () => {
      await writeFile(
        options.versionPath,
        JSON.stringify({
          ...manifest,
          buildNumbers: { ...manifest.buildNumbers, macos: 5 },
        }),
      );
      return 4;
    });
    await expect(reserve()).rejects.toThrow("changed during the build check");
    expect((await readVersion()).buildNumbers).toEqual({
      ...manifest.buildNumbers,
      macos: 5,
    });
    expect(await readFile(options.projectFilePath, "utf8")).toBe(project);
  });

  it("preserves Xcode edits made during the API check", async () => {
    nextBuildNumber.mockImplementation(async () => {
      await writeFile(options.projectFilePath, `${project}new setting`);
      return 4;
    });
    await expect(reserve()).rejects.toThrow("changed during the build check");
    expect(await readVersion()).toEqual(manifest);
    expect(await readFile(options.projectFilePath, "utf8")).toBe(
      `${project}new setting`,
    );
  });

  it("restores the manifest if the Xcode file cannot be replaced", async () => {
    const actual = await vi.importActual("node:fs/promises");
    vi.mocked(rename)
      .mockImplementationOnce(actual.rename)
      .mockRejectedValueOnce(new Error("Cannot replace project"));
    await expect(reserve()).rejects.toThrow("Cannot replace project");
    expect(await readVersion()).toEqual(manifest);
    expect(await readFile(options.projectFilePath, "utf8")).toBe(project);
  });

  it("stops before the API call if Xcode build settings are missing", async () => {
    await writeFile(options.projectFilePath, "invalid project");
    await expect(reserve()).rejects.toThrow("build settings are invalid");
    expect(nextBuildNumber).not.toHaveBeenCalled();
    expect(await readVersion()).toEqual(manifest);
  });

  it("rejects a selected number that is not higher", async () => {
    nextBuildNumber.mockResolvedValue(3);
    await expect(reserve()).rejects.toThrow(
      "selected iOS build number is invalid",
    );
    expect(await readVersion()).toEqual(manifest);
  });
});
