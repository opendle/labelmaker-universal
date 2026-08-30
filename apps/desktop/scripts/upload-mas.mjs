import { spawnSync } from "node:child_process";
import { accessSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const APP_VERSION = requiredEnvironmentValue("LABELMAKER_MAS_VERSION");
const BUILD_VERSION = requiredEnvironmentValue("LABELMAKER_MAS_BUILD");
const API_KEY_ID = requiredEnvironmentValue(
  "LABELMAKER_APP_STORE_CONNECT_KEY_ID",
);
const API_ISSUER_ID = requiredEnvironmentValue(
  "LABELMAKER_APP_STORE_CONNECT_ISSUER_ID",
);

if (!/^\d+(?:\.\d+){0,2}$/.test(APP_VERSION)) {
  throw new Error("LABELMAKER_MAS_VERSION must contain one to three numbers.");
}
if (!/^\d+(?:\.\d+){0,2}$/.test(BUILD_VERSION)) {
  throw new Error("LABELMAKER_MAS_BUILD must contain one to three numbers.");
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
const apiKeyPath = findApiKeyPath(API_KEY_ID);
const apiKeyStats = statSync(apiKeyPath);
if (!apiKeyStats.isFile()) {
  throw new Error(`${apiKeyPath} is not an App Store Connect API key file.`);
}
const apiKeyMode = apiKeyStats.mode & 0o777;
if ((apiKeyMode & 0o077) !== 0) {
  throw new Error(
    `Protect ${apiKeyPath} with chmod 600 before an App Store upload.`,
  );
}

console.log("Building and signing a new Label Maker Mac App Store package.");
run(process.execPath, [
  resolve(appDirectory, "scripts/package-mas.mjs"),
  "--distribution",
]);
accessSync(packagePath);

const authenticationArguments = [
  "--api-key",
  API_KEY_ID,
  "--api-issuer",
  API_ISSUER_ID,
  "--p8-file-path",
  apiKeyPath,
];

console.log(`Validating ${packagePath} with App Store Connect.`);
run("/usr/bin/xcrun", [
  "altool",
  "--validate-app",
  packagePath,
  ...authenticationArguments,
  "--output-format",
  "json",
]);

console.log(`Uploading ${packagePath} to App Store Connect.`);
run("/usr/bin/xcrun", [
  "altool",
  "--upload-app",
  "-f",
  packagePath,
  ...authenticationArguments,
  "--show-progress",
]);

console.log(
  "Label Maker was uploaded. App Store Connect can take time to process the build.",
);

function requiredEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

function findApiKeyPath(keyId) {
  const fileName = `AuthKey_${keyId}.p8`;
  const configuredPath = process.env.LABELMAKER_APP_STORE_CONNECT_KEY_PATH;
  if (configuredPath) {
    const candidate = resolve(configuredPath);
    try {
      accessSync(candidate);
    } catch {
      throw new Error(
        `Could not read the App Store Connect API key at ${candidate}.`,
      );
    }
    return candidate;
  }
  const configuredDirectory = process.env.API_PRIVATE_KEYS_DIR;
  const candidates = [
    ...(configuredDirectory ? [resolve(configuredDirectory, fileName)] : []),
    resolve(homedir(), ".appstoreconnect/private_keys", fileName),
    resolve(homedir(), ".private_keys", fileName),
    resolve(homedir(), "private_keys", fileName),
  ];
  for (const candidate of candidates) {
    try {
      accessSync(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(
    `Install ${fileName} under ~/.appstoreconnect/private_keys, or set LABELMAKER_APP_STORE_CONNECT_KEY_PATH.`,
  );
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
