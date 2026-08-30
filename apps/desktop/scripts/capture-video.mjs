import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  clickWithVisibleMouse,
  installCaptureInputFeedback,
} from "../../../scripts/capture-input-feedback.mjs";
import { encodeAppPreview } from "../../../scripts/encode-app-preview.mjs";
import { prepareDesktopRuntime } from "./capture-support.mjs";

const WINDOW_WIDTH = 1440;
const WINDOW_HEIGHT = 810;
const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;
const appDirectory = resolve(import.meta.dirname, "..");
const videoDirectory = process.env.LABELMAKER_VIDEO_DIRECTORY
  ? resolve(process.env.LABELMAKER_VIDEO_DIRECTORY)
  : resolve(appDirectory, "../../artifacts/videos");
const videoPath = join(videoDirectory, "labelmaker-demo.webm");
const previewPath = resolve(
  appDirectory,
  "../../artifacts/app-store/previews/macos/labelmaker-preview.mp4",
);

const desktopExecutable = prepareDesktopRuntime();

await mkdir(videoDirectory, { recursive: true });
await rm(videoPath, { force: true });
await rm(previewPath, { force: true });
const profileDirectory = await mkdtemp(
  join(tmpdir(), "labelmaker-video-profile-"),
);
const recordingDirectory = await mkdtemp(
  join(tmpdir(), "labelmaker-video-recording-"),
);

let application;
let video;
let completed = false;

const pause = (page, milliseconds = 650) => page.waitForTimeout(milliseconds);

try {
  application = await electron.launch({
    args: ["--no-sandbox", `--user-data-dir=${profileDirectory}`, appDirectory],
    executablePath: desktopExecutable,
    env: {
      ...process.env,
      LABELMAKER_DISABLE_HARDWARE_PRINTERS: "1",
      LABELMAKER_DISABLE_LEGACY_PRINTER_CONFIGURATION: "1",
      LABELMAKER_ENABLE_MOCK_PRINTER_DISCOVERY: "1",
      LABELMAKER_WINDOW_SIZE: `${WINDOW_WIDTH}x${WINDOW_HEIGHT}`,
    },
    recordVideo: {
      dir: recordingDirectory,
      size: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
    },
  });

  const page = await application.firstWindow();
  video = page.video();
  if (!video) throw new Error("Playwright did not start the video recorder");

  await page.waitForSelector(".label-canvas");
  await installCaptureInputFeedback(page, "mouse");
  const addPrinter = page.getByRole("button", { name: "Add printer" });
  await addPrinter.waitFor();
  await pause(page, 900);

  await clickWithVisibleMouse(page, addPrinter);
  const printerRow = page.locator(".discovery-item", {
    hasText: "Studio Labeler",
  });
  await printerRow.getByRole("button", { name: "Add" }).waitFor();
  await pause(page);
  await clickWithVisibleMouse(
    page,
    printerRow.getByRole("button", { name: "Add" }),
  );
  await page
    .getByRole("button", { name: "Selected printer: Studio Labeler" })
    .waitFor();
  await pause(page, 900);

  await clickWithVisibleMouse(
    page,
    page.getByRole("button", { name: "Add label" }),
  );
  await page.getByRole("button", { name: "Select label 4: Label 4" }).waitFor();
  await pause(page);

  await clickWithVisibleMouse(
    page,
    page.getByRole("button", { name: "Text element: NEW LABEL" }),
  );
  const textEditor = page.getByRole("textbox", { name: "Edit text on label" });
  await textEditor.waitFor();
  await textEditor.press("ControlOrMeta+A");
  await textEditor.pressSequentially("LABELMAKER", { delay: 65 });
  await pause(page, 800);

  const fontSize = page.getByLabel("Font size");
  await clickWithVisibleMouse(page, fontSize);
  await fontSize.press("ControlOrMeta+A");
  await fontSize.pressSequentially("22", { delay: 120 });
  await fontSize.press("Enter");
  await pause(page);
  await clickWithVisibleMouse(
    page,
    page.getByRole("button", { name: "Bold", exact: true }),
  );
  await pause(page, 800);

  await page.waitForFunction(() => {
    const label = document.querySelector(".label-canvas");
    return label instanceof HTMLElement && label.dataset.plateWidthMm !== "62";
  });
  await pause(page, 900);

  await clickWithVisibleMouse(
    page,
    page.getByRole("button", { name: /^Print$/ }),
  );
  await page.getByText("1 label sent to Studio Labeler").waitFor();
  await pause(page, 1_500);
  completed = true;
} finally {
  await application?.close().catch(() => undefined);
  try {
    if (completed && video) {
      await video.saveAs(videoPath);
      await encodeAppPreview({
        sourcePath: videoPath,
        outputPath: previewPath,
        width: VIDEO_WIDTH,
        height: VIDEO_HEIGHT,
      });
    }
  } finally {
    await Promise.all([
      rm(profileDirectory, { recursive: true, force: true }),
      rm(recordingDirectory, { recursive: true, force: true }),
    ]);
  }
}

console.log(`Demo video saved to ${videoPath}`);
console.log(`Mac App Store preview saved to ${previewPath}`);
