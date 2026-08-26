import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const appDirectory = resolve(import.meta.dirname, "..");
const screenshotDirectory = process.env.LABELMAKER_SCREENSHOT_DIRECTORY
  ? resolve(process.env.LABELMAKER_SCREENSHOT_DIRECTORY)
  : resolve(appDirectory, "../../artifacts/screenshots");
await mkdir(screenshotDirectory, { recursive: true });

async function capture(width, height, name, setup) {
  const profileDirectory = await mkdtemp(
    join(tmpdir(), "labelmaker-screenshot-"),
  );
  const application = await electron.launch({
    args: ["--no-sandbox", `--user-data-dir=${profileDirectory}`, appDirectory],
    env: {
      ...process.env,
      LABELMAKER_ENABLE_MOCK_PRINTER: "1",
      LABELMAKER_WINDOW_SIZE: `${width}x${height}`,
    },
  });
  try {
    const applicationName = await application.evaluate(({ app }) =>
      app.getName(),
    );
    if (applicationName !== "Labelmaker Universal") {
      throw new Error(`Unexpected application name: ${applicationName}`);
    }
    const page = await application.firstWindow();
    await page.waitForSelector(".label-canvas");
    await page.waitForFunction(() => {
      const name = document
        .querySelector(".printer-trigger-copy strong")
        ?.textContent?.trim();
      return Boolean(name && name !== "No printer");
    });
    await setup?.(page);
    await page.evaluate(() => {
      const label = document.querySelector(".label-canvas");
      if (!(label instanceof HTMLElement)) throw new Error("Label is missing");
      const declaredWidth = Number.parseFloat(label.style.width);
      const renderedWidth = label.getBoundingClientRect().width;
      if (Math.abs(declaredWidth - renderedWidth) > 0.05) {
        throw new Error(
          `Label scale changed after layout: ${declaredWidth} != ${renderedWidth}`,
        );
      }
    });
    const layout = await page.evaluate(() => ({
      clientHeight: document.documentElement.clientHeight,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    if (
      layout.scrollWidth > layout.clientWidth ||
      layout.scrollHeight > layout.clientHeight
    ) {
      throw new Error(
        `Desktop layout overflows its viewport: ${JSON.stringify(layout)}`,
      );
    }
    await page.screenshot({ path: resolve(screenshotDirectory, name) });
  } finally {
    await application.close();
    await rm(profileDirectory, { recursive: true, force: true });
  }
}

await capture(1440, 960, "labelmaker-primary-1440x960.png");
await capture(
  1440,
  960,
  "labelmaker-plate-settings-1440x960.png",
  async (page) => {
    await page.getByLabel("Plate width").focus();
  },
);
await capture(1440, 960, "labelmaker-flag-1440x960.png", async (page) => {
  await page.getByRole("button", { name: "Flag" }).click();
});
await capture(1440, 960, "labelmaker-trim-1440x960.png", async (page) => {
  await page.getByRole("button", { name: "Trim plate to content" }).click();
  await page.evaluate(() => {
    const label = document.querySelector(".label-canvas");
    const frame = document.querySelector(".canvas-element");
    const text = document.querySelector(
      ".canvas-element-control .inline-text-editor",
    );
    if (
      !(label instanceof HTMLElement) ||
      !(frame instanceof HTMLElement) ||
      !(text instanceof HTMLElement)
    ) {
      throw new Error("Trim geometry is missing");
    }
    const context = document.createElement("canvas").getContext("2d");
    if (!context) throw new Error("Text measurement is not available");
    const style = getComputedStyle(text);
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const metrics = context.measureText(text.textContent ?? "");
    const labelBounds = label.getBoundingClientRect();
    const frameBounds = frame.getBoundingClientRect();
    const originX = frameBounds.left + (frameBounds.width - metrics.width) / 2;
    const leftError =
      originX - metrics.actualBoundingBoxLeft - labelBounds.left;
    const rightError =
      originX + metrics.actualBoundingBoxRight - labelBounds.right;
    if (Math.abs(leftError) > 0.05 || Math.abs(rightError) > 0.05) {
      throw new Error(
        `Trim does not match printed ink: ${leftError}, ${rightError}`,
      );
    }
  });
});
await capture(1440, 960, "labelmaker-image-1440x960.png", async (page) => {
  await page.getByLabel("Choose image").setInputFiles({
    name: "storage-bin.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><rect x="8" y="20" width="104" height="52" rx="8" fill="#111"/><path d="M24 20V10h72v10M38 36v22M60 36v22M82 36v22" fill="none" stroke="white" stroke-width="6" stroke-linecap="round"/></svg>',
    ),
  });
  await page.getByRole("button", { name: "Image element" }).waitFor();
});
await capture(
  1440,
  960,
  "labelmaker-add-printer-1440x960.png",
  async (page) => {
    await page.getByRole("button", { name: "Add printer" }).click();
    await page.getByText("Workshop Printer").waitFor();
  },
);
await capture(1100, 760, "labelmaker-compact-1100x760.png");

console.log(`Screenshots saved to ${screenshotDirectory}`);
