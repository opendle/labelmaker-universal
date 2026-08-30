import { readFile } from "node:fs/promises";

import { readReleaseVersion } from "./release-version.mjs";

const projectUrl = new URL(
  "../apps/ipad/Labelmaker.xcodeproj/project.pbxproj",
  import.meta.url,
);

const value = await readReleaseVersion();

const project = await readFile(projectUrl, "utf8");
const iosMarketingVersion = value.productVersion.replace(/\.0$/, "");
const marketingVersions = [
  ...project.matchAll(/\bMARKETING_VERSION = ([^;]+);/g),
];
if (
  marketingVersions.length < 2 ||
  !marketingVersions.every((match) => match[1] === iosMarketingVersion)
) {
  throw new Error(
    "The Apple mobile marketing version does not match the manifest",
  );
}
const buildVersions = [
  ...project.matchAll(/\bCURRENT_PROJECT_VERSION = ([^;]+);/g),
];
if (
  buildVersions.length < 2 ||
  !buildVersions.every((match) => match[1] === String(value.buildNumbers.ios))
) {
  throw new Error("The Apple mobile build number does not match the manifest");
}
