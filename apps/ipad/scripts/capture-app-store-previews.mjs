import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { webkit } from "playwright";

import { installCaptureInputFeedback } from "../../../scripts/capture-input-feedback.mjs";
import { encodeAppPreview } from "../../../scripts/encode-app-preview.mjs";
import {
  installCaptureHost,
  settlePage,
  startStaticServer,
  watchPageFailures,
} from "./screenshot-support.mjs";

const appDirectory = resolve(import.meta.dirname, "..");
const buildDirectory = resolve(appDirectory, "Labelmaker/Resources/WebApp");
const previewDirectory = process.env.LABELMAKER_APP_STORE_PREVIEW_DIRECTORY
  ? resolve(process.env.LABELMAKER_APP_STORE_PREVIEW_DIRECTORY)
  : resolve(appDirectory, "../../artifacts/app-store/previews");
const recordingDirectory = await mkdtemp(
  join(tmpdir(), "labelmaker-mobile-preview-"),
);
const server = await startStaticServer(buildDirectory);

const previews = [
  {
    name: "iphone-6.5-portrait",
    viewport: { width: 428, height: 926 },
    video: { width: 886, height: 1920 },
    addPrinter: true,
  },
  {
    name: "ipad-13-landscape",
    viewport: { width: 1376, height: 1032 },
    video: { width: 1600, height: 1200 },
    addPrinter: false,
  },
];

await rm(resolve(previewDirectory, "ipad-13-portrait"), {
  recursive: true,
  force: true,
});

let browser;
try {
  browser = await webkit.launch();
  for (const preview of previews) {
    await capturePreview(preview);
  }
} finally {
  await browser?.close();
  await server.close();
  await rm(recordingDirectory, { recursive: true, force: true });
}

async function capturePreview(preview) {
  if (!browser) throw new Error("The preview browser is not available.");
  const rawDirectory = join(recordingDirectory, preview.name);
  await mkdir(rawDirectory, { recursive: true });
  const context = await browser.newContext({
    colorScheme: "light",
    hasTouch: true,
    isMobile: true,
    recordVideo: { dir: rawDirectory, size: preview.viewport },
    screen: preview.viewport,
    viewport: preview.viewport,
  });
  await context.addInitScript(installCaptureHost, {
    includeBluetoothPrinter: preview.addPrinter,
    startWithConfiguredPrinter: !preview.addPrinter,
  });
  const page = await context.newPage();
  const failures = watchPageFailures(page);
  let video;
  let completed = false;
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
    await installCaptureInputFeedback(page, "touch");
    video = page.video();
    if (!video) throw new Error("Playwright did not start the video recorder.");
    await demonstrateEditor(page, preview.addPrinter);
    await settlePage(page);
    if (failures.length > 0) {
      throw new Error(
        `The mobile app reported an error: ${failures.join("; ")}`,
      );
    }
    completed = true;
  } finally {
    await context.close();
  }

  if (!completed || !video) return;
  const rawPath = join(recordingDirectory, `${preview.name}.webm`);
  await video.saveAs(rawPath);
  const outputPath = resolve(
    previewDirectory,
    preview.name,
    "labelmaker-preview.mp4",
  );
  await encodeAppPreview({
    sourcePath: rawPath,
    outputPath,
    ...preview.video,
  });
  console.log(
    `${preview.name} App Store preview saved to ${outputPath} (${preview.video.width}x${preview.video.height}).`,
  );
}

async function demonstrateEditor(page, addPrinter) {
  const pause = (milliseconds = 900) => page.waitForTimeout(milliseconds);
  await pause(1_500);

  if (addPrinter) {
    await page.getByRole("button", { name: "Add printer" }).tap();
    const printerRow = page.locator(".discovery-item", {
      hasText: "MakeID E1-Office",
    });
    await printerRow.getByRole("button", { name: "Add" }).waitFor();
    await pause();
    await printerRow.getByRole("button", { name: "Add" }).tap();
    await page
      .getByRole("button", { name: "Selected printer: MakeID E1-Office" })
      .waitFor();
    await pause();
  }

  await page.getByRole("button", { name: "Add label" }).tap();
  await page.getByRole("button", { name: "Select label 4: Label 4" }).waitFor();
  await pause();

  const newLabelText = page.getByRole("button", {
    name: "Text element: NEW LABEL",
  });
  await newLabelText.tap();
  // WebKit sends the click after the touch pointer sequence. Playwright's tap
  // stops before that click when the canvas prevents pointer-down defaults.
  await newLabelText.dispatchEvent("click");
  const textEditor = page.getByRole("textbox", { name: "Edit text on label" });
  await textEditor.waitFor();
  await textEditor.press("ControlOrMeta+A");
  await textEditor.pressSequentially("LABELMAKER", { delay: 90 });
  await pause();

  const fontSize = page.getByLabel("Font size");
  await fontSize.fill("22");
  await fontSize.press("Enter");
  await pause();
  await page
    .getByRole("button", { name: /Trim (label|plate) to content/ })
    .tap();
  await pause();

  await page.getByRole("button", { name: "Print", exact: true }).tap();
  await page
    .getByText(
      `1 label sent to ${addPrinter ? "MakeID E1-Office" : "Workshop printer"}`,
    )
    .waitFor();
  await pause(1_800);
}
