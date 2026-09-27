import plist from "plist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  read: vi.fn(),
  upload: vi.fn(),
  spawn: vi.fn(),
  mkdir: vi.fn(),
  mkdtemp: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  write: vi.fn(),
  access: vi.fn(),
  readdir: vi.fn(),
}));
vi.mock("./reserve-upload-build.mjs", () => ({
  reserveIosUploadBuild: mocks.reserve,
}));
vi.mock("../../../scripts/release-version.mjs", () => ({
  readReleaseVersion: mocks.read,
}));
vi.mock("../../../scripts/app-store-connect-key.mjs", () => ({
  runAltoolWithAppStoreConnectApiKey: mocks.upload,
}));
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawn }));
vi.mock("node:fs", () => ({ accessSync: mocks.access }));
vi.mock("node:fs/promises", () => ({
  mkdir: mocks.mkdir,
  mkdtemp: mocks.mkdtemp,
  open: mocks.open,
  rename: mocks.rename,
  rm: mocks.rm,
  writeFile: mocks.write,
  readdir: mocks.readdir,
}));

let selectedBuild;
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  selectedBuild = "4";
  vi.stubEnv("LABELMAKER_APPLE_TEAM_ID", "EXAMPLE123");
  vi.stubEnv("LABELMAKER_APP_STORE_CONNECT_KEY_ID", "EXAMPLE123");
  vi.stubEnv(
    "LABELMAKER_APP_STORE_CONNECT_ISSUER_ID",
    "00000000-0000-0000-0000-000000000000",
  );
  vi.spyOn(process, "argv", "get").mockReturnValue([
    "node",
    "package-ios.mjs",
    "--upload",
  ]);
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.reserve.mockResolvedValue({
    productVersion: "1.0.0",
    buildNumbers: { ios: 4 },
  });
  mocks.read.mockResolvedValue({
    productVersion: "1.0.0",
    buildNumbers: { ios: 3 },
  });
  mocks.open.mockResolvedValue({ close: mocks.close });
  mocks.mkdtemp.mockResolvedValue("/temporary/ios-staging");
  mocks.readdir.mockImplementation(async (path) =>
    path.endsWith("Payload") ? ["Labelmaker.app"] : ["Labelmaker.ipa"],
  );
  mocks.spawn.mockImplementation((command, args) => {
    let stdout = "";
    if (command.endsWith("plutil")) {
      stdout = {
        CFBundleIdentifier: "com.opendle.labelmaker",
        CFBundleShortVersionString: "1.0.0",
        CFBundleVersion: selectedBuild,
        CFBundleExecutable: "Labelmaker",
      }[args[1]];
    } else if (command.endsWith("lipo")) {
      stdout = "arm64";
    } else if (command.endsWith("security")) {
      stdout = plist.build({
        Entitlements: {
          "application-identifier": "EXAMPLE123.com.opendle.labelmaker",
          "com.apple.developer.team-identifier": "EXAMPLE123",
        },
      });
    }
    return { status: 0, stdout };
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const run = () => import("./package-ios.mjs");

describe("iOS package command", () => {
  it("reserves a number before building and uses it for the archive and upload", async () => {
    await run();
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.spawn.mock.invocationCallOrder[0],
    );
    expect(mocks.spawn).toHaveBeenCalledWith(
      "/usr/bin/xcodebuild",
      expect.arrayContaining(["CURRENT_PROJECT_VERSION=4", "archive"]),
      expect.any(Object),
    );
    expect(mocks.rename).toHaveBeenCalledWith(
      expect.stringContaining("/1.0.0-4/export/Labelmaker.ipa"),
      expect.stringContaining("/1.0.0-4/Label Maker-1.0.0-4.ipa"),
    );
    expect(mocks.upload.mock.calls[0][0]).toEqual([
      "--validate-app",
      expect.stringContaining("Label Maker-1.0.0-4.ipa"),
      "--output-format",
      "json",
    ]);
    expect(mocks.upload.mock.calls[1][0][0]).toBe("--upload-app");
    expect(
      plist.parse(mocks.write.mock.calls[0][1]).manageAppVersionAndBuildNumber,
    ).toBe(false);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("uses the saved number for distribution without reserving or uploading", async () => {
    vi.spyOn(process, "argv", "get").mockReturnValue([
      "node",
      "package-ios.mjs",
      "--distribution",
    ]);
    selectedBuild = "3";
    await run();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledWith(
      "/usr/bin/xcodebuild",
      expect.arrayContaining(["CURRENT_PROJECT_VERSION=3", "archive"]),
      expect.any(Object),
    );
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("does not build if number selection fails and removes the lock", async () => {
    mocks.reserve.mockRejectedValue(new Error("HTTP 403"));
    await expect(run()).rejects.toThrow("HTTP 403");
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.rm).toHaveBeenCalledWith(
      expect.stringContaining(".package.lock"),
      { force: true },
    );
  });

  it("stops a second package command without removing its lock", async () => {
    mocks.open.mockRejectedValue(
      Object.assign(new Error(), { code: "EEXIST" }),
    );
    await expect(run()).rejects.toThrow("iOS package lock exists");
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.rm).not.toHaveBeenCalled();
  });

  it("removes the lock after an archive failure", async () => {
    mocks.spawn.mockReturnValue({ status: 1 });
    await expect(run()).rejects.toThrow("failed with status 1");
    expect(mocks.reserve).toHaveBeenCalledOnce();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("stops after failed Apple validation and removes the lock", async () => {
    mocks.upload.mockRejectedValueOnce(new Error("Apple validation failed"));
    await expect(run()).rejects.toThrow("Apple validation failed");
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
