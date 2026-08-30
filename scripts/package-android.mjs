import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const androidRoot = resolve(repositoryRoot, "apps/android");
const releaseRoot = resolve(repositoryRoot, "release/android");
const versionPath = resolve(repositoryRoot, "distribution/version.json");
const noticesPath = resolve(
  repositoryRoot,
  "distribution/android/THIRD_PARTY_NOTICES.md",
);

const mode = readMode(process.argv.slice(2));
if (mode === "help") {
  console.log(
    "Build a signed Android release: package-android.mjs --bundle or --apk",
  );
  process.exit(0);
}

requireCleanWorktree();
const version = JSON.parse(await readFile(versionPath, "utf8"));
const productVersion = requiredVersion(version.productVersion);
const buildNumber = requiredBuildNumber(version.buildNumbers?.android);
const releaseDirectory = resolve(
  releaseRoot,
  `${productVersion}-${String(buildNumber)}`,
  mode === "bundle" ? "play" : "direct",
);
if (!releaseDirectory.startsWith(`${releaseRoot}${sep}`)) {
  throw new Error("The Android release output directory is not safe.");
}

const configuration =
  mode === "bundle"
    ? {
        task: "verifiedBundlePlayRelease",
        source: resolve(
          androidRoot,
          "app/build/outputs/bundle/playRelease/app-play-release.aab",
        ),
        destination: `Label-Maker-${productVersion}-${String(buildNumber)}-play.aab`,
      }
    : {
        task: "verifiedAssembleDirectRelease",
        source: resolve(
          androidRoot,
          "app/build/outputs/apk/direct/release/app-direct-release.apk",
        ),
        destination: `Label-Maker-${productVersion}-${String(buildNumber)}-universal.apk`,
      };

run(resolve(androidRoot, "gradlew"), [
  "-p",
  androidRoot,
  configuration.task,
  "--no-daemon",
]);

const artifactInformation = await stat(configuration.source).catch(() => null);
if (!artifactInformation?.isFile()) {
  throw new Error(`The Android build did not make ${configuration.source}.`);
}

await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });
const artifactPath = resolve(releaseDirectory, configuration.destination);
const releaseNoticesPath = resolve(releaseDirectory, basename(noticesPath));
await Promise.all([
  copyFile(configuration.source, artifactPath),
  copyFile(noticesPath, releaseNoticesPath),
]);

const [artifactHash, noticesHash, webBundleHash] = await Promise.all([
  hashFile(artifactPath),
  hashFile(releaseNoticesPath),
  hashDirectory(resolve(repositoryRoot, "apps/mobile-web/dist")),
]);
const checksumPath = `${artifactPath}.sha256`;
await writeFile(
  checksumPath,
  `${artifactHash}  ${basename(artifactPath)}\n`,
  "utf8",
);

const manifest = {
  schemaVersion: 1,
  sourceCommit: capture("git", ["rev-parse", "HEAD"]),
  productVersion,
  buildNumber,
  channel: mode === "bundle" ? "play" : "direct",
  applicationId: "com.opendle.labelmaker",
  minimumSdk: 31,
  targetSdk: 36,
  webBundleSha256: webBundleHash,
  tools: {
    node: process.version,
    npm: capture("npm", ["--version"]),
    java: firstVersionLine(capture("java", ["-version"], true)),
    gradle: gradleVersion(),
    androidBuildTools: "36.0.0",
  },
  artifacts: [
    {
      file: basename(artifactPath),
      sha256: artifactHash,
    },
    {
      file: basename(releaseNoticesPath),
      sha256: noticesHash,
    },
  ],
};
await writeFile(
  resolve(releaseDirectory, "release-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(`Android release files are in ${releaseDirectory}.`);

function readMode(arguments_) {
  if (arguments_.length === 1 && arguments_[0] === "--bundle") return "bundle";
  if (arguments_.length === 1 && arguments_[0] === "--apk") return "apk";
  if (arguments_.length === 1 && arguments_[0] === "--help") return "help";
  throw new Error("Use exactly one of --bundle or --apk.");
}

function requiredVersion(value) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error("The product version is invalid.");
  }
  return value;
}

function requiredBuildNumber(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("The Android build number is invalid.");
  }
  return value;
}

function requireCleanWorktree() {
  const status = capture("git", ["status", "--porcelain"]);
  if (status.length > 0) {
    throw new Error(
      "Commit all source changes before a signed Android release.",
    );
  }
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(
      `${basename(command)} could not start: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${basename(command)} stopped with status ${String(result.status)}.`,
    );
  }
}

function capture(command, arguments_, includeStandardError = false) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} version information is not available.`);
  }
  return `${result.stdout}${includeStandardError ? result.stderr : ""}`.trim();
}

function firstVersionLine(value) {
  return value.split(/\r?\n/, 1)[0] ?? value;
}

function gradleVersion() {
  const value = capture(resolve(androidRoot, "gradlew"), [
    "-p",
    androidRoot,
    "--version",
  ]);
  const match = value.match(/^Gradle\s+(.+)$/m);
  if (!match?.[1]) throw new Error("The Gradle version is not available.");
  return match[1];
}

async function hashFile(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function hashDirectory(directory) {
  const paths = await listFiles(directory);
  const digest = createHash("sha256");
  for (const path of paths) {
    digest.update(relative(directory, path));
    digest.update("\0");
    digest.update(await readFile(path));
    digest.update("\0");
  }
  return digest.digest("hex");
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await listFiles(path)));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}
