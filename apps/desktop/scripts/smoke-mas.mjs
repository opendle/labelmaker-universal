import { _electron as electron } from "playwright";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { readReleaseVersion } from "../../../scripts/release-version.mjs";

const appPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(
      import.meta.dirname,
      "../../../release/macos-app-store/development/Label Maker-mas-universal/Label Maker.app",
    );
const infoPath = resolve(appPath, "Contents/Info.plist");
const releaseVersion = await readReleaseVersion();
const expectedVersion = releaseVersion.productVersion;
const bundleIdentifier = readPlistValue(infoPath, "CFBundleIdentifier");
const executableName = readPlistValue(infoPath, "CFBundleExecutable");
if (!/^[A-Za-z0-9.-]+$/.test(bundleIdentifier)) {
  throw new Error("The packaged app bundle identifier is invalid.");
}
const executablePath = resolve(appPath, "Contents/MacOS", executableName);
await access(executablePath);

const containerTempDirectory = resolve(
  homedir(),
  "Library/Containers",
  bundleIdentifier,
  "Data/tmp",
);
await mkdir(containerTempDirectory, { recursive: true });
const profileDirectory = await mkdtemp(
  join(containerTempDirectory, "label-maker-mas-smoke-"),
);
const inheritedEnvironment = Object.fromEntries(
  ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR"].flatMap((name) => {
    const value = process.env[name];
    return value === undefined ? [] : [[name, value]];
  }),
);
let application;
try {
  application = await electron.launch({
    args: [`--user-data-dir=${profileDirectory}`],
    env: {
      ...inheritedEnvironment,
      LABELMAKER_DISABLE_HARDWARE_PRINTERS: "1",
      LABELMAKER_DISABLE_LEGACY_PRINTER_CONFIGURATION: "1",
      LABELMAKER_ENABLE_MOCK_PRINTER: "1",
    },
    executablePath,
  });
  const page = await application.firstWindow();
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  await page.locator(".label-canvas").waitFor();
  await page
    .getByRole("button", { name: "Selected printer: Studio Labeler" })
    .waitFor();

  const runtime = await application.evaluate(({ app }) => ({
    isMas: process.mas === true,
    isPackaged: app.isPackaged,
    name: app.getName(),
    userData: app.getPath("userData"),
    version: app.getVersion(),
  }));
  if (
    !runtime.isMas ||
    !runtime.isPackaged ||
    runtime.name !== "Labelmaker" ||
    runtime.version !== expectedVersion
  ) {
    throw new Error(
      `The packaged runtime is invalid: ${JSON.stringify(runtime)}.`,
    );
  }
  const renderer = await page.evaluate(() => ({
    hasHost: typeof window.labelmakerHost === "object",
    hasNodeProcess: "process" in window,
  }));
  if (!renderer.hasHost || renderer.hasNodeProcess) {
    throw new Error(
      `The packaged renderer boundary is invalid: ${JSON.stringify(renderer)}.`,
    );
  }

  await page.getByRole("button", { name: "Add label" }).click();
  await page.getByRole("button", { name: "Select label 4: Label 4" }).waitFor();
  await page.waitForTimeout(900);
  await access(resolve(runtime.userData, "workspace-recovery.json"));
  if (failures.length > 0) {
    throw new Error(
      `The packaged app reported an error: ${failures.join("; ")}`,
    );
  }
  console.log(`Mac App Store smoke test passed for ${appPath}`);
} finally {
  await application?.close().catch(() => undefined);
  await rm(profileDirectory, { recursive: true, force: true });
}

function readPlistValue(path, key) {
  const result = spawnSync("/usr/bin/plutil", ["-extract", key, "raw", path], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `Could not read ${key} from ${path}: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.trim();
}
