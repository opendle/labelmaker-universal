import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { webkit } from "playwright";

import { captureOpaquePng } from "../../../scripts/capture-opaque-png.mjs";
import {
  installCaptureHost,
  settlePage,
  startStaticServer,
  watchPageFailures,
} from "./screenshot-support.mjs";

const appDirectory = resolve(import.meta.dirname, "..");
const buildDirectory = resolve(appDirectory, "Labelmaker/Resources/WebApp");
const device = process.env.LABELMAKER_APP_STORE_SCREENSHOT_DEVICE ?? "ipad";
if (device !== "ipad" && device !== "iphone") {
  throw new Error(
    "LABELMAKER_APP_STORE_SCREENSHOT_DEVICE must be ipad or iphone.",
  );
}
const orientation =
  process.env.LABELMAKER_APP_STORE_SCREENSHOT_ORIENTATION ??
  (device === "iphone" ? "portrait" : "landscape");
if (orientation !== "landscape" && orientation !== "portrait") {
  throw new Error(
    "LABELMAKER_APP_STORE_SCREENSHOT_ORIENTATION must be landscape or portrait.",
  );
}

const deviceScaleFactor = device === "iphone" ? 3 : 2;
const baseViewport =
  device === "iphone"
    ? { width: 428, height: 926 }
    : { width: 1376, height: 1032 };
const viewport =
  orientation === "landscape"
    ? {
        width: Math.max(baseViewport.width, baseViewport.height),
        height: Math.min(baseViewport.width, baseViewport.height),
      }
    : {
        width: Math.min(baseViewport.width, baseViewport.height),
        height: Math.max(baseViewport.width, baseViewport.height),
      };
const expectedPixels = {
  width: viewport.width * deviceScaleFactor,
  height: viewport.height * deviceScaleFactor,
};
const screenshotDirectory = process.env
  .LABELMAKER_APP_STORE_SCREENSHOT_DIRECTORY
  ? resolve(process.env.LABELMAKER_APP_STORE_SCREENSHOT_DIRECTORY)
  : resolve(
      appDirectory,
      `../../artifacts/app-store/${device === "iphone" ? "iphone-6.5" : "ipad-13"}-${orientation}`,
    );
await mkdir(screenshotDirectory, { recursive: true });
for (const name of [
  "01-label-editor.png",
  "02-icon-library.png",
  "02-print-preview.png",
  "02-printer-settings.png",
  "03-add-bluetooth-printer.png",
  "03-printer-settings.png",
  "04-add-bluetooth-printer.png",
  "04-flag-label.png",
  "05-flag-label.png",
]) {
  await rm(resolve(screenshotDirectory, name), { force: true });
}

const server = await startStaticServer(buildDirectory);

let browser;
try {
  browser = await webkit.launch();
  await capture("01-label-editor.png");
  await capture("02-icon-library.png", async (page) => {
    await page.getByRole("button", { name: "Icons" }).click();
    await page.getByRole("dialog", { name: "Icon library" }).waitFor();
  });
  await capture("03-add-bluetooth-printer.png", async (page) => {
    await page
      .getByRole("button", { name: "Selected printer: Workshop printer" })
      .click();
    await page.getByRole("menuitem", { name: "Add a printer" }).click();
    await page.getByText("MakeID E1-Office").waitFor();
  });
  await capture("04-printer-settings.png", async (page) => {
    await page
      .getByRole("button", { name: "Selected printer: Workshop printer" })
      .click();
    await page
      .getByRole("button", { name: "Settings for Workshop printer" })
      .click();
    await page.getByRole("dialog", { name: "Printer settings" }).waitFor();
  });
  await capture(
    "05-flag-label.png",
    async (page) => {
      if (device === "iphone") {
        await page.getByRole("button", { name: "Label settings" }).click();
        const settings = page.getByRole("dialog", { name: "Label settings" });
        await settings.getByRole("button", { name: "Flag" }).click();
        await settings.getByRole("button", { name: "Save settings" }).click();
        await page
          .getByRole("button", { name: "Rename label 1: Flag Resistors" })
          .waitFor();
      } else {
        await page.getByRole("button", { name: "Flag" }).click();
        await page
          .getByRole("button", { name: "Flag", pressed: true })
          .waitFor();
      }
    },
    "dark",
  );
} finally {
  await browser?.close();
  await server.close();
}

console.log(
  `App Store screenshots saved to ${screenshotDirectory} (${expectedPixels.width}x${expectedPixels.height}).`,
);

async function capture(name, setup, colorScheme = "light") {
  if (!browser) throw new Error("The screenshot browser is not available.");
  const showPortraitTextProperties =
    device === "ipad" &&
    orientation === "portrait" &&
    name === "01-label-editor.png";
  const context = await browser.newContext({
    colorScheme,
    deviceScaleFactor,
    hasTouch: true,
    isMobile: true,
    screen: viewport,
    viewport,
  });
  await context.addInitScript(installCaptureHost, true);
  const page = await context.newPage();
  const failures = watchPageFailures(page);
  try {
    await page.goto(server.url, { waitUntil: "networkidle" });
    await page.addStyleTag({
      content: `
        input[type="number"] {
          appearance: textfield !important;
          -moz-appearance: textfield !important;
        }
        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button {
          -webkit-appearance: none !important;
          margin: 0 !important;
        }
      `,
    });
    await page.locator(".label-canvas").waitFor();
    await page
      .getByRole("button", { name: "Text element: RESISTORS" })
      .waitFor();
    await page
      .getByRole("button", { name: "Selected printer: Workshop printer" })
      .waitFor();
    if (showPortraitTextProperties) {
      await selectTextAndWaitForProperties(page);
      await assertPortraitTextLayout(page);
    }
    await setup?.(page);
    await settlePage(page);
    await page.waitForTimeout(250);
    if (failures.length > 0) {
      throw new Error(`The iPad app reported an error: ${failures.join("; ")}`);
    }
    const path = resolve(screenshotDirectory, name);
    const size = await captureOpaquePng(page, path);
    assertPngSize(path, size, expectedPixels.width, expectedPixels.height);
  } finally {
    await context.close();
  }
}

async function selectTextAndWaitForProperties(page) {
  await page.getByRole("button", { name: "Text element: RESISTORS" }).click();
  await page.locator(".inspector:not(.is-hidden)").waitFor();
  await page.getByLabel("Font size").waitFor();
}

async function assertPortraitTextLayout(page) {
  const toolbar = await page.locator(".editor-toolbar").boundingBox();
  const inspector = await page.locator(".inspector").boundingBox();
  const label = await page.locator(".label-canvas").boundingBox();
  if (!toolbar || !inspector || !label) {
    throw new Error(
      "The portrait label, toolbar, or inspector is not visible.",
    );
  }
  if (
    Math.abs(inspector.x) > 1 ||
    Math.abs(inspector.width - viewport.width) > 1 ||
    Math.abs(inspector.y - (toolbar.y + toolbar.height)) > 1
  ) {
    throw new Error(
      "The portrait text inspector is not full-width at the top.",
    );
  }
  if (label.y < inspector.y + inspector.height + 16) {
    throw new Error("The portrait text inspector overlaps the label.");
  }
}

function assertPngSize(path, size, width, height) {
  if (size.width !== width || size.height !== height) {
    throw new Error(
      `${path} is ${size.width}x${size.height}; expected ${width}x${height}.`,
    );
  }
}
