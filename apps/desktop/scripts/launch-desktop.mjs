import { spawn, spawnSync } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import electronExecutable from "electron";

const APPLICATION_NAME = "Labelmaker";
const BUNDLE_IDENTIFIER = "io.labelmaker.universal.dev";
const BUNDLE_ICON_NAME = "labelmaker.icns";
const DEVELOPMENT_ENVIRONMENT_KEY = "LABELMAKER_DEVELOPMENT";
const BLUETOOTH_USAGE_DESCRIPTION =
  "Labelmaker uses Bluetooth to find and print labels on nearby printers.";
const RUNTIME_LAYOUT_VERSION = 4;
const applicationDirectory = resolve(import.meta.dirname, "..");
const runtimeRoot = join(applicationDirectory, ".runtime");

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(
      `${command} failed${detail ? `: ${detail}` : ` with status ${String(result.status)}`}`,
    );
  }
}

function replacePlistString(plistPath, key, value) {
  run("/usr/bin/plutil", ["-replace", key, "-string", value, plistPath]);
}

async function installedElectronVersion() {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("electron/package.json");
  const value = JSON.parse(await readFile(packagePath, "utf8"));
  if (typeof value.version !== "string") {
    throw new Error("The installed Electron version is invalid");
  }
  return value.version;
}

function bundleExecutables(bundle) {
  const frameworks = join(bundle, "Contents", "Frameworks");
  return [
    join(bundle, "Contents", "MacOS", APPLICATION_NAME),
    join(
      frameworks,
      `${APPLICATION_NAME} Helper.app`,
      "Contents",
      "MacOS",
      `${APPLICATION_NAME} Helper`,
    ),
    ...["GPU", "Plugin", "Renderer"].map((suffix) =>
      join(
        frameworks,
        `${APPLICATION_NAME} Helper (${suffix}).app`,
        "Contents",
        "MacOS",
        `${APPLICATION_NAME} Helper (${suffix})`,
      ),
    ),
  ];
}

async function installBundleIcon(bundle) {
  const resources = join(bundle, "Contents", "Resources");
  const previewDirectory = join(resources, ".labelmaker-icon-preview");
  const iconsetDirectory = join(resources, ".labelmaker.iconset");
  const sourceIcon = join(
    applicationDirectory,
    "src",
    "renderer",
    "public",
    "app-icon.svg",
  );
  const previewIcon = join(previewDirectory, "app-icon.svg.png");
  await mkdir(previewDirectory, { recursive: true });
  await mkdir(iconsetDirectory, { recursive: true });
  try {
    run("/usr/bin/qlmanage", [
      "-t",
      "-s",
      "1024",
      "-o",
      previewDirectory,
      sourceIcon,
    ]);
    const iconSizes = [
      [16, "icon_16x16.png"],
      [32, "icon_16x16@2x.png"],
      [32, "icon_32x32.png"],
      [64, "icon_32x32@2x.png"],
      [128, "icon_128x128.png"],
      [256, "icon_128x128@2x.png"],
      [256, "icon_256x256.png"],
      [512, "icon_256x256@2x.png"],
      [512, "icon_512x512.png"],
      [1024, "icon_512x512@2x.png"],
    ];
    for (const [size, fileName] of iconSizes) {
      run("/usr/bin/sips", [
        "-z",
        String(size),
        String(size),
        previewIcon,
        "--out",
        join(iconsetDirectory, String(fileName)),
      ]);
    }
    run("/usr/bin/iconutil", [
      "-c",
      "icns",
      "-o",
      join(resources, BUNDLE_ICON_NAME),
      iconsetDirectory,
    ]);
  } finally {
    await rm(previewDirectory, { recursive: true, force: true });
    await rm(iconsetDirectory, { recursive: true, force: true });
  }
}

async function hasCurrentRuntime(runtimeMarker, runtimeBundle, expectedMarker) {
  try {
    const marker = JSON.parse(await readFile(runtimeMarker, "utf8"));
    if (JSON.stringify(marker) !== JSON.stringify(expectedMarker)) return false;
    await Promise.all(
      [
        ...bundleExecutables(runtimeBundle),
        join(runtimeBundle, "Contents", "Resources", BUNDLE_ICON_NAME),
      ].map((file) => access(file)),
    );
    const bluetoothUsage = spawnSync(
      "/usr/bin/plutil",
      [
        "-extract",
        "NSBluetoothAlwaysUsageDescription",
        "raw",
        join(runtimeBundle, "Contents", "Info.plist"),
      ],
      { encoding: "utf8" },
    );
    if (
      bluetoothUsage.status !== 0 ||
      bluetoothUsage.stdout.trim() !== BLUETOOTH_USAGE_DESCRIPTION
    ) {
      return false;
    }
    const verification = spawnSync(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", runtimeBundle],
      { encoding: "utf8" },
    );
    return verification.status === 0;
  } catch {
    return false;
  }
}

async function renameHelper(tempBundle, suffix, identifierSuffix) {
  const frameworks = join(tempBundle, "Contents", "Frameworks");
  const oldName = `Electron Helper${suffix}`;
  const newName = `${APPLICATION_NAME} Helper${suffix}`;
  const oldBundle = join(frameworks, `${oldName}.app`);
  const newBundle = join(frameworks, `${newName}.app`);
  const oldExecutable = join(oldBundle, "Contents", "MacOS", oldName);
  const newExecutable = join(oldBundle, "Contents", "MacOS", newName);
  const plist = join(oldBundle, "Contents", "Info.plist");

  await rename(oldExecutable, newExecutable);
  replacePlistString(plist, "CFBundleName", newName);
  replacePlistString(
    plist,
    "CFBundleIdentifier",
    `${BUNDLE_IDENTIFIER}.helper${identifierSuffix}`,
  );
  await rename(oldBundle, newBundle);
}

