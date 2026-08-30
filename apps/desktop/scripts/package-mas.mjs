import { packager } from "@electron/packager";
import { flat, sign } from "@electron/osx-sign";
import { spawnSync } from "node:child_process";
import { accessSync, readFileSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import plist from "plist";
import { build as viteBuild } from "vite";

const APPLICATION_NAME = "Label Maker";
const BUNDLE_IDENTIFIER =
  process.env.LABELMAKER_MAS_BUNDLE_ID ?? "com.opendle.labelmaker";
const releaseVersion = JSON.parse(
  readFileSync(
    new URL("../../../distribution/version.json", import.meta.url),
    "utf8",
  ),
);
const APP_VERSION = releaseVersion.productVersion;
const BUILD_VERSION = String(releaseVersion.buildNumbers?.macos);
const COPYRIGHT =
  process.env.LABELMAKER_MAS_COPYRIGHT ?? "2026 Vincent Courcelle";
const BLUETOOTH_USAGE_DESCRIPTION =
  "Label Maker uses Bluetooth to find and print to your label printer.";
const mode = readMode(process.argv.slice(2));
const architecture = process.env.LABELMAKER_MAS_ARCH ?? "universal";

if (process.platform !== "darwin") {
  throw new Error("The Mac App Store package must be built on macOS.");
}
if (!/^(arm64|x64|universal)$/.test(architecture)) {
  throw new Error("LABELMAKER_MAS_ARCH must be arm64, x64, or universal.");
}
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

const appDirectory = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(appDirectory, "../..");
const resourcesDirectory = resolve(appDirectory, "resources");
const bundleIconBaseName = "Labelmaker";
const bundleIconSourcePath = resolve(
  resourcesDirectory,
  `${bundleIconBaseName}.icon`,
);
const entitlementsPath = resolve(resourcesDirectory, "mas/entitlements.plist");
const developmentEntitlementsPath = resolve(
  resourcesDirectory,
  "mas/entitlements-development.plist",
);
const childEntitlementsPath = resolve(
  resourcesDirectory,
  "mas/entitlements-child.plist",
);
const helperSourcePath = resolve(
  repositoryRoot,
  "packages/adapters/makeid/dist/bin/makeid-bluetooth-helper",
);
const outputRoot = resolve(repositoryRoot, `release/macos-app-store/${mode}`);
const allowedOutputRoot = resolve(repositoryRoot, "release/macos-app-store");
if (!outputRoot.startsWith(`${allowedOutputRoot}${sep}`)) {
  throw new Error("The Mac App Store output directory is not safe.");
}

const signingInputs = await resolveSigningInputs(BUNDLE_IDENTIFIER, mode);

const stagingDirectory = await mkdtemp(join(tmpdir(), "labelmaker-mas-stage-"));
try {
  run("npm", ["run", "build"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      LABELMAKER_MACOS_ARCH: architecture,
    },
  });
  await prepareStagingApplication(stagingDirectory);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const electronPackage = JSON.parse(
    await readFile(
      resolve(repositoryRoot, "node_modules/electron/package.json"),
      "utf8",
    ),
  );
  if (typeof electronPackage.version !== "string") {
    throw new Error("The installed Electron version is invalid.");
  }

  const packageDirectories = await packager({
    appBundleId: BUNDLE_IDENTIFIER,
    appCategoryType: "public.app-category.utilities",
    appCopyright: COPYRIGHT,
    appVersion: APP_VERSION,
    arch: architecture,
    asar: true,
    asarIntegrityDigest: true,
    buildVersion: BUILD_VERSION,
    dir: stagingDirectory,
    electronVersion: electronPackage.version,
    extendInfo: {
      ITSAppUsesNonExemptEncryption: false,
      LSMinimumSystemVersion: "13.0",
      NSBluetoothAlwaysUsageDescription: BLUETOOTH_USAGE_DESCRIPTION,
      NSHumanReadableCopyright: COPYRIGHT,
    },
    helperBundleId: `${BUNDLE_IDENTIFIER}.helper`,
    name: APPLICATION_NAME,
    out: outputRoot,
    overwrite: true,
    platform: "mas",
    prune: false,
    quiet: true,
  });
  if (packageDirectories.length !== 1) {
    throw new Error(
      `Electron Packager made ${String(packageDirectories.length)} output directories.`,
    );
  }

  const packageDirectory = packageDirectories[0];
  if (!packageDirectory) throw new Error("The package directory is missing.");
  const appPath = resolve(packageDirectory, `${APPLICATION_NAME}.app`);
  const bundleResources = resolve(appPath, "Contents/Resources");
  const helperPath = resolve(bundleResources, "makeid-bluetooth-helper");
  await prepareBundleMetadata(appPath);
  await Promise.all([
    cp(helperSourcePath, helperPath),
    cp(
      resolve(repositoryRoot, "LICENSE"),
      resolve(bundleResources, "LICENSE.txt"),
    ),
    cp(
      resolve(repositoryRoot, "PRIVACY.md"),
      resolve(bundleResources, "PRIVACY.md"),
    ),
  ]);
  await chmod(helperPath, 0o755);

  await sign({
    app: appPath,
    batchCodesignCalls: false,
    identity: signingInputs.applicationIdentity,
    identityValidation: true,
    optionsForFile: (filePath) => ({
      entitlements:
        resolve(filePath) === appPath
          ? mode === "development"
            ? developmentEntitlementsPath
            : entitlementsPath
          : childEntitlementsPath,
      ...(mode === "development"
        ? { hardenedRuntime: false, timestamp: "none" }
        : {}),
    }),
    platform: "mas",
    preAutoEntitlements: true,
    preEmbedProvisioningProfile: true,
    provisioningProfile: signingInputs.provisioningProfile,
    type: mode === "distribution" ? "distribution" : "development",
  });

  validateBundle({
    appPath,
    architecture,
    bundleIdentifier: BUNDLE_IDENTIFIER,
    helperPath,
    mode,
    teamIdentifier: signingInputs.teamIdentifier,
  });

  if (mode === "distribution") {
    const pkgPath = resolve(
      outputRoot,
      `${APPLICATION_NAME}-${APP_VERSION}-${BUILD_VERSION}.pkg`,
    );
    await flat({
      app: appPath,
      identity: signingInputs.installerIdentity,
      implementation: "native",
      install: "/Applications",
      pkg: pkgPath,
      platform: "mas",
    });
    run("/usr/sbin/pkgutil", ["--check-signature", pkgPath]);
    console.log(`Mac App Store package saved to ${pkgPath}`);
  } else {
    run(process.execPath, [
      resolve(appDirectory, "scripts/smoke-mas.mjs"),
      appPath,
    ]);
    console.log(`Sandboxed Mac App Store test app saved to ${appPath}`);
  }
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}

