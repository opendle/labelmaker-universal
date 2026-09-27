import { sign } from "node:crypto";

import { readAppStoreConnectApiKey } from "./app-store-connect-key.mjs";

const API_ORIGIN = "https://api.appstoreconnect.apple.com";

export function nextMacAppStoreBuildNumber(options, dependencies) {
  return nextAppStoreBuildNumber(
    { ...options, platform: "MAC_OS" },
    dependencies,
  );
}

export async function nextAppStoreBuildNumber(
  { keyId, issuerId, bundleId, currentBuildNumber, platform },
  { fetchImpl = fetch, readKey = readAppStoreConnectApiKey } = {},
) {
  if (platform !== "MAC_OS" && platform !== "IOS") {
    throw new Error("The App Store platform is invalid.");
  }
  const platformName = platform === "IOS" ? "iOS" : "macOS";
  if (!Number.isSafeInteger(currentBuildNumber) || currentBuildNumber < 1) {
    throw new Error(`The local ${platformName} build number is invalid.`);
  }
  const key = readKey(keyId);
  let token;
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = encode({ alg: "ES256", kid: keyId, typ: "JWT" });
    const payload = encode({
      iss: issuerId,
      iat: now,
      exp: now + 1200,
      aud: "appstoreconnect-v1",
    });
    const input = `${header}.${payload}`;
    const signature = sign("sha256", Buffer.from(input), {
      key,
      dsaEncoding: "ieee-p1363",
    });
    token = `${input}.${signature.toString("base64url")}`;
  } finally {
    key.fill(0);
  }

  async function getPage(url) {
    if (url.origin !== API_ORIGIN || !url.pathname.startsWith("/v1/")) {
      throw new Error("App Store Connect returned an invalid page URL.");
    }
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(
        `Could not read App Store Connect build records (HTTP ${response.status}). Check API key access and try again.`,
      );
    }
    const page = await response.json();
    if (!page || !Array.isArray(page.data)) {
      throw new Error("App Store Connect returned invalid build records.");
    }
    return page;
  }

  const appsUrl = new URL("/v1/apps", API_ORIGIN);
  appsUrl.search = new URLSearchParams({
    "filter[bundleId]": bundleId,
    limit: "2",
  }).toString();
  const apps = await getPage(appsUrl);
  if (
    apps.data.length !== 1 ||
    typeof apps.data[0]?.id !== "string" ||
    !apps.data[0].id
  ) {
    throw new Error(
      "Could not find one App Store Connect app for the bundle ID.",
    );
  }

  let url = new URL("/v1/builds", API_ORIGIN);
  url.search = new URLSearchParams({
    "filter[app]": apps.data[0].id,
    "filter[preReleaseVersion.platform]": platform,
    "fields[builds]": "version",
    limit: "200",
  }).toString();
  let highest = currentBuildNumber;
  const visited = new Set();
  while (url) {
    if (visited.has(url.href)) {
      throw new Error("App Store Connect repeated a build page.");
    }
    visited.add(url.href);
    const page = await getPage(url);
    for (const build of page.data) {
      const version = build?.attributes?.version;
      if (typeof version !== "string" || !/^\d+(?:\.\d+){0,2}$/.test(version)) {
        throw new Error("App Store Connect returned an invalid build number.");
      }
      // An integer above the first component also exceeds a dotted build number.
      const number = Number(version.split(".")[0]);
      if (!Number.isSafeInteger(number)) {
        throw new Error("App Store Connect returned an invalid build number.");
      }
      highest = Math.max(highest, number);
    }
    const next = page.links?.next;
    if (next != null && typeof next !== "string") {
      throw new Error("App Store Connect returned an invalid page URL.");
    }
    url = next ? new URL(next, API_ORIGIN) : undefined;
  }
  if (!Number.isSafeInteger(highest + 1)) {
    throw new Error(`The next ${platformName} build number is too large.`);
  }
  return highest + 1;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
