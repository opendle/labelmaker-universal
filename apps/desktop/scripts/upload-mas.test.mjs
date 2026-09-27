import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  next: vi.fn(),
  read: vi.fn(),
  upload: vi.fn(),
  spawn: vi.fn(),
  mkdir: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  write: vi.fn(),
  access: vi.fn(),
}));
vi.mock("../../../scripts/app-store-build-number.mjs", () => ({
  nextMacAppStoreBuildNumber: mocks.next,
}));
vi.mock("../../../scripts/release-version.mjs", () => ({
  readReleaseVersion: mocks.read,
}));
vi.mock("../../../scripts/app-store-connect-key.mjs", () => ({
  readAppStoreConnectApiKey: vi.fn(),
  runAltoolWithAppStoreConnectApiKey: mocks.upload,
}));
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawn }));
vi.mock("node:fs", () => ({ accessSync: mocks.access }));
vi.mock("node:fs/promises", () => ({
  mkdir: mocks.mkdir,
  open: mocks.open,
  rename: mocks.rename,
  rm: mocks.rm,
  writeFile: mocks.write,
}));

const manifest = {
  schemaVersion: 1,
  productVersion: "1.0.0",
  buildNumbers: { android: 1, ios: 3, macos: 3, windows: 0, linux: 0 },
};

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("LABELMAKER_APP_STORE_CONNECT_KEY_ID", "EXAMPLE123");
  vi.stubEnv(
    "LABELMAKER_APP_STORE_CONNECT_ISSUER_ID",
    "00000000-0000-0000-0000-000000000000",
  );
  vi.spyOn(process, "argv", "get").mockReturnValue(["node", "upload-mas.mjs"]);
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.read.mockImplementation(async () => structuredClone(manifest));
  mocks.next.mockResolvedValue(4);
  mocks.open.mockResolvedValue({ close: mocks.close });
  mocks.spawn.mockReturnValue({ status: 0 });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const run = () => import("./upload-mas.mjs");

describe("Mac upload command", () => {
  it("saves the selected number before packaging and uploads the matching package", async () => {
    await run();
    expect(JSON.parse(mocks.write.mock.calls[0][1])).toEqual({
      ...manifest,
      buildNumbers: { ...manifest.buildNumbers, macos: 4 },
    });
    expect(mocks.rename.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.spawn.mock.invocationCallOrder[0],
    );
    expect(mocks.upload.mock.calls[0][0]).toEqual([
      "--validate-app",
      expect.stringContaining("Label Maker-1.0.0-4.pkg"),
      "--output-format",
      "json",
    ]);
    expect(mocks.upload.mock.calls[1][0]).toEqual([
      "--upload-app",
      "-f",
      expect.stringContaining("Label Maker-1.0.0-4.pkg"),
      "--show-progress",
    ]);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.rm).toHaveBeenCalledWith(
      expect.stringContaining(".upload.lock"),
      { force: true },
    );
  });

  it("stops before changing the manifest or building when the lookup fails", async () => {
    mocks.next.mockRejectedValue(new Error("HTTP 403"));
    await expect(run()).rejects.toThrow("HTTP 403");
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("stops a second local upload without removing its lock", async () => {
    mocks.open.mockRejectedValue(
      Object.assign(new Error(), { code: "EEXIST" }),
    );
    await expect(run()).rejects.toThrow("Mac upload lock exists");
    expect(mocks.next).not.toHaveBeenCalled();
    expect(mocks.rm).not.toHaveBeenCalled();
  });

  it("preserves a manifest changed during the remote lookup", async () => {
    mocks.read
      .mockResolvedValueOnce(structuredClone(manifest))
      .mockResolvedValueOnce({ ...manifest, productVersion: "1.0.1" });
    await expect(run()).rejects.toThrow("release version changed");
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("keeps the saved number and removes the lock if validation fails", async () => {
    mocks.upload.mockRejectedValueOnce(new Error("Validation failed"));
    await expect(run()).rejects.toThrow("Validation failed");
    expect(mocks.rename).toHaveBeenCalledOnce();
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