async function prepareStagingApplication(directory) {
  const mainOutput = resolve(directory, "dist/main");
  await viteBuild({
    build: {
      emptyOutDir: true,
      outDir: mainOutput,
      rollupOptions: {
        external: (id) => id === "electron" || id.startsWith("node:"),
        output: { entryFileNames: "index.js" },
      },
      ssr: resolve(appDirectory, "dist/main/index.js"),
      target: "node22",
    },
    configFile: false,
    logLevel: "warn",
    root: repositoryRoot,
    ssr: { noExternal: true },
  });
  await Promise.all([
    cp(
      resolve(appDirectory, "dist/main/preload.cjs"),
      resolve(mainOutput, "preload.cjs"),
    ),
    cp(
      resolve(appDirectory, "dist/renderer"),
      resolve(directory, "dist/renderer"),
      { recursive: true },
    ),
  ]);
  await writeFile(
    resolve(directory, "package.json"),
    `${JSON.stringify(
      {
        name: "labelmaker",
        productName: APPLICATION_NAME,
        version: normalizedPackageVersion(APP_VERSION),
        private: true,
        type: "module",
        main: "dist/main/index.js",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function prepareBundleMetadata(appPath) {
  const bundleResources = resolve(appPath, "Contents/Resources");
  const infoPath = resolve(appPath, "Contents/Info.plist");
  const partialInfoPath = resolve(
    bundleResources,
    ".label-maker-icon-info.plist",
  );
  try {
    run("/usr/bin/xcrun", [
      "actool",
      "--compile",
      bundleResources,
      "--platform",
      "macosx",
      "--minimum-deployment-target",
      "13.0",
      "--app-icon",
      bundleIconBaseName,
      "--output-partial-info-plist",
      partialInfoPath,
      bundleIconSourcePath,
    ]);
  } finally {
    await rm(partialInfoPath, { force: true });
  }
  replacePlistString(
    infoPath,
    "CFBundleIconFile",
    `${bundleIconBaseName}.icns`,
  );
  replacePlistString(infoPath, "CFBundleIconName", bundleIconBaseName);
  for (const key of [
    "NSAppTransportSecurity",
    "NSAudioCaptureUsageDescription",
    "NSBluetoothPeripheralUsageDescription",
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription",
  ]) {
    removePlistValue(infoPath, key);
  }
}

function validateBundle({
  appPath,
  architecture: expectedArchitecture,
  bundleIdentifier,
  helperPath,
  mode: signingMode,
  teamIdentifier,
}) {
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
  const infoPath = resolve(appPath, "Contents/Info.plist");
  assertPlistValue(infoPath, "CFBundleIdentifier", bundleIdentifier);
  assertPlistValue(infoPath, "CFBundleShortVersionString", APP_VERSION);
  assertPlistValue(infoPath, "CFBundleVersion", BUILD_VERSION);
  assertPlistValue(
    infoPath,
    "NSBluetoothAlwaysUsageDescription",
    BLUETOOTH_USAGE_DESCRIPTION,
  );
  assertPlistValue(infoPath, "CFBundleIconFile", `${bundleIconBaseName}.icns`);
  assertPlistValue(infoPath, "CFBundleIconName", bundleIconBaseName);
  accessSync(
    resolve(appPath, "Contents/Resources", `${bundleIconBaseName}.icns`),
  );
  accessSync(resolve(appPath, "Contents/Resources/Assets.car"));
  for (const key of [
    "NSAppTransportSecurity",
    "NSAudioCaptureUsageDescription",
    "NSBluetoothPeripheralUsageDescription",
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription",
  ]) {
    assertMissingPlistValue(infoPath, key);
  }
  const executableName = readPlistValue(infoPath, "CFBundleExecutable");
  assertArchitectures(
    resolve(appPath, "Contents/MacOS", executableName),
    expectedArchitecture,
  );
  assertArchitectures(helperPath, expectedArchitecture);

  const appEntitlements = readSignedEntitlements(appPath);
  const helperEntitlements = readSignedEntitlements(helperPath);
  for (const key of [
    "com.apple.security.app-sandbox",
    "com.apple.security.device.bluetooth",
    "com.apple.security.files.bookmarks.app-scope",
    "com.apple.security.files.user-selected.read-write",
  ]) {
    if (appEntitlements[key] !== true) {
      throw new Error(`The signed app is missing the ${key} entitlement.`);
    }
  }
  if (
    signingMode === "development" &&
    appEntitlements["com.apple.security.network.server"] !== true
  ) {
    throw new Error(
      "The development app cannot open the local automation connection.",
    );
  }
  if (
    signingMode === "distribution" &&
    appEntitlements["com.apple.security.network.server"] !== undefined
  ) {
    throw new Error(
      "The distribution app has an unneeded local-server entitlement.",
    );
  }
  if (
    helperEntitlements["com.apple.security.app-sandbox"] !== true ||
    helperEntitlements["com.apple.security.inherit"] !== true
  ) {
    throw new Error("The Bluetooth helper does not inherit the App Sandbox.");
  }

  if (!teamIdentifier) throw new Error("The signing team is missing.");
  const applicationIdentifier = `${teamIdentifier}.${bundleIdentifier}`;
  const applicationGroups =
    appEntitlements["com.apple.security.application-groups"];
  assertPlistValue(infoPath, "ElectronTeamID", teamIdentifier);
  if (
    appEntitlements["com.apple.application-identifier"] !==
      applicationIdentifier ||
    appEntitlements["com.apple.developer.team-identifier"] !== teamIdentifier ||
    !Array.isArray(applicationGroups) ||
    !applicationGroups.includes(applicationIdentifier)
  ) {
    throw new Error("The signed identifiers do not match the profile.");
  }
  accessSync(resolve(appPath, "Contents/embedded.provisionprofile"));

  if (signingMode === "distribution") {
    run("/usr/bin/codesign", [
      "--verify",
      "--deep",
      "--strict",
      "--test-requirement",
      "=anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.7] exists",
      appPath,
    ]);
  }
}

async function resolveSigningInputs(bundleIdentifier, signingMode) {
  const requestedTeam = process.env.LABELMAKER_APPLE_TEAM_ID;
  const profile = await findProvisioningProfile(
    bundleIdentifier,
    requestedTeam,
    signingMode,
  );
  const applicationIdentity = findApplicationIdentity(
    profile.teamIdentifier,
    signingMode,
  );
  const ownerName = identityOwnerName(applicationIdentity);
  return {
    applicationIdentity,
    ...(signingMode === "distribution"
      ? {
          installerIdentity: findInstallerIdentity(
            ownerName,
            profile.teamIdentifier,
          ),
        }
      : {}),
    provisioningProfile: profile.path,
    teamIdentifier: profile.teamIdentifier,
  };
}

function findApplicationIdentity(requestedTeam, signingMode) {
  const configured =
    process.env[
      signingMode === "distribution"
        ? "LABELMAKER_MAS_APPLICATION_IDENTITY"
        : "LABELMAKER_MAS_DEVELOPMENT_IDENTITY"
    ];
  if (configured) {
    if (
      !hasIdentity(configured, "codesigning") ||
      certificateTeamIdentifier(configured) !== requestedTeam
    ) {
      throw new Error(
        "The configured application identity is missing its private key or does not match the selected team.",
      );
    }
    return configured;
  }
  const prefix =
    signingMode === "distribution"
      ? "Apple Distribution:"
      : "Apple Development:";
  const output = run("/usr/bin/security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
  ]);
  const identities = output
    .split("\n")
    .flatMap((line) => {
      const match = new RegExp(`"(${prefix} [^"]+)"`).exec(line);
      return match?.[1] ? [match[1]] : [];
    })
    .filter(
      (identity) => certificateTeamIdentifier(identity) === requestedTeam,
    );
  if (identities.length === 0) {
    throw new Error(
      signingMode === "distribution"
        ? "Install one Apple Distribution identity for the selected team, or set LABELMAKER_MAS_APPLICATION_IDENTITY."
        : "Install one Apple Development identity for the selected team, or set LABELMAKER_MAS_DEVELOPMENT_IDENTITY.",
    );
  }
  return identities.toSorted(
    (left, right) => certificateExpiration(right) - certificateExpiration(left),
  )[0];
}

