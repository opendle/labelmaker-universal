import { readFile, rename, rm, writeFile } from "node:fs/promises";

import { nextAppStoreBuildNumber } from "../../../scripts/app-store-build-number.mjs";
import { withReleaseVersionLock } from "../../../scripts/release-version-lock.mjs";
import { readReleaseVersion } from "../../../scripts/release-version.mjs";

export async function reserveIosUploadBuild(
  { versionPath, projectFilePath, bundleId, credentials },
  { nextBuildNumber = nextAppStoreBuildNumber } = {},
) {
  return withReleaseVersionLock(versionPath, async () => {
    const versionSource = await readFile(versionPath, "utf8");
    const version = await readReleaseVersion(versionPath);
    const projectSource = await readFile(projectFilePath, "utf8");
    const buildSettings = [
      ...projectSource.matchAll(/\bCURRENT_PROJECT_VERSION = ([^;]+);/g),
    ];
    if (
      buildSettings.length < 2 ||
      !buildSettings.every((match) => /^\d+$/.test(match[1]))
    ) {
      throw new Error("The Xcode project build settings are invalid.");
    }
    const buildNumber = await nextBuildNumber({
      ...credentials,
      bundleId,
      platform: "IOS",
      currentBuildNumber: version.buildNumbers.ios,
    });
    if (
      !Number.isSafeInteger(buildNumber) ||
      buildNumber <= version.buildNumbers.ios
    ) {
      throw new Error("The selected iOS build number is invalid.");
    }
    if (
      (await readFile(versionPath, "utf8")) !== versionSource ||
      (await readFile(projectFilePath, "utf8")) !== projectSource
    ) {
      throw new Error(
        "The release version or Xcode project changed during the build check. Try again.",
      );
    }
    version.buildNumbers.ios = buildNumber;
    const project = projectSource.replace(
      /\bCURRENT_PROJECT_VERSION = [^;]+;/g,
      `CURRENT_PROJECT_VERSION = ${buildNumber};`,
    );
    const temporaryVersionPath = `${versionPath}.${process.pid}.tmp`;
    const temporaryProjectPath = `${projectFilePath}.${process.pid}.tmp`;
    try {
      await writeFile(
        temporaryVersionPath,
        `${JSON.stringify(version, null, 2)}\n`,
        { flag: "wx" },
      );
      await writeFile(temporaryProjectPath, project, { flag: "wx" });
      await rename(temporaryVersionPath, versionPath);
      try {
        await rename(temporaryProjectPath, projectFilePath);
      } catch (error) {
        await writeFile(temporaryVersionPath, versionSource, { flag: "wx" });
        await rename(temporaryVersionPath, versionPath);
        throw error;
      }
    } finally {
      await rm(temporaryVersionPath, { force: true });
      await rm(temporaryProjectPath, { force: true });
    }
    return version;
  });
}
