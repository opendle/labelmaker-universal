import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const CONFIRMATION = "I_CONFIRM_MAKEID_E1_HARDWARE_TEST";
if (process.env.LABELMAKER_ANDROID_HARDWARE_CONFIRM !== CONFIRMATION) {
  throw new Error(
    `Set LABELMAKER_ANDROID_HARDWARE_CONFIRM=${CONFIRMATION} only when the Samsung phone and MakeID E1 are ready.`,
  );
}

const repositoryRoot = resolve(import.meta.dirname, "..");
const devices = capture("adb", ["devices"])
  .split(/\r?\n/)
  .slice(1)
  .map((line) => line.trim().split(/\s+/, 2))
  .filter((parts) => parts.length === 2 && parts[1] === "device");
if (devices.length !== 1 || !devices[0]?.[0]) {
  throw new Error("Connect exactly one authorized Android hardware device.");
}

const serial = devices[0][0];
const properties = {
  recordedAt: new Date().toISOString(),
  serial: "not-recorded",
  manufacturer: property(serial, "ro.product.manufacturer"),
  model: property(serial, "ro.product.model"),
  androidVersion: property(serial, "ro.build.version.release"),
  apiLevel: property(serial, "ro.build.version.sdk"),
  securityPatch: property(serial, "ro.build.version.security_patch"),
  oneUiVersion: property(serial, "ro.build.version.oneui"),
  webViewVersion: packageVersion(serial, "com.google.android.webview"),
};
if (
  property(serial, "ro.kernel.qemu") === "1" ||
  properties.manufacturer.toLowerCase() !== "samsung"
) {
  throw new Error("Connect the Samsung hardware test phone, not an emulator.");
}

run("npm", ["run", "android:build"]);
run("adb", [
  "-s",
  serial,
  "install",
  "-r",
  resolve(
    repositoryRoot,
    "apps/android/app/build/outputs/apk/direct/debug/app-direct-debug.apk",
  ),
]);
for (const permission of [
  "android.permission.BLUETOOTH_SCAN",
  "android.permission.BLUETOOTH_CONNECT",
]) {
  run("adb", [
    "-s",
    serial,
    "shell",
    "pm",
    "grant",
    "com.opendle.labelmaker.debug",
    permission,
  ]);
}
run("npm", [
  "run",
  "android:connected-check",
  "--",
  "-Pandroid.testInstrumentationRunnerArguments.class=com.opendle.labelmaker.HardwareSmokeTest",
  "-Pandroid.testInstrumentationRunnerArguments.labelmakerHardwareConfirmed=true",
]);

const outputDirectory = resolve(repositoryRoot, "artifacts/android-hardware");
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  resolve(outputDirectory, "device-evidence.json"),
  `${JSON.stringify(properties, null, 2)}\n`,
  "utf8",
);
console.log(
  "The Samsung MakeID E1 discovery, add, and one-label print smoke test passed. Complete and record the remaining manual lifecycle and fault cases before release.",
);

function property(deviceSerial, name) {
  return capture("adb", ["-s", deviceSerial, "shell", "getprop", name]);
}

function packageVersion(deviceSerial, packageName) {
  const output = capture("adb", [
    "-s",
    deviceSerial,
    "shell",
    "dumpsys",
    "package",
    packageName,
  ]);
  return output.match(/^\s*versionName=(.+)$/m)?.[1]?.trim() ?? "unavailable";
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error)
    throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} stopped with status ${String(result.status)}.`);
  }
}

function capture(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} did not return the required device information.`,
    );
  }
  return result.stdout.trim();
}