function certificateTeamIdentifier(identity) {
  const certificate = run("/usr/bin/security", [
    "find-certificate",
    "-c",
    identity,
    "-p",
  ]);
  const subject = run(
    "/usr/bin/openssl",
    ["x509", "-noout", "-subject", "-nameopt", "RFC2253"],
    { input: certificate },
  );
  const match = /(?:^|,)OU=([^,]+)/.exec(subject.replace(/^subject=/, ""));
  return match?.[1];
}

function certificateExpiration(identity) {
  const certificate = run("/usr/bin/security", [
    "find-certificate",
    "-c",
    identity,
    "-p",
  ]);
  const endDate = run("/usr/bin/openssl", ["x509", "-noout", "-enddate"], {
    input: certificate,
  });
  const expiresAt = Date.parse(endDate.replace(/^notAfter=/, "").trim());
  return Number.isFinite(expiresAt) ? expiresAt : 0;
}

function identityOwnerName(identity) {
  const match =
    /^(?:Apple Distribution|Apple Development): (.+) \([^)]+\)$/.exec(identity);
  if (!match?.[1])
    throw new Error("The Apple signing identity name is invalid.");
  return match[1];
}

async function findProvisioningProfile(
  bundleIdentifier,
  requestedTeam,
  signingMode,
) {
  const variableName =
    signingMode === "distribution"
      ? "LABELMAKER_MAS_PROVISIONING_PROFILE"
      : "LABELMAKER_MAS_DEVELOPMENT_PROFILE";
  const configured = process.env[variableName];
  const candidates = configured
    ? [resolve(configured)]
    : await provisioningProfileCandidates();
  const localMacIdentifiers =
    signingMode === "development" ? currentMacDeviceIdentifiers() : undefined;
  const matches = [];
  for (const candidate of candidates) {
    let profile;
    try {
      profile = decodeProvisioningProfile(candidate);
    } catch {
      continue;
    }
    const platforms = Array.isArray(profile.Platform) ? profile.Platform : [];
    const entitlements = profile.Entitlements ?? {};
    const appIdentifier =
      entitlements["com.apple.application-identifier"] ??
      entitlements["application-identifier"];
    const profileTeams = Array.isArray(profile.TeamIdentifier)
      ? profile.TeamIdentifier
      : [];
    const teamIdentifier = profileTeams[0];
    const expiresAt =
      profile.ExpirationDate instanceof Date
        ? profile.ExpirationDate.getTime()
        : Date.parse(profile.ExpirationDate ?? "");
    const certificateNames = provisioningCertificateNames(profile);
    const isDevelopment =
      Array.isArray(profile.ProvisionedDevices) &&
      profile.ProvisionedDevices.some((identifier) =>
        localMacIdentifiers?.has(identifier),
      ) &&
      certificateNames.some(
        (name) =>
          name.startsWith("Apple Development:") ||
          name.startsWith("Mac Developer:"),
      );
    const isDistribution = certificateNames.some(
      (name) =>
        name.startsWith("Apple Distribution:") ||
        name.startsWith("3rd Party Mac Developer Application:"),
    );
    if (
      platforms.some(
        (platform) => platform === "OSX" || platform === "macOS",
      ) &&
      typeof teamIdentifier === "string" &&
      appIdentifier === `${teamIdentifier}.${bundleIdentifier}` &&
      (!requestedTeam || profileTeams.includes(requestedTeam)) &&
      profile.ProvisionsAllDevices !== true &&
      (signingMode === "development"
        ? isDevelopment
        : profile.ProvisionedDevices === undefined && isDistribution) &&
      Number.isFinite(expiresAt) &&
      expiresAt > Date.now()
    ) {
      matches.push({ path: candidate, teamIdentifier });
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      `Install one Mac App Store ${signingMode} provisioning profile for ${bundleIdentifier}, or set ${variableName}.`,
    );
  }
  return matches[0];
}

