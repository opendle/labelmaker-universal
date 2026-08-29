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
const iphone = process.argv.includes("--iphone");
const deviceName = iphone ? "iPhone" : "iPad";
const deviceVariable = iphone ? "IPHONE_ID" : "IPAD_ID";

if (process.argv.includes("--help")) {
  console.log(
    `Build, install, and start Labelmaker on the ${deviceName} in the ${deviceVariable} environment variable.`,
  );
  process.exit(0);
}

const deviceId = process.env[deviceVariable]?.trim();
if (!deviceId) {
  console.error(
    `Set ${deviceVariable} to the connected ${deviceName} identifier, then try again.`,
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
  `platform=iOS,id=${deviceId}`,
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
  deviceId,
  appPath,
]);

run("xcrun", [
  "devicectl",
  "device",
  "process",
  "launch",
  "--device",
  deviceId,
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
