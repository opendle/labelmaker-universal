import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { webkit } from "playwright";

import {
  installCaptureHost,
  settlePage,
  startStaticServer,
  watchPageFailures,
} from "./screenshot-support.mjs";

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

const server = await startStaticServer(buildDirectory);

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
  await server.close();
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
  await context.addInitScript(installCaptureHost, true);
  const page = await context.newPage();
  const failures = watchPageFailures(page);
  try {
    await page.goto(server.url, { waitUntil: "networkidle" });
    await page.locator(".label-canvas").waitFor();
    await page
      .getByRole("button", { name: "Text element: RESISTORS" })
      .waitFor();
    await page
      .getByRole("button", { name: "Selected printer: Workshop printer" })
      .waitFor();
    await setup?.(page);
    await settlePage(page);
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