function currentMacDeviceIdentifiers() {
  const report = JSON.parse(
    run("/usr/sbin/system_profiler", ["SPHardwareDataType", "-json"]),
  );
  const hardware = report.SPHardwareDataType?.[0] ?? {};
  const identifiers = [
    hardware.platform_UUID,
    hardware.provisioning_UDID,
  ].filter((value) => typeof value === "string" && value.length > 0);
  if (identifiers.length === 0) {
    throw new Error("Could not find this Mac's development device identifier.");
  }
  return new Set(identifiers);
}

function provisioningCertificateNames(profile) {
  const certificates = Array.isArray(profile.DeveloperCertificates)
    ? profile.DeveloperCertificates
    : [];
  return certificates.flatMap((certificate) => {
    const result = spawnSync(
      "/usr/bin/openssl",
      ["x509", "-inform", "DER", "-noout", "-subject", "-nameopt", "RFC2253"],
      {
        encoding: "utf8",
        input: certificate,
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    if (result.status !== 0) return [];
    const match = /(?:^|,)CN=([^,]+)/.exec(
      result.stdout.trim().replace(/^subject=/, ""),
    );
    return match?.[1] ? [match[1]] : [];
  });
}

async function provisioningProfileCandidates() {
  const directories = [
    resolve(
      homedir(),
      "Library/Developer/Xcode/UserData/Provisioning Profiles",
    ),
    resolve(homedir(), "Library/MobileDevice/Provisioning Profiles"),
  ];
  const candidates = [];
  for (const directory of directories) {
    let names;
    try {
      names = await readdir(directory);
    } catch {
      continue;
    }
    for (const name of names) {
      if (
        name.endsWith(".provisionprofile") ||
        name.endsWith(".mobileprovision")
      ) {
        candidates.push(resolve(directory, name));
      }
    }
  }
  return candidates;
}

function findInstallerIdentity(ownerName, teamIdentifier) {
  const configured = process.env.LABELMAKER_MAS_INSTALLER_IDENTITY;
  const candidates = configured
    ? [configured]
    : [
        `Mac Installer Distribution: ${ownerName} (${teamIdentifier})`,
        `3rd Party Mac Developer Installer: ${ownerName} (${teamIdentifier})`,
      ];
  const matches = candidates.filter((candidate) =>
    hasIdentity(candidate, "basic"),
  );
  if (matches.length !== 1) {
    throw new Error(
      "Install a Mac Installer Distribution certificate with its private key, or set LABELMAKER_MAS_INSTALLER_IDENTITY.",
    );
  }
  return matches[0];
}

function hasIdentity(identity, policy) {
  const result = spawnSync(
    "/usr/bin/security",
    ["find-identity", "-v", "-p", policy],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  return result.status === 0 && result.stdout.includes(`"${identity}"`);
}

function decodeProvisioningProfile(path) {
  return plist.parse(run("/usr/bin/security", ["cms", "-D", "-i", path]));
}

function readSignedEntitlements(path) {
  const result = spawnSync(
    "/usr/bin/codesign",
    ["--display", "--entitlements", ":-", path],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(
      `Could not read signed entitlements for ${path}: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return plistJson(result.stdout);
}

function plistJson(xml) {
  const result = spawnSync(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", "-"],
    { encoding: "utf8", input: xml, maxBuffer: 20 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(
      `Could not read a property list: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return JSON.parse(result.stdout);
}

function assertPlistValue(path, key, expected) {
  const actual = readPlistValue(path, key);
  if (actual !== expected) {
    throw new Error(`${key} is ${actual}; expected ${expected}.`);
  }
}

function assertMissingPlistValue(path, key) {
  const result = spawnSync("/usr/bin/plutil", ["-extract", key, "raw", path], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status === 0) {
    throw new Error(`${key} must not be in ${path}.`);
  }
}

function removePlistValue(path, key) {
  const result = spawnSync("/usr/bin/plutil", ["-remove", key, path], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0 && !result.stderr.includes("does not exist")) {
    throw new Error(`Could not remove ${key} from ${path}.`);
  }
}

function replacePlistString(path, key, value) {
  run("/usr/bin/plutil", ["-replace", key, "-string", value, path]);
}

function readPlistValue(path, key) {
  return run("/usr/bin/plutil", ["-extract", key, "raw", path]).trim();
}

function assertArchitectures(path, expected) {
  const actual = new Set(
    run("/usr/bin/lipo", ["-archs", path]).trim().split(/\s+/),
  );
  const required =
    expected === "universal"
      ? ["arm64", "x86_64"]
      : [expected === "x64" ? "x86_64" : "arm64"];
  if (required.some((item) => !actual.has(item))) {
    throw new Error(
      `${basename(path)} has ${[...actual].join(", ")}; expected ${required.join(", ")}.`,
    );
  }
}

function normalizedPackageVersion(version) {
  const parts = version.split(".");
  return [...parts, ...Array(Math.max(0, 3 - parts.length)).fill("0")].join(
    ".",
  );
}

function readMode(arguments_) {
  const supported = arguments_.filter(
    (argument) => argument === "--development" || argument === "--distribution",
  );
  if (supported.length !== 1 || supported.length !== arguments_.length) {
    throw new Error("Use exactly one of --development or --distribution.");
  }
  return supported[0] === "--distribution" ? "distribution" : "development";
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    stdio: options.stdio ?? "pipe",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `${command} failed${detail ? `: ${detail}` : ` with status ${String(result.status)}`}`,
    );
  }
  return result.stdout ?? "";
}
