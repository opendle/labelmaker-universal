import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const projectPath = resolve(repositoryRoot, "apps/ipad/Labelmaker.xcodeproj");
const buildDirectory = resolve(
  tmpdir(),
  "labelmaker-ios-simulator-derived-data",
);
const appPath = resolve(
  buildDirectory,
  "Build/Products/Debug-iphonesimulator/LabelMaker for MakeID.app",
);
const iphone = process.argv.includes("--iphone");
const deviceName = iphone ? "iPhone" : "iPad";
const simulatorVariable = iphone ? "IPHONE_SIMULATOR" : "IPAD_SIMULATOR";
const defaultSimulator = iphone ? "iPhone 17 Pro" : "iPad Pro 13-inch (M5)";

if (process.argv.includes("--help")) {
  console.log(
    `Build, install, and start Labelmaker in the ${deviceName} simulator selected by ${simulatorVariable}. The default is ${defaultSimulator}.`,
  );
  process.exit(0);
}

const requestedSimulator =
  process.env[simulatorVariable]?.trim() || defaultSimulator;
const simulators = listAvailableSimulators();
const simulator = simulators.find(
  (candidate) =>
    candidate.udid === requestedSimulator ||
    candidate.name === requestedSimulator,
);

if (!simulator) {
  const available = simulators
    .filter((candidate) =>
      iphone
        ? candidate.deviceTypeIdentifier.includes(".iPhone-")
        : candidate.deviceTypeIdentifier.includes(".iPad-"),
    )
    .map((candidate) => candidate.name)
    .join(", ");
  console.error(
    `${requestedSimulator} is not an available ${deviceName} simulator. Available simulators: ${available || "none"}.`,
  );
  process.exit(1);
}

if (simulator.state !== "Booted") {
  run("xcrun", ["simctl", "boot", simulator.udid]);
}
run("open", [
  "-a",
  "Simulator",
  "--args",
  "-CurrentDeviceUDID",
  simulator.udid,
]);
run("xcrun", ["simctl", "bootstatus", simulator.udid, "-b"]);

run("xcodebuild", [
  "-project",
  projectPath,
  "-scheme",
  "Labelmaker",
  "-configuration",
  "Debug",
  "-destination",
  `platform=iOS Simulator,id=${simulator.udid}`,
  "-derivedDataPath",
  buildDirectory,
  "build",
]);

run("xcrun", ["simctl", "install", simulator.udid, appPath]);
run("xcrun", [
  "simctl",
  "launch",
  "--terminate-running-process",
  simulator.udid,
  "com.opendle.labelmaker",
]);

function listAvailableSimulators() {
  const result = spawnSync(
    "xcrun",
    ["simctl", "list", "devices", "available", "-j"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: process.env,
    },
  );
  if (result.error) {
    console.error(`xcrun could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  const output = JSON.parse(result.stdout);
  return Object.values(output.devices).flat();
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`${command} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
