import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { readReleaseVersion } from "../../../scripts/release-version.mjs";

const appPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(
      import.meta.dirname,
      "../../../release/macos-app-store/development/Label Maker-mas-universal/Label Maker.app",
    );
const infoPath = resolve(appPath, "Contents/Info.plist");
const releaseVersion = await readReleaseVersion();
const expectedVersion = releaseVersion.productVersion;
const bundleIdentifier = readPlistValue(infoPath, "CFBundleIdentifier");
const executableName = readPlistValue(infoPath, "CFBundleExecutable");
if (!/^[A-Za-z0-9.-]+$/.test(bundleIdentifier)) {
  throw new Error("The packaged app bundle identifier is invalid.");
}
if (
  readPlistValue(infoPath, "CFBundleShortVersionString") !== expectedVersion ||
  readPlistValue(infoPath, "CFBundleVersion") !==
    String(releaseVersion.buildNumbers.macos)
) {
  throw new Error(
    "The packaged app version does not match the release version.",
  );
}
const executablePath = resolve(appPath, "Contents/MacOS", executableName);
await access(executablePath);

const containerTempDirectory = resolve(
  homedir(),
  "Library/Containers",
  bundleIdentifier,
  "Data/tmp",
);
await mkdir(containerTempDirectory, { recursive: true });
const profileDirectory = await mkdtemp(
  join(containerTempDirectory, "label-maker-mas-smoke-"),
);
const inheritedEnvironment = Object.fromEntries(
  ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR"].flatMap((name) => {
    const value = process.env[name];
    return value === undefined ? [] : [[name, value]];
  }),
);
let browser;
try {
  browser = await chromium.launch({
    args: [`--user-data-dir=${profileDirectory}`, "--remote-debugging-pipe"],
    ignoreDefaultArgs: true,
    env: {
      ...inheritedEnvironment,
      LABELMAKER_DISABLE_HARDWARE_PRINTERS: "1",
      LABELMAKER_DISABLE_LEGACY_PRINTER_CONFIGURATION: "1",
      LABELMAKER_ENABLE_MOCK_PRINTER: "1",
    },
    executablePath,
    timeout: 30_000,
  });
  const connection = await browser.newBrowserCDPSession();
  const target = await waitFor(async () => {
    const { targetInfos } = await connection.send("Target.getTargets");
    return targetInfos.find(
      (target) =>
        target.type === "page" &&
        target.url.endsWith("/app.asar/dist/renderer/index.html"),
    );
  });
  const { sessionId } = await connection.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: false,
  });
  const renderer = rendererConnection(connection, sessionId);
  const failures = [];
  renderer.onEvent((event) => {
    if (event.method === "Runtime.exceptionThrown") {
      failures.push(
        event.params.exceptionDetails.exception?.description ??
          event.params.exceptionDetails.text,
      );
    }
    if (
      event.method === "Log.entryAdded" &&
      event.params.entry.level === "error"
    ) {
      failures.push(event.params.entry.text);
    }
    if (
      event.method === "Runtime.consoleAPICalled" &&
      event.params.type === "error"
    ) {
      failures.push(
        event.params.args.map((arg) => arg.value ?? arg.description).join(" "),
      );
    }
  });
  await renderer.send("Runtime.enable");
  await renderer.send("Log.enable");
  const evaluate = async (expression) => {
    const response = await renderer.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text,
      );
    }
    return response.result.value;
  };
  await waitFor(() =>
    evaluate(
      '!!document.querySelector(".label-canvas") && !!document.querySelector(\'[aria-label="Selected printer: Studio Labeler"]\')',
    ),
  );
  const boundary = await evaluate(`({
    hasHost: typeof window.labelmakerHost === "object",
    hasNodeProcess: "process" in window,
    userAgent: navigator.userAgent,
  })`);
  if (
    !boundary.hasHost ||
    boundary.hasNodeProcess ||
    !boundary.userAgent.includes(`Labelmaker/${expectedVersion} `) ||
    !boundary.userAgent.includes("Electron/")
  ) {
    throw new Error(
      `The packaged renderer boundary is invalid: ${JSON.stringify(boundary)}.`,
    );
  }
  await evaluate(
    "document.querySelector('[aria-label=\"Add label\"]').click()",
  );
  await waitFor(() =>
    evaluate(
      "!!document.querySelector('[aria-label=\"Select label 4: Label 4\"]')",
    ),
  );
  await waitFor(async () => {
    try {
      const recovery = JSON.parse(
        await readFile(
          resolve(profileDirectory, "workspace-recovery.json"),
          "utf8",
        ),
      );
      return recovery.document?.plates?.length === 4;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  });
  if (failures.length > 0) {
    throw new Error(
      `The packaged app reported an error: ${failures.join("; ")}`,
    );
  }
  console.log(`Mac App Store smoke test passed for ${appPath}`);
} finally {
  await browser?.close().catch(() => undefined);
  await rm(profileDirectory, { recursive: true, force: true });
}

function rendererConnection(connection, sessionId) {
  let nextId = 0;
  let eventHandler = () => {};
  const pending = new Map();
  connection.on("Target.receivedMessageFromTarget", (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    } else if (message.method) {
      eventHandler(message);
    }
  });
  return {
    onEvent: (handler) => {
      eventHandler = handler;
    },
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Renderer command timed out: ${method}.`));
        }, 10_000);
        pending.set(id, { resolve, reject, timer });
        connection
          .send("Target.sendMessageToTarget", {
            sessionId,
            message: JSON.stringify({ id, method, params }),
          })
          .catch((error) => {
            pending.delete(id);
            clearTimeout(timer);
            reject(error);
          });
      }),
  };
}

async function waitFor(check) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error("The packaged app did not complete the launch test.");
}

function readPlistValue(path, key) {
  const result = spawnSync("/usr/bin/plutil", ["-extract", key, "raw", path], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `Could not read ${key} from ${path}: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.trim();
}
