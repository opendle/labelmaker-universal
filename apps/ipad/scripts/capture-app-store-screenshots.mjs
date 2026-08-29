import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import { webkit } from "playwright";

const appDirectory = resolve(import.meta.dirname, "..");
const buildDirectory = resolve(appDirectory, "Labelmaker/Resources/WebApp");
const orientation =
  process.env.LABELMAKER_APP_STORE_SCREENSHOT_ORIENTATION ?? "landscape";
if (orientation !== "landscape" && orientation !== "portrait") {
  throw new Error(
    "LABELMAKER_APP_STORE_SCREENSHOT_ORIENTATION must be landscape or portrait.",
  );
}

const viewport =
  orientation === "landscape"
    ? { width: 1376, height: 1032 }
    : { width: 1032, height: 1376 };
const expectedPixels = {
  width: viewport.width * 2,
  height: viewport.height * 2,
};
const screenshotDirectory = process.env
  .LABELMAKER_APP_STORE_SCREENSHOT_DIRECTORY
  ? resolve(process.env.LABELMAKER_APP_STORE_SCREENSHOT_DIRECTORY)
  : resolve(appDirectory, `../../artifacts/app-store/ipad-13-${orientation}`);
await mkdir(screenshotDirectory, { recursive: true });

const server = createStaticServer(buildDirectory);
await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(0, "127.0.0.1", resolveListen);
});
const address = server.address();
if (!address || typeof address === "string") {
  server.close();
  throw new Error("The screenshot server did not report a local port.");
}
const appUrl = `http://127.0.0.1:${address.port}/`;

let browser;
try {
  browser = await webkit.launch();
  await capture("01-label-editor.png");
  await capture("02-printer-settings.png", async (page) => {
    await page
      .getByRole("button", { name: "Selected printer: Workshop printer" })
      .click();
    await page
      .getByRole("button", { name: "Settings for Workshop printer" })
      .click();
    await page.getByRole("dialog", { name: "Printer settings" }).waitFor();
  });
  await capture("03-add-bluetooth-printer.png", async (page) => {
    await page
      .getByRole("button", { name: "Selected printer: Workshop printer" })
      .click();
    await page.getByRole("menuitem", { name: "Add a printer" }).click();
    await page.getByText("MakeID E1-Office").waitFor();
  });
  await capture("04-flag-label.png", async (page) => {
    await page.getByRole("button", { name: "Flag" }).click();
    await page.getByRole("button", { name: "Flag", pressed: true }).waitFor();
  });
} finally {
  await browser?.close();
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

console.log(
  `App Store screenshots saved to ${screenshotDirectory} (${expectedPixels.width}x${expectedPixels.height}).`,
);

async function capture(name, setup) {
  if (!browser) throw new Error("The screenshot browser is not available.");
  const context = await browser.newContext({
    colorScheme: "light",
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    screen: viewport,
    viewport,
  });
  await context.addInitScript(installCaptureHost);
  const page = await context.newPage();
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    const isKnownWebKitViewportWarning = text.startsWith(
      'Viewport argument key "interactive-widget" not recognized',
    );
    if (message.type() === "error" && !isKnownWebKitViewportWarning) {
      failures.push(text);
    }
  });
  try {
    await page.goto(appUrl, { waitUntil: "networkidle" });
    await page.locator(".label-canvas").waitFor();
    await page
      .getByRole("button", { name: "Text element: RESISTORS" })
      .waitFor();
    await page
      .getByRole("button", { name: "Selected printer: Workshop printer" })
      .waitFor();
    await setup?.(page);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolveFrame) =>
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
      );
    });
    await page.waitForTimeout(250);
    if (failures.length > 0) {
      throw new Error(`The iPad app reported an error: ${failures.join("; ")}`);
    }
    const path = resolve(screenshotDirectory, name);
    await page.screenshot({ path });
    await assertPngSize(path, expectedPixels.width, expectedPixels.height);
  } finally {
    await context.close();
  }
}

function installCaptureHost() {
  localStorage.setItem(
    "labelmaker.ipados.printers.v1",
    JSON.stringify({
      printerIds: ["makeid:ipad-ble-workshop"],
      activePrinterId: "makeid:ipad-ble-workshop",
      settings: {
        "makeid:ipad-ble-workshop": {
          displayName: "Workshop printer",
          darkness: 20,
          printHeadSizeMm: 12,
          marginTopMm: 2,
          marginBottomMm: 2,
        },
      },
    }),
  );
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: {
      messageHandlers: {
        labelmaker: {
          async postMessage(request) {
            switch (request?.method) {
              case "loadWorkspaceRecovery":
                return { ok: true, result: null };
              case "storeWorkspaceRecovery":
              case "clearWorkspaceAssociation":
                return { ok: true, result: null };
              case "bluetoothDiscover":
                return {
                  ok: true,
                  result: [{ id: "ipad-ble-office", name: "MakeID E1-Office" }],
                };
              default:
                return {
                  ok: false,
                  error: {
                    code: "CAPTURE_METHOD_UNAVAILABLE",
                    message: `The screenshot host does not support ${String(request?.method)}.`,
                  },
                };
            }
          },
        },
      },
    },
  });
}

function createStaticServer(rootDirectory) {
  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const relativePath =
        requestUrl.pathname === "/"
          ? "index.html"
          : decodeURIComponent(requestUrl.pathname.slice(1));
      const path = resolve(rootDirectory, relativePath);
      if (!path.startsWith(`${rootDirectory}${sep}`)) {
        response.writeHead(404).end();
        return;
      }
      if (!(await stat(path)).isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": contentType(path),
      });
      response.end(await readFile(path));
    } catch {
      response.writeHead(404).end();
    }
  });
}

function contentType(path) {
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    }[extname(path)] ?? "application/octet-stream"
  );
}

async function assertPngSize(path, width, height) {
  const png = await readFile(path);
  const actualWidth = png.readUInt32BE(16);
  const actualHeight = png.readUInt32BE(20);
  if (actualWidth !== width || actualHeight !== height) {
    throw new Error(
      `${path} is ${actualWidth}x${actualHeight}; expected ${width}x${height}.`,
    );
  }
}
