import { spawnSync } from "node:child_process";
import { accessSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

import plist from "plist";

import {
  readAppStoreConnectApiKey,
  runAltoolWithAppStoreConnectApiKey,
} from "../../../scripts/app-store-connect-key.mjs";
import { readReleaseVersion } from "../../../scripts/release-version.mjs";

const BUNDLE_IDENTIFIER = "com.opendle.labelmaker";
const releaseVersion = await readReleaseVersion();
const APP_VERSION = releaseVersion.productVersion;
const BUILD_VERSION = String(releaseVersion.buildNumbers?.ios);
const TEAM_IDENTIFIER = requiredEnvironmentValue("LABELMAKER_APPLE_TEAM_ID");
const mode = readMode(process.argv.slice(2));

if (process.platform !== "darwin") {
  throw new Error("The iOS App Store package must be built on macOS.");
}
if (!/^[A-Z0-9]{10}$/.test(TEAM_IDENTIFIER)) {
  throw new Error("LABELMAKER_APPLE_TEAM_ID is invalid.");
}

const uploadCredentials =
  mode === "upload"
    ? {
        keyId: requiredEnvironmentValue("LABELMAKER_APP_STORE_CONNECT_KEY_ID"),
        issuerId: requiredEnvironmentValue(
          "LABELMAKER_APP_STORE_CONNECT_ISSUER_ID",
        ),
      }
    : undefined;
if (uploadCredentials) {
  validateUploadCredentials(uploadCredentials);
  const preflightKey = readAppStoreConnectApiKey(uploadCredentials.keyId);
  preflightKey.fill(0);
}

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const projectPath = resolve(repositoryRoot, "apps/ipad/Labelmaker.xcodeproj");
const allowedOutputRoot = resolve(repositoryRoot, "release/ios-app-store");
const outputDirectory = resolve(
  allowedOutputRoot,
  `${APP_VERSION}-${BUILD_VERSION}`,
);
if (!outputDirectory.startsWith(`${allowedOutputRoot}${sep}`)) {
  throw new Error("The iOS App Store output directory is not safe.");
}
const archivePath = resolve(outputDirectory, "Label Maker.xcarchive");
const exportDirectory = resolve(outputDirectory, "export");
const ipaPath = resolve(
  outputDirectory,
  `Label Maker-${APP_VERSION}-${BUILD_VERSION}.ipa`,
);
const stagingDirectory = await mkdtemp(
  resolve(tmpdir(), "label-maker-ios-app-store-"),
);

try {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(exportDirectory, { recursive: true });

  run("npm", ["run", "build:web", "--workspace", "@labelmaker/ipad"]);
  run("/usr/bin/xcodebuild", [
    "-project",
    projectPath,
    "-quiet",
    "-scheme",
    "Labelmaker",
    "-configuration",
    "Release",
    "-destination",
    "generic/platform=iOS",
    "-derivedDataPath",
    resolve(stagingDirectory, "DerivedData"),
    "-archivePath",
    archivePath,
    "-allowProvisioningUpdates",
    `DEVELOPMENT_TEAM=${TEAM_IDENTIFIER}`,
    `MARKETING_VERSION=${APP_VERSION}`,
    `CURRENT_PROJECT_VERSION=${BUILD_VERSION}`,
    "archive",
  ]);

  const exportOptionsPath = resolve(stagingDirectory, "ExportOptions.plist");
  await writeFile(
    exportOptionsPath,
    plist.build({
      destination: "export",
      manageAppVersionAndBuildNumber: false,
      method: "app-store-connect",
      signingStyle: "automatic",
      stripSwiftSymbols: true,
      teamID: TEAM_IDENTIFIER,
      uploadSymbols: true,
    }),
    { encoding: "utf8", mode: 0o600 },
  );
  run("/usr/bin/xcodebuild", [
    "-exportArchive",
    "-quiet",
    "-archivePath",
    archivePath,
    "-exportPath",
    exportDirectory,
    "-exportOptionsPlist",
    exportOptionsPath,
    "-allowProvisioningUpdates",
  ]);

  const exportedIpaNames = (await readdir(exportDirectory)).filter((name) =>
    name.endsWith(".ipa"),
  );
  if (exportedIpaNames.length !== 1 || !exportedIpaNames[0]) {
    throw new Error(
      `Xcode exported ${String(exportedIpaNames.length)} iOS packages; expected one.`,
    );
  }
  await rename(resolve(exportDirectory, exportedIpaNames[0]), ipaPath);
  await validateIpa(ipaPath, stagingDirectory);

  if (uploadCredentials) {
    await uploadIpa(ipaPath, uploadCredentials);
  } else {
    console.log(`iOS App Store package saved to ${ipaPath}`);
  }
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}

async function validateIpa(path, stagingRoot) {
  run("/usr/bin/unzip", ["-tq", path]);
  const inspectionDirectory = resolve(stagingRoot, "ipa-inspection");
  await mkdir(inspectionDirectory, { recursive: true });
  run("/usr/bin/ditto", ["-x", "-k", path, inspectionDirectory]);
  const payloadDirectory = resolve(inspectionDirectory, "Payload");
  const appNames = (await readdir(payloadDirectory)).filter((name) =>
    name.endsWith(".app"),
  );
  if (appNames.length !== 1 || !appNames[0]) {
    throw new Error(
      `The iOS package contains ${String(appNames.length)} apps; expected one.`,
    );
  }
  const appPath = resolve(payloadDirectory, appNames[0]);
  const infoPath = resolve(appPath, "Info.plist");
  assertPlistValue(infoPath, "CFBundleIdentifier", BUNDLE_IDENTIFIER);
  assertPlistValue(infoPath, "CFBundleShortVersionString", APP_VERSION);
  assertPlistValue(infoPath, "CFBundleVersion", BUILD_VERSION);
  const executableName = readPlistValue(infoPath, "CFBundleExecutable");
  const executablePath = resolve(appPath, executableName);
  const architectures = new Set(
    runCapture("/usr/bin/lipo", ["-archs", executablePath]).trim().split(/\s+/),
  );
  if (!architectures.has("arm64")) {
    throw new Error("The exported iOS app does not contain arm64 code.");
  }
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);

  const profilePath = resolve(appPath, "embedded.mobileprovision");
  accessSync(profilePath);
  const profile = plist.parse(
    runCapture("/usr/bin/security", ["cms", "-D", "-i", profilePath]),
  );
  const profileEntitlements = profile.Entitlements ?? {};
  if (
    profileEntitlements["application-identifier"] !==
      `${TEAM_IDENTIFIER}.${BUNDLE_IDENTIFIER}` ||
    profileEntitlements["com.apple.developer.team-identifier"] !==
      TEAM_IDENTIFIER ||
    profile.ProvisionedDevices !== undefined ||
    profile.ProvisionsAllDevices === true
  ) {
    throw new Error("The exported iOS app does not use an App Store profile.");
  }
}

