import { spawnSync } from "node:child_process";
import { accessSync } from "node:fs";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  readAppStoreConnectApiKey,
  runAltoolWithAppStoreConnectApiKey,
} from "../../../scripts/app-store-connect-key.mjs";
import { nextMacAppStoreBuildNumber } from "../../../scripts/app-store-build-number.mjs";
import { withReleaseVersionLock } from "../../../scripts/release-version-lock.mjs";
import { readReleaseVersion } from "../../../scripts/release-version.mjs";

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

const API_KEY_ID = requiredEnvironmentValue(
  "LABELMAKER_APP_STORE_CONNECT_KEY_ID",
);
const API_ISSUER_ID = requiredEnvironmentValue(
  "LABELMAKER_APP_STORE_CONNECT_ISSUER_ID",
);

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
const outputRoot = resolve(repositoryRoot, "release/macos-app-store");
await mkdir(outputRoot, { recursive: true });
const lockPath = resolve(outputRoot, ".upload.lock");
let lock;
try {
  lock = await open(lockPath, "wx", 0o600);
} catch (error) {
  if (error.code === "EEXIST") {
    throw new Error(
      `A Mac upload lock exists at ${lockPath}. If no upload is running, remove the lock and try again.`,
    );
  }
  throw error;
}
try {
  const versionPath = resolve(repositoryRoot, "distribution/version.json");
  const releaseVersion = await withReleaseVersionLock(versionPath, async () => {
    const releaseVersion = await readReleaseVersion();
    console.log("Checking App Store Connect for the next macOS build number.");
    const buildNumber = await nextMacAppStoreBuildNumber({
      keyId: API_KEY_ID,
      issuerId: API_ISSUER_ID,
      bundleId:
        process.env.LABELMAKER_MAS_BUNDLE_ID ?? "com.opendle.labelmaker",
      currentBuildNumber: releaseVersion.buildNumbers.macos,
    });
    const temporaryVersionPath = `${versionPath}.${process.pid}.tmp`;
    try {
      const current = await readReleaseVersion();
      if (JSON.stringify(current) !== JSON.stringify(releaseVersion)) {
        throw new Error(
          "The release version changed during the build check. Try again.",
        );
      }
      releaseVersion.buildNumbers.macos = buildNumber;
      await writeFile(
        temporaryVersionPath,
        `${JSON.stringify(releaseVersion, null, 2)}\n`,
        { flag: "wx" },
      );
      await rename(temporaryVersionPath, versionPath);
    } finally {
      await rm(temporaryVersionPath, { force: true });
    }
    return releaseVersion;
  });
  const APP_VERSION = releaseVersion.productVersion;
  const BUILD_VERSION = String(releaseVersion.buildNumbers.macos);
  console.log(
    `Using macOS build ${BUILD_VERSION}. Saved to distribution/version.json.`,
  );

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
} finally {
  await lock.close();
  await rm(lockPath, { force: true });
}

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
