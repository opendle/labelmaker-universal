import { _electron as electron } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const appDirectory = resolve(import.meta.dirname, "..");
const screenshotDirectory = resolve(
  appDirectory,
  "../../artifacts/screenshots",
);
await mkdir(screenshotDirectory, { recursive: true });

async function capture(width, height, name, setup) {
  const application = await electron.launch({
    args: ["--no-sandbox", appDirectory],
    env: { ...process.env, LABELMAKER_WINDOW_SIZE: `${width}x${height}` },
  });
  try {
    const page = await application.firstWindow();
    await page.waitForSelector(".label-canvas");
    await setup?.(page);
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
  }
}

await capture(1440, 960, "labelmaker-primary-1440x960.png");
await capture(
  1440,
  960,
  "labelmaker-plate-settings-1440x960.png",
  async (page) => {
    await page.getByRole("button", { name: "Plate settings" }).click();
  },
);
await capture(1440, 960, "labelmaker-flag-1440x960.png", async (page) => {
  await page.getByRole("button", { name: "Flag" }).click();
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