async function uploadIpa(path, credentials) {
  console.log(`Validating ${path} with App Store Connect.`);
  await runAltoolWithAppStoreConnectApiKey(
    ["--validate-app", path, "--output-format", "json"],
    { ...credentials, cwd: repositoryRoot },
  );
  console.log(`Uploading ${path} to App Store Connect.`);
  await runAltoolWithAppStoreConnectApiKey(
    ["--upload-app", "-f", path, "--show-progress"],
    { ...credentials, cwd: repositoryRoot },
  );
  console.log(
    "Label Maker for iPhone and iPad was uploaded. App Store Connect can take time to process the build.",
  );
}

function validateUploadCredentials(credentials) {
  if (!/^[A-Za-z0-9]+$/.test(credentials.keyId)) {
    throw new Error("LABELMAKER_APP_STORE_CONNECT_KEY_ID is invalid.");
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      credentials.issuerId,
    )
  ) {
    throw new Error("LABELMAKER_APP_STORE_CONNECT_ISSUER_ID is invalid.");
  }
}

function assertPlistValue(path, key, expected) {
  const actual = readPlistValue(path, key);
  if (actual !== expected) {
    throw new Error(`${key} is ${actual}; expected ${expected}.`);
  }
}

function readPlistValue(path, key) {
  return runCapture("/usr/bin/plutil", ["-extract", key, "raw", path]).trim();
}

function requiredEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

function readMode(arguments_) {
  if (arguments_.length !== 1) {
    throw new Error("Use exactly one of --distribution or --upload.");
  }
  if (arguments_[0] === "--distribution") return "distribution";
  if (arguments_[0] === "--upload") return "upload";
  throw new Error("Use exactly one of --distribution or --upload.");
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${String(result.status)}.`);
  }
}

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `${command} failed${detail ? `: ${detail}` : ` with status ${String(result.status)}`}`,
    );
  }
  return result.stdout;
}
