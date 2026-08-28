import { _electron as electron } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const VIDEO_WIDTH = 1440;
const VIDEO_HEIGHT = 960;
const appDirectory = resolve(import.meta.dirname, "..");
const launcherPath = resolve(import.meta.dirname, "launch-desktop.mjs");
const videoDirectory = process.env.LABELMAKER_VIDEO_DIRECTORY
  ? resolve(process.env.LABELMAKER_VIDEO_DIRECTORY)
  : resolve(appDirectory, "../../artifacts/videos");
const videoPath = join(videoDirectory, "labelmaker-demo.webm");

const preparedRuntime = spawnSync(
  process.execPath,
  [launcherPath, "--prepare-only"],
  { encoding: "utf8" },
);
if (preparedRuntime.status !== 0) {
  throw new Error(
    `Could not prepare the desktop runtime: ${(preparedRuntime.stderr || preparedRuntime.stdout).trim()}`,
  );
}
const desktopExecutable = preparedRuntime.stdout.trim();
if (!desktopExecutable) {
  throw new Error("The desktop runtime did not report an executable");
}

await mkdir(videoDirectory, { recursive: true });
await rm(videoPath, { force: true });
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
    env: {
      ...process.env,
      LABELMAKER_DISABLE_HARDWARE_PRINTERS: "1",
      LABELMAKER_DISABLE_LEGACY_PRINTER_CONFIGURATION: "1",
      LABELMAKER_ENABLE_MOCK_PRINTER_DISCOVERY: "1",
      LABELMAKER_WINDOW_SIZE: `${VIDEO_WIDTH}x${VIDEO_HEIGHT}`,
    },
    recordVideo: {
      dir: recordingDirectory,
      size: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      showActions: {
        cursor: "pointer",
        duration: 500,
        fontSize: 16,
        position: "bottom-right",
      },
    },
  });

  const page = await application.firstWindow();
  video = page.video();
  if (!video) throw new Error("Playwright did not start the video recorder");

  await page.waitForSelector(".label-canvas");
  const addPrinter = page.getByRole("button", { name: "Add printer" });
  await addPrinter.waitFor();
  await pause(page, 900);

  await addPrinter.click();
  const printerRow = page.locator(".discovery-item", {
    hasText: "Studio Labeler",
  });
  await printerRow.getByRole("button", { name: "Add" }).waitFor();
  await pause(page);
  await printerRow.getByRole("button", { name: "Add" }).click();
  await page
    .getByRole("button", { name: "Selected printer: Studio Labeler" })
    .waitFor();
  await pause(page, 900);

  await page.getByRole("button", { name: "Add label" }).click();
  await page.getByRole("button", { name: "Select label 4: Plate 4" }).waitFor();
  await pause(page);

  await page.getByRole("button", { name: "Text element: NEW LABEL" }).click();
  const textEditor = page.getByRole("textbox", { name: "Edit text on label" });
  await textEditor.waitFor();
  await textEditor.press("ControlOrMeta+A");
  await textEditor.pressSequentially("LABELMAKER", { delay: 65 });
  await pause(page, 800);

  await page.getByLabel("Typeface").selectOption({ label: "Futura" });
  await pause(page);
  const fontSize = page.getByLabel("Font size");
  await fontSize.click();
  await fontSize.press("ControlOrMeta+A");
  await fontSize.pressSequentially("18", { delay: 120 });
  await fontSize.press("Enter");
  await pause(page);
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await pause(page, 800);

  const plateWidth = page.getByLabel("Plate width");
  const widthBeforeTrim = await plateWidth.inputValue();
  await page.getByRole("button", { name: "Trim plate to content" }).click();
  await page.waitForFunction((previousWidth) => {
    const input = document.querySelector('[aria-label="Plate width"]');
    return input instanceof HTMLInputElement && input.value !== previousWidth;
  }, widthBeforeTrim);
  await pause(page, 900);

  await page.getByRole("button", { name: /^Print$/ }).click();
  await page.getByText("1 label sent to Studio Labeler").waitFor();
  await pause(page, 1_500);
  completed = true;
} finally {
  await application?.close().catch(() => undefined);
  try {
    if (completed && video) {
      await video.saveAs(videoPath);
    }
  } finally {
    await Promise.all([
      rm(profileDirectory, { recursive: true, force: true }),
      rm(recordingDirectory, { recursive: true, force: true }),
    ]);
  }
}

console.log(`Demo video saved to ${videoPath}`);
