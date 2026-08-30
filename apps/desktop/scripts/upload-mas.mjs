import { spawnSync } from "node:child_process";
import { accessSync } from "node:fs";
import { resolve } from "node:path";

const KEYCHAIN_SERVICE = "com.opendle.labelmaker.app-store-connect-api-key";
const arguments_ = process.argv.slice(2);

if (arguments_.length === 1 && arguments_[0] === "--check-keychain") {
  const keyId = requiredEnvironmentValue("LABELMAKER_APP_STORE_CONNECT_KEY_ID");
  const key = readApiPrivateKey(keyId);
  key.fill(0);
  console.log(`App Store Connect API key ${keyId} is available in Keychain.`);
  process.exit(0);
}
if (arguments_.length !== 0) {
  throw new Error("The upload command arguments are invalid.");
}

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
  "/dev/stdin",
];

const apiPrivateKey = readApiPrivateKey(API_KEY_ID);
try {
  console.log(`Validating ${packagePath} with App Store Connect.`);
  run(
    "/usr/bin/xcrun",
    [
      "altool",
      "--validate-app",
      packagePath,
      ...authenticationArguments,
      "--output-format",
      "json",
    ],
    { input: apiPrivateKey },
  );

  console.log(`Uploading ${packagePath} to App Store Connect.`);
  run(
    "/usr/bin/xcrun",
    [
      "altool",
      "--upload-app",
      "-f",
      packagePath,
      ...authenticationArguments,
      "--show-progress",
    ],
    { input: apiPrivateKey },
  );
} finally {
  apiPrivateKey.fill(0);
}

console.log(
  "Label Maker was uploaded. App Store Connect can take time to process the build.",
);

function requiredEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

function readApiPrivateKey(keyId) {
  const result = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", keyId, "-w"],
    {
      encoding: null,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Could not read App Store Connect API key ${keyId} from the login Keychain.`,
    );
  }
  const key = decodeKeychainPassword(result.stdout);
  if (
    !key.includes(Buffer.from("-----BEGIN PRIVATE KEY-----")) ||
    !key.includes(Buffer.from("-----END PRIVATE KEY-----"))
  ) {
    key.fill(0);
    throw new Error(`The Keychain item for ${keyId} is not a valid API key.`);
  }
  return key;
}

function decodeKeychainPassword(value) {
  let end = value.length;
  while (
    end > 0 &&
    (value[end - 1] === 0x0a ||
      value[end - 1] === 0x0d ||
      value[end - 1] === 0x20 ||
      value[end - 1] === 0x09)
  ) {
    end -= 1;
  }
  const isHexadecimal =
    end > 0 && end % 2 === 0 && value.subarray(0, end).every(isHexadecimalByte);
  if (!isHexadecimal) {
    const decoded = Buffer.from(value);
    value.fill(0);
    return decoded;
  }

  const decoded = Buffer.alloc(end / 2);
  for (let index = 0; index < end; index += 2) {
    decoded[index / 2] =
      hexadecimalNibble(value[index]) * 16 +
      hexadecimalNibble(value[index + 1]);
  }
  value.fill(0);
  return decoded;
}

function isHexadecimalByte(value) {
  return (
    (value >= 0x30 && value <= 0x39) ||
    (value >= 0x41 && value <= 0x46) ||
    (value >= 0x61 && value <= 0x66)
  );
}

function hexadecimalNibble(value) {
  if (value >= 0x30 && value <= 0x39) return value - 0x30;
  if (value >= 0x41 && value <= 0x46) return value - 0x41 + 10;
  return value - 0x61 + 10;
}

function run(command, args, options = {}) {
  const hasInput = options.input !== undefined;
  const result = spawnSync(command, args, {
    env: process.env,
    ...(hasInput ? { input: options.input } : {}),
    stdio: hasInput ? ["pipe", "inherit", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with status ${String(result.status)}. The upload stopped.`,
    );
  }
}
