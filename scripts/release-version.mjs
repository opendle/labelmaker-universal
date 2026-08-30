import { readFile } from "node:fs/promises";

const DEFAULT_VERSION_URL = new URL(
  "../distribution/version.json",
  import.meta.url,
);
const PLATFORMS = ["android", "ios", "macos", "windows", "linux"];
const PLATFORM_NAMES = {
  android: "Android",
  ios: "iOS",
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
};

export async function readReleaseVersion(url = DEFAULT_VERSION_URL) {
  return validateReleaseVersion(JSON.parse(await readFile(url, "utf8")));
}

export function validateReleaseVersion(value) {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.productVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(value.productVersion) ||
    !isRecord(value.buildNumbers)
  ) {
    throw new Error("The release version manifest is invalid.");
  }
  for (const platform of PLATFORMS) {
    const build = value.buildNumbers[platform];
    if (!Number.isSafeInteger(build) || build < 0) {
      throw new Error(
        `The ${PLATFORM_NAMES[platform]} build number is invalid.`,
      );
    }
  }
  for (const platform of ["android", "ios", "macos"]) {
    if (value.buildNumbers[platform] < 1) {
      throw new Error(
        `The ${PLATFORM_NAMES[platform]} build number must be positive.`,
      );
    }
  }
  if (value.buildNumbers.android > 2_100_000_000) {
    throw new Error(
      "The Android build number must not be more than 2100000000.",
    );
  }
  return value;
}

function isRecord(candidate) {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
  );
}
