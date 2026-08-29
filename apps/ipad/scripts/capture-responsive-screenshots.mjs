import { createServer } from "node:http";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import { webkit } from "playwright";

const appDirectory = resolve(import.meta.dirname, "..");
const buildDirectory = resolve(appDirectory, "Labelmaker/Resources/WebApp");
const screenshotDirectory = process.env
  .LABELMAKER_RESPONSIVE_SCREENSHOT_DIRECTORY
  ? resolve(process.env.LABELMAKER_RESPONSIVE_SCREENSHOT_DIRECTORY)
  : resolve(appDirectory, "../../artifacts/responsive");
const viewports = [
  { width: 393, height: 852, save: true },
  { width: 852, height: 393, save: true },
  { width: 375, height: 667, save: false },
  { width: 667, height: 375, save: false },
  { width: 600, height: 800, save: false },
  { width: 430, height: 800, save: false },
  { width: 320, height: 667, save: false },
];

await mkdir(screenshotDirectory, { recursive: true });
await Promise.all(
  viewports.flatMap((viewport) =>
    viewport.save
      ? []
      : [
          rm(resolve(screenshotDirectory, screenshotName(viewport)), {
            force: true,
          }),
        ],
  ),
);
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
  for (const viewport of viewports) {
    await capture(viewport);
  }
} finally {
  await browser?.close();
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

console.log(`Responsive screenshots saved to ${screenshotDirectory}.`);

async function capture(viewport) {
  if (!browser) throw new Error("The screenshot browser is not available.");
  const context = await browser.newContext({
    colorScheme: "light",
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    screen: { width: viewport.width, height: viewport.height },
    viewport: { width: viewport.width, height: viewport.height },
  });
  await context.addInitScript(installCaptureHost);
  const page = await context.newPage();
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    const messageText = message.text();
    const knownViewportWarning = messageText.startsWith(
      'Viewport argument key "interactive-widget" not recognized',
    );
    if (message.type() === "error" && !knownViewportWarning) {
      failures.push(messageText);
    }
  });
  try {
    await page.goto(appUrl, { waitUntil: "networkidle" });
    await page.locator(".label-canvas").waitFor();
    await page
      .getByRole("button", { name: "Selected printer: Workshop printer" })
      .waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolveFrame) =>
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
      );
    });

    const inspection = await page.evaluate(() => {
      const shell = document.querySelector(".app-shell");
      const strip = document.querySelector(".phone-plate-strip");
      const header = document.querySelector(".phone-titlebar");
      const surface = document.querySelector(".work-surface");
      const canvas = document.querySelector(".label-canvas");
      if (
        !(shell instanceof HTMLElement) ||
        !(strip instanceof HTMLElement) ||
        !(header instanceof HTMLElement) ||
        !(surface instanceof HTMLElement) ||
        !(canvas instanceof HTMLElement)
      ) {
        throw new Error("The responsive editor is incomplete.");
      }
      const client = document.documentElement;
      const surfaceBounds = surface.getBoundingClientRect();
      const canvasBounds = canvas.getBoundingClientRect();
      const headerBounds = header.getBoundingClientRect();
      const visibleHeaderButtons = Array.from(
        header.querySelectorAll("button"),
      ).filter((target) => target.getBoundingClientRect().width > 0);
      const headerActions = header.querySelector(".phone-header-actions");
      const phoneCommandButtons = Array.from(
        document.querySelectorAll(".phone-command-scroll button"),
      );
      const undersizedTargets = Array.from(
        document.querySelectorAll(
          ".phone-titlebar button, .phone-editor-toolbar button, .phone-plate-strip .plate-thumb-select, .phone-plate-strip .add-plate",
        ),
      ).flatMap((target) => {
        const bounds = target.getBoundingClientRect();
        if (bounds.width === 0 || bounds.height === 0) return [];
        return bounds.width < 44 || bounds.height < 44
          ? [
              {
                label: target.getAttribute("aria-label") ?? target.textContent,
                width: bounds.width,
                height: bounds.height,
              },
            ]
          : [];
      });
      return {
        canvasFits:
          canvasBounds.left >= surfaceBounds.left - 1 &&
          canvasBounds.right <= surfaceBounds.right + 1 &&
          canvasBounds.top >= surfaceBounds.top - 1 &&
          canvasBounds.bottom <= surfaceBounds.bottom + 1,
        className: shell.className,
        compactPrinterStatusVisible:
          document
            .querySelector(".printer-compact-status")
            ?.getBoundingClientRect().width === 7,
        directSaveVisible:
          document.querySelector(".phone-save-action")?.getBoundingClientRect()
            .width === 44,
        headerActionsScroll:
          headerActions instanceof HTMLElement &&
          headerActions.scrollWidth > headerActions.clientWidth,
        headerControlsFit: visibleHeaderButtons.every((target) => {
          const bounds = target.getBoundingClientRect();
          return (
            bounds.left >= headerBounds.left - 0.5 &&
            bounds.right <= headerBounds.right + 0.5
          );
        }),
        phoneCommandsHaveVisibleText: phoneCommandButtons.some((target) =>
          target.textContent?.trim(),
        ),
        quickRowVisible:
          document
            .querySelector(".phone-quick-command-row")
            ?.getBoundingClientRect().height === 48,
        overflow:
          client.scrollWidth > client.clientWidth ||
          client.scrollHeight > client.clientHeight,
        stripHeight: strip.getBoundingClientRect().height,
        undersizedTargets,
      };
    });
    const expectedLayout = viewport.height <= 500 ? "phone-short" : "phone";
    if (!inspection.className.includes(`layout-${expectedLayout}`)) {
      throw new Error(
        `${viewport.width}x${viewport.height} used the wrong layout: ${inspection.className}`,
      );
    }
    if (inspection.overflow) {
      throw new Error(`${viewport.width}x${viewport.height} overflows.`);
    }
    if (
      viewport.width >= 375 &&
      (!inspection.headerControlsFit || inspection.headerActionsScroll)
    ) {
      throw new Error(
        `${viewport.width}x${viewport.height} does not fit the icon header.`,
      );
    }
    if (!inspection.directSaveVisible) {
      throw new Error(`${viewport.width}x${viewport.height} hides Save.`);
    }
    if (!inspection.compactPrinterStatusVisible) {
      throw new Error(
        `${viewport.width}x${viewport.height} hides the printer status.`,
      );
    }
    if (!inspection.canvasFits) {
      throw new Error(
        `${viewport.width}x${viewport.height} does not fit the label canvas.`,
      );
    }
    if (inspection.phoneCommandsHaveVisibleText) {
      throw new Error(
        `${viewport.width}x${viewport.height} shows text in the Phone command row.`,
      );
    }
    if (!inspection.quickRowVisible) {
      throw new Error(
        `${viewport.width}x${viewport.height} does not show the selected-element row.`,
      );
    }
    const expectedStripHeight = expectedLayout === "phone-short" ? 54 : 68;
    if (Math.abs(inspection.stripHeight - expectedStripHeight) > 0.5) {
      throw new Error(
        `${viewport.width}x${viewport.height} has a ${inspection.stripHeight} px label strip.`,
      );
    }
    if (inspection.undersizedTargets.length > 0) {
      throw new Error(
        `${viewport.width}x${viewport.height} has controls smaller than 44 px: ${JSON.stringify(inspection.undersizedTargets)}`,
      );
    }
    if (failures.length > 0) {
      throw new Error(
        `The Phone app reported an error: ${failures.join("; ")}`,
      );
    }
    if (viewport.save) {
      await page.screenshot({
        path: resolve(screenshotDirectory, screenshotName(viewport)),
      });
    }
    if (viewport.width === 393 && viewport.height === 852) {
      await page.getByRole("button", { name: "Icons" }).click();
      const iconSearch = page.getByRole("searchbox", { name: "Search icons" });
      await iconSearch.waitFor();
      if (
        !(await iconSearch.evaluate(
          (input) => input === document.activeElement,
        ))
      ) {
        throw new Error("The Phone icon search does not receive focus.");
      }
      await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: "Icon library" }).waitFor({
        state: "hidden",
      });
      await page.locator(".canvas-element-control").first().dblclick();
      await page.getByRole("textbox", { name: "Edit text on label" }).waitFor();
      const phoneChromeVisible = await page.evaluate(() => {
        const shell = document.querySelector(".app-shell");
        if (!(shell instanceof HTMLElement)) return false;
        shell.dataset.softwareKeyboard = "open";
        const header = document.querySelector(".phone-titlebar");
        const toolbar = document.querySelector(".phone-editor-toolbar");
        return [header, toolbar].every(
          (element) =>
            element instanceof HTMLElement &&
            element.getBoundingClientRect().height > 0 &&
            getComputedStyle(element).display !== "none",
        );
      });
      if (!phoneChromeVisible) {
        throw new Error("The Phone keyboard state hides the editor chrome.");
      }
    }
  } finally {
    await context.close();
  }
}

function screenshotName(viewport) {
  return `labelmaker-phone-${viewport.width}x${viewport.height}.png`;
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