async function prepareMacOsRuntime() {
  const electronVersion = await installedElectronVersion();
  const expectedMarker = {
    applicationName: APPLICATION_NAME,
    bluetoothUsageDescription: BLUETOOTH_USAGE_DESCRIPTION,
    bundleIdentifier: BUNDLE_IDENTIFIER,
    electronVersion,
    layoutVersion: RUNTIME_LAYOUT_VERSION,
  };
  const runtimeDirectory = join(
    runtimeRoot,
    `electron-${electronVersion}-layout-${String(RUNTIME_LAYOUT_VERSION)}`,
  );
  const runtimeBundle = join(runtimeDirectory, `${APPLICATION_NAME}.app`);
  const runtimeMarker = join(runtimeDirectory, "identity.json");
  if (await hasCurrentRuntime(runtimeMarker, runtimeBundle, expectedMarker)) {
    return runtimeBundle;
  }

  const sourceBundle = resolve(dirname(electronExecutable), "../..");
  const tempBundle = join(
    runtimeDirectory,
    `.${APPLICATION_NAME}.${String(process.pid)}.app`,
  );
  await rm(runtimeDirectory, { recursive: true, force: true });
  await mkdir(runtimeDirectory, { recursive: true });
  try {
    await cp(sourceBundle, tempBundle, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });

    const oldExecutable = join(tempBundle, "Contents", "MacOS", "Electron");
    const newExecutable = join(
      tempBundle,
      "Contents",
      "MacOS",
      APPLICATION_NAME,
    );
    const plist = join(tempBundle, "Contents", "Info.plist");
    await rename(oldExecutable, newExecutable);
    replacePlistString(plist, "CFBundleDisplayName", APPLICATION_NAME);
    replacePlistString(plist, "CFBundleExecutable", APPLICATION_NAME);
    replacePlistString(plist, "CFBundleName", APPLICATION_NAME);
    replacePlistString(plist, "CFBundleIdentifier", BUNDLE_IDENTIFIER);
    replacePlistString(plist, "CFBundleIconFile", BUNDLE_ICON_NAME);
    replacePlistString(
      plist,
      "NSBluetoothAlwaysUsageDescription",
      BLUETOOTH_USAGE_DESCRIPTION,
    );
    replacePlistString(
      plist,
      "LSApplicationCategoryType",
      "public.app-category.utilities",
    );

    await renameHelper(tempBundle, "", "");
    await renameHelper(tempBundle, " (GPU)", ".GPU");
    await renameHelper(tempBundle, " (Plugin)", ".Plugin");
    await renameHelper(tempBundle, " (Renderer)", ".Renderer");
    await installBundleIcon(tempBundle);

    run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", tempBundle]);
    await rename(tempBundle, runtimeBundle);
    await writeFile(
      runtimeMarker,
      `${JSON.stringify(expectedMarker, null, 2)}\n`,
      "utf8",
    );
    return runtimeBundle;
  } catch (error) {
    await rm(tempBundle, { recursive: true, force: true });
    throw error;
  }
}

function stopRunningMacOsDevelopmentApp() {
  const bundleIdentifier = JSON.stringify(BUNDLE_IDENTIFIER);
  const script = `
ObjC.import("AppKit");
const bundleIdentifier = ${bundleIdentifier};
const runningApplications =
  $.NSRunningApplication.runningApplicationsWithBundleIdentifier(bundleIdentifier);
for (let index = 0; index < runningApplications.count; index += 1) {
  runningApplications.objectAtIndex(index).terminate;
}
const deadline = Date.now() + 5000;
while (
  $.NSRunningApplication.runningApplicationsWithBundleIdentifier(bundleIdentifier)
    .count > 0 &&
  Date.now() < deadline
) {
  delay(0.05);
}
if (
  $.NSRunningApplication.runningApplicationsWithBundleIdentifier(bundleIdentifier)
    .count > 0
) {
  throw new Error("The earlier Labelmaker development app did not close");
}
`;
  const result = spawnSync(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", script],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(
      `Could not close the earlier Labelmaker development app${detail ? `: ${detail}` : ""}`,
    );
  }
}

const prepareOnly = process.argv.includes("--prepare-only");
const applicationArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--prepare-only");
const executable =
  process.platform === "darwin"
    ? join(await prepareMacOsRuntime(), "Contents", "MacOS", APPLICATION_NAME)
    : electronExecutable;

if (prepareOnly) {
  process.stdout.write(`${executable}\n`);
} else {
  if (process.platform === "darwin") stopRunningMacOsDevelopmentApp();
  const child = spawn(
    executable,
    [applicationDirectory, ...applicationArguments],
    {
      env: {
        ...process.env,
        [DEVELOPMENT_ENVIRONMENT_KEY]: "1",
      },
      stdio: "inherit",
    },
  );
  child.once("error", (error) => {
    process.stderr.write(
      `Could not start ${APPLICATION_NAME}: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      process.stderr.write(
        `${APPLICATION_NAME} stopped with signal ${signal}\n`,
      );
      process.exitCode = 1;
    } else {
      process.exitCode = code ?? 1;
    }
  });
}
