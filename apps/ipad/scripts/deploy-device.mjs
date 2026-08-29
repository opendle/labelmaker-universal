import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const projectPath = resolve(repositoryRoot, "apps/ipad/Labelmaker.xcodeproj");
const buildDirectory = resolve(tmpdir(), "labelmaker-ipad-derived-data");
const appPath = resolve(
  buildDirectory,
  "Build/Products/Debug-iphoneos/LabelMaker for MakeID.app",
);

if (process.argv.includes("--help")) {
  console.log(
    "Build, install, and start Labelmaker on the iPad in the IPAD_ID environment variable.",
  );
  process.exit(0);
}

const ipadId = process.env.IPAD_ID?.trim();
if (!ipadId) {
  console.error(
    "Set IPAD_ID to the connected iPad identifier, then try again.",
  );
  process.exit(1);
}

run("xcodebuild", [
  "-project",
  projectPath,
  "-scheme",
  "Labelmaker",
  "-configuration",
  "Debug",
  "-destination",
  `platform=iOS,id=${ipadId}`,
  "-derivedDataPath",
  buildDirectory,
  "-allowProvisioningUpdates",
  "build",
]);

run("xcrun", [
  "devicectl",
  "device",
  "install",
  "app",
  "--device",
  ipadId,
  appPath,
]);

run("xcrun", [
  "devicectl",
  "device",
  "process",
  "launch",
  "--device",
  ipadId,
  "--terminate-existing",
  "com.opendle.labelmaker",
]);

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
