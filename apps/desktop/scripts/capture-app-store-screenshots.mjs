import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { prepareDesktopRuntime } from "./capture-support.mjs";

const appDirectory = resolve(import.meta.dirname, "..");
const desktopExecutable = prepareDesktopRuntime();
const screenshotDirectory = process.env
  .LABELMAKER_APP_STORE_SCREENSHOT_DIRECTORY
  ? resolve(process.env.LABELMAKER_APP_STORE_SCREENSHOT_DIRECTORY)
  : resolve(appDirectory, "../../artifacts/app-store/macos");
await mkdir(screenshotDirectory, { recursive: true });
for (const name of [
  "01-label-editor.png",
  "02-icon-library.png",
  "03-add-bluetooth-printer.png",
  "03-printer-settings.png",
  "04-add-bluetooth-printer.png",
  "04-printer-settings.png",
  "05-flag-label.png",
]) {
  await rm(resolve(screenshotDirectory, name), { force: true });
}

const profileDirectory = await mkdtemp(join(tmpdir(), "labelmaker-store-"));
let application;
try {
  application = await electron.launch({
    args: ["--no-sandbox", `--user-data-dir=${profileDirectory}`, appDirectory],
    executablePath: desktopExecutable,
    env: {
      ...process.env,
      LABELMAKER_DISABLE_HARDWARE_PRINTERS: "1",
      LABELMAKER_DISABLE_LEGACY_PRINTER_CONFIGURATION: "1",
      LABELMAKER_ENABLE_MOCK_PRINTER: "1",
      LABELMAKER_ENABLE_MOCK_PRINTER_DISCOVERY: "1",
      LABELMAKER_SCREENSHOT_MODE: "1",
      LABELMAKER_WINDOW_SIZE: "1440x900",
    },
  });
  const page = await application.firstWindow();
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });

  await capture(page, "01-label-editor.png");
  await capture(page, "02-icon-library.png", async () => {
    await page.getByRole("button", { name: "Icons" }).click();
    await page.getByRole("dialog", { name: "Icon library" }).waitFor();
  });
  await capture(page, "03-add-bluetooth-printer.png", async () => {
    await page
      .getByRole("button", { name: "Selected printer: Studio Labeler" })
      .click();
    await page.getByRole("menuitem", { name: "Add a printer" }).click();
    await page.getByRole("dialog", { name: "Add a printer" }).waitFor();
    await page.getByText("Workshop Printer").waitFor();
  });
  await capture(page, "04-printer-settings.png", async () => {
    await page
      .getByRole("button", { name: "Selected printer: Studio Labeler" })
      .click();
    await page
      .getByRole("button", { name: "Settings for Studio Labeler" })
      .click();
    await page.getByRole("dialog", { name: "Printer settings" }).waitFor();
  });
  await capture(
    page,
    "05-flag-label.png",
    async () => {
      await page.getByRole("button", { name: "Flag" }).click();
      await page.getByRole("button", { name: "Flag", pressed: true }).waitFor();
    },
    "dark",
  );

  if (failures.length > 0) {
    throw new Error(
      `The desktop app reported an error: ${failures.join("; ")}`,
    );
  }
} finally {
  await application?.close().catch(() => undefined);
  await rm(profileDirectory, { recursive: true, force: true });
}

console.log(`Mac App Store screenshots saved to ${screenshotDirectory}.`);

async function capture(page, name, setup, colorScheme = "light") {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.emulateMedia({ colorScheme });
  await page.locator(".label-canvas").waitFor();
  await page
    .getByRole("button", { name: "Selected printer: Studio Labeler" })
    .waitFor();
  await setup?.();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
    );
  });
  await page.waitForTimeout(250);
  const path = resolve(screenshotDirectory, name);
  await page.screenshot({ path });
  await assertAcceptedMacSize(path);
}

async function assertAcceptedMacSize(path) {
  const png = await readFile(path);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const accepted = new Set(["1440x900", "2880x1800"]);
  if (!accepted.has(`${String(width)}x${String(height)}`)) {
    throw new Error(
      `${path} is ${String(width)}x${String(height)}; expected 1440x900 or 2880x1800.`,
    );
  }
}
