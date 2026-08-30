import { readFile } from "node:fs/promises";

const versionUrl = new URL("../distribution/version.json", import.meta.url);
const projectUrl = new URL(
  "../apps/ipad/Labelmaker.xcodeproj/project.pbxproj",
  import.meta.url,
);

const value = JSON.parse(await readFile(versionUrl, "utf8"));
if (
  value?.schemaVersion !== 1 ||
  typeof value.productVersion !== "string" ||
  !/^\d+\.\d+\.\d+$/.test(value.productVersion) ||
  !isRecord(value.buildNumbers)
) {
  throw new Error("The release version manifest is invalid");
}

for (const platform of ["android", "ios", "macos", "windows", "linux"]) {
  const build = value.buildNumbers[platform];
  if (!Number.isSafeInteger(build) || build < 0) {
    throw new Error(`The ${platform} build number is invalid`);
  }
}
for (const platform of ["android", "ios", "macos"]) {
  if (value.buildNumbers[platform] < 1) {
    throw new Error(`The ${platform} build number must be positive`);
  }
}

const project = await readFile(projectUrl, "utf8");
const iosMarketingVersion = value.productVersion.replace(/\.0$/, "");
if (!project.includes(`MARKETING_VERSION = ${iosMarketingVersion};`)) {
  throw new Error(
    "The Apple mobile marketing version does not match the manifest",
  );
}
if (
  !project.includes(
    `CURRENT_PROJECT_VERSION = ${String(value.buildNumbers.ios)};`,
  )
) {
  throw new Error("The Apple mobile build number does not match the manifest");
}

function isRecord(candidate) {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
  );
}
