import { spawnSync } from "node:child_process";
import { accessSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  readAppStoreConnectApiKey,
  runAltoolWithAppStoreConnectApiKey,
} from "../../../scripts/app-store-connect-key.mjs";

const arguments_ = process.argv.slice(2);

if (arguments_.length === 1 && arguments_[0] === "--check-keychain") {
  const keyId = requiredEnvironmentValue("LABELMAKER_APP_STORE_CONNECT_KEY_ID");
  const key = readAppStoreConnectApiKey(keyId);
  key.fill(0);
  console.log(`App Store Connect API key ${keyId} is available in Keychain.`);
  process.exit(0);
}
if (arguments_.length !== 0) {
  throw new Error("The upload command arguments are invalid.");
}

const releaseVersion = JSON.parse(
  readFileSync(
    new URL("../../../distribution/version.json", import.meta.url),
    "utf8",
  ),
);
const APP_VERSION = releaseVersion.productVersion;
const BUILD_VERSION = String(releaseVersion.buildNumbers?.macos);
const API_KEY_ID = requiredEnvironmentValue(
  "LABELMAKER_APP_STORE_CONNECT_KEY_ID",
);
const API_ISSUER_ID = requiredEnvironmentValue(
  "LABELMAKER_APP_STORE_CONNECT_ISSUER_ID",
);

if (!/^\d+(?:\.\d+){0,2}$/.test(APP_VERSION)) {
  throw new Error(
    "The product version in distribution/version.json is invalid.",
  );
}
if (!/^\d+(?:\.\d+){0,2}$/.test(BUILD_VERSION)) {
  throw new Error(
    "The macOS build number in distribution/version.json is invalid.",
  );
}
if (!/^[A-Za-z0-9]+$/.test(API_KEY_ID)) {
  throw new Error("LABELMAKER_APP_STORE_CONNECT_KEY_ID is invalid.");
}
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    API_ISSUER_ID,
  )
) {
  throw new Error("LABELMAKER_APP_STORE_CONNECT_ISSUER_ID is invalid.");
}

const appDirectory = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(appDirectory, "../..");
const packagePath = resolve(
  repositoryRoot,
  "release/macos-app-store/distribution",
  `Label Maker-${APP_VERSION}-${BUILD_VERSION}.pkg`,
);

console.log("Building and signing a new Label Maker Mac App Store package.");
run(process.execPath, [
  resolve(appDirectory, "scripts/package-mas.mjs"),
  "--distribution",
]);
accessSync(packagePath);

console.log(`Validating ${packagePath} with App Store Connect.`);
await runAltoolWithAppStoreConnectApiKey(
  ["--validate-app", packagePath, "--output-format", "json"],
  {
    keyId: API_KEY_ID,
    issuerId: API_ISSUER_ID,
    cwd: repositoryRoot,
  },
);

console.log(`Uploading ${packagePath} to App Store Connect.`);
await runAltoolWithAppStoreConnectApiKey(
  ["--upload-app", "-f", packagePath, "--show-progress"],
  {
    keyId: API_KEY_ID,
    issuerId: API_ISSUER_ID,
    cwd: repositoryRoot,
  },
);

console.log(
  "Label Maker was uploaded. App Store Connect can take time to process the build.",
);

function requiredEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with status ${String(result.status)}. The upload stopped.`,
    );
  }
}
