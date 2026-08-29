import { _electron as electron } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const appDirectory = resolve(import.meta.dirname, "..");
const launcherPath = resolve(import.meta.dirname, "launch-desktop.mjs");
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
if (
  process.platform === "darwin" &&
  basename(desktopExecutable) !== "Labelmaker"
) {
  throw new Error(`Unexpected macOS executable: ${desktopExecutable}`);
}
if (process.platform === "darwin") {
  const bundle = resolve(dirname(desktopExecutable), "../..");
  const plist = join(bundle, "Contents", "Info.plist");
  for (const [key, expected] of [
    ["CFBundleDisplayName", "Labelmaker"],
    ["CFBundleExecutable", "Labelmaker"],
    ["CFBundleIconFile", "Labelmaker.icns"],
    ["CFBundleIconName", "Labelmaker"],
    ["CFBundleIdentifier", "io.labelmaker.universal.dev"],
    [
      "NSBluetoothAlwaysUsageDescription",
      "Labelmaker uses Bluetooth to find and print labels on nearby printers.",
    ],
  ]) {
    const value = spawnSync(
      "/usr/bin/plutil",
      ["-extract", key, "raw", plist],
      { encoding: "utf8" },
    );
    if (value.status !== 0 || value.stdout.trim() !== expected) {
      throw new Error(
        `Unexpected ${key}: ${(value.stderr || value.stdout).trim()}`,
      );
    }
  }
}
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
      LABELMAKER_DISABLE_HARDWARE_PRINTERS: "1",
      LABELMAKER_DISABLE_LEGACY_PRINTER_CONFIGURATION: "1",
      LABELMAKER_WINDOW_SIZE: `${width}x${height}`,
    },
  });
  try {
    const applicationIdentity = await application.evaluate(({ app }) => ({
      applicationName: app.getName(),
      processTitle: process.title,
    }));
    if (
      applicationIdentity.applicationName !== "Labelmaker" ||
      applicationIdentity.processTitle !== "Labelmaker"
    ) {
      throw new Error(
        `Unexpected application identity: ${JSON.stringify(applicationIdentity)}`,
      );
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
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolveFrame) =>
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
      );
    });
    await page.waitForTimeout(250);
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

await capture(1440, 960, "labelmaker-primary-1440x960.png", async (page) => {
  const headerHeights = await page.evaluate(() => {
    const selectors = [
      ".printer-trigger",
      ".title-actions > .button.secondary",
      ".print-control > .button:first-child",
      ".print-control > .button.split",
    ];
    return selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Header control is missing: ${selector}`);
      }
      return element.getBoundingClientRect().height;
    });
  });
  if (headerHeights.some((height) => height !== headerHeights[0])) {
    throw new Error(
      `Header controls have different heights: ${headerHeights.join(", ")}`,
    );
  }

  const labelNameWidth = await page
    .getByLabel("Label name")
    .evaluate((input) => input.getBoundingClientRect().width);
  if (labelNameWidth < 160) {
    throw new Error(`Label name input is too narrow: ${labelNameWidth}`);
  }

  const before = await page.locator(".label-canvas").boundingBox();
  await page
    .locator(".canvas-clear-selection")
    .evaluate((button) => button.click());
  await page.waitForFunction(() =>
    document.querySelector(".inspector")?.classList.contains("is-hidden"),
  );
  const hiddenInspectorDisplay = await page
    .locator(".inspector")
    .evaluate((inspector) => getComputedStyle(inspector).display);
  if (hiddenInspectorDisplay !== "none") {
    throw new Error(
      `Hidden inspector still uses layout space: ${hiddenInspectorDisplay}`,
    );
  }
  const workSurface = await page.locator(".work-surface").boundingBox();
  const desktopBody = await page.locator(".desktop-body").boundingBox();
  if (
    !workSurface ||
    !desktopBody ||
    Math.abs(workSurface.width - desktopBody.width) > 0.05
  ) {
    throw new Error(
      `Work surface does not use the full editor width: ${JSON.stringify({ workSurface, desktopBody })}`,
    );
  }
  const after = await page.locator(".label-canvas").boundingBox();
  if (
    !before ||
    !after ||
    ["x", "y", "width", "height"].some(
      (key) => Math.abs(before[key] - after[key]) > 0.05,
    )
  ) {
    throw new Error(
      `Canvas moved with the inspector: ${JSON.stringify({ before, after })}`,
    );
  }
  await page.locator(".canvas-element-control").first().click();
});
await capture(1440, 960, "labelmaker-dark-1440x960.png", async (page) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => {
    if (!window.matchMedia("(prefers-color-scheme: dark)").matches) {
      throw new Error("Dark color scheme is not active");
    }
    const shell = document.querySelector(".app-shell");
    const label = document.querySelector(".label-canvas");
    const thumbnail = document.querySelector(".mini-label");
    const labelText = document.querySelector(
      ".canvas-text .canvas-element-control",
    );
    if (
      !(shell instanceof HTMLElement) ||
      !(label instanceof HTMLElement) ||
      !(thumbnail instanceof HTMLElement) ||
      !(labelText instanceof HTMLElement)
    ) {
      throw new Error("Dark theme targets are missing");
    }
    if (getComputedStyle(shell).backgroundColor !== "rgb(28, 29, 31)") {
      throw new Error("Application chrome did not use the dark theme");
    }
    for (const paper of [label, thumbnail]) {
      if (getComputedStyle(paper).backgroundColor !== "rgb(255, 254, 250)") {
        throw new Error("Label paper did not stay white in the dark theme");
      }
    }
    if (
      labelText.textContent?.trim() !== "RESISTORS" ||
      getComputedStyle(labelText).color !== "rgb(36, 34, 30)"
    ) {
      throw new Error(
        `Label text lost print colors in the dark theme: ${labelText.textContent} / ${getComputedStyle(labelText).color}`,
      );
    }
  });
});
await capture(
  1440,
  960,
  "labelmaker-printer-settings-1440x960.png",
  async (page) => {
    await page
      .getByRole("button", { name: "Selected printer: Studio Labeler" })
      .click();
    await page
      .getByRole("button", { name: "Settings for Studio Labeler" })
      .click();
    await page.getByRole("dialog", { name: "Printer settings" }).waitFor();
  },
);
await capture(
  1440,
  960,
  "labelmaker-printer-settings-dark-1440x960.png",
  async (page) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page
      .getByRole("button", { name: "Selected printer: Studio Labeler" })
      .click();
    await page
      .getByRole("button", { name: "Settings for Studio Labeler" })
      .click();
    await page.getByRole("dialog", { name: "Printer settings" }).waitFor();
  },
);
await capture(
  1440,
  960,
  "labelmaker-text-editing-1440x960.png",
  async (page) => {
    const displayed = await page.evaluate(() => {
      const frame = document.querySelector(".canvas-element");
      const text = frame?.querySelector(".inline-text-editor");
      if (!(frame instanceof HTMLElement) || !(text instanceof HTMLElement)) {
        throw new Error("Text geometry is missing");
      }
      const frameBounds = frame.getBoundingClientRect();
      const textBounds = text.getBoundingClientRect();
      const style = getComputedStyle(text);
      return {
        frame: {
          left: frameBounds.left,
          top: frameBounds.top,
          width: frameBounds.width,
          height: frameBounds.height,
        },
        text: {
          top: textBounds.top,
          height: textBounds.height,
        },
        font: {
          family: style.fontFamily,
          size: style.fontSize,
          weight: style.fontWeight,
          style: style.fontStyle,
          lineHeight: style.lineHeight,
        },
      };
    });
    await page.getByRole("button", { name: "Text element: RESISTORS" }).click();
    await page
      .getByRole("textbox", { name: "Edit text on label" })
      .evaluate((editor, before) => {
        if (!(editor instanceof HTMLTextAreaElement)) {
          throw new Error("Text editor is missing");
        }
        const frame = editor.closest(".canvas-element");
        if (!(frame instanceof HTMLElement)) {
          throw new Error("Text frame is missing");
        }
        const frameBounds = frame.getBoundingClientRect();
        const editorBounds = editor.getBoundingClientRect();
        const style = getComputedStyle(editor);
        for (const key of ["left", "top", "width", "height"]) {
          if (Math.abs(frameBounds[key] - before.frame[key]) > 0.1) {
            throw new Error(`Text frame moved during editing: ${key}`);
          }
        }
        if (
          Math.abs(editorBounds.top - before.text.top) > 0.1 ||
          Math.abs(editorBounds.height - before.text.height) > 0.1
        ) {
          throw new Error(
            `Text moved during editing: ${JSON.stringify({ before: before.text, editing: { top: editorBounds.top, height: editorBounds.height } })}`,
          );
        }
        const font = {
          family: style.fontFamily,
          size: style.fontSize,
          weight: style.fontWeight,
          style: style.fontStyle,
          lineHeight: style.lineHeight,
        };
        if (JSON.stringify(font) !== JSON.stringify(before.font)) {
          throw new Error(
            `Text style changed during editing: ${JSON.stringify({ before: before.font, editing: font })}`,
          );
        }
        if (style.outlineStyle !== "none" && style.outlineWidth !== "0px") {
          throw new Error(`Text editor has an outline: ${style.outline}`);
        }
      }, displayed);
  },
);
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
    const plateWidth = Number.parseFloat(
      document.querySelector('[aria-label="Plate width"]')?.value ?? "NaN",
    );
    // Trim uses an 8 px/mm monochrome raster. The DOM glyph bounds can differ
    // by one raster pixel on each side.
    if (
      !Number.isInteger(plateWidth) ||
      leftError < -1.6 ||
      rightError > 1.6 ||
      Math.abs(leftError + rightError) > 0.2
    ) {
      throw new Error(
        `Trim rounding is invalid: ${plateWidth}, ${leftError}, ${rightError}`,
      );
    }
  });
});
await capture(1440, 960, "labelmaker-trim-grow-1440x960.png", async (page) => {
  await page.getByLabel("Text frame width").fill("120");
  await page.getByRole("button", { name: "Text element: RESISTORS" }).click();
  await page
    .getByRole("textbox", { name: "Edit text on label" })
    .fill("RESISTORS RESISTORS RESISTORS");
  await page.getByRole("button", { name: "Trim plate to content" }).click();
  await page.waitForFunction(() => {
    const input = document.querySelector('[aria-label="Plate width"]');
    return input instanceof HTMLInputElement && Number(input.value) > 62;
  });
  await page
    .locator(".canvas-clear-selection")
    .evaluate((button) => button.click());
});
await capture(1440, 960, "labelmaker-image-1440x960.png", async (page) => {
  await page.getByLabel("Choose image").setInputFiles({
    name: "storage-bin.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "Image element" }).waitFor();
});
await capture(
  1440,
  960,
  "labelmaker-image-trim-grow-1440x960.png",
  async (page) => {
    await page.keyboard.press("Delete");
    await page.getByLabel("Choose image").setInputFiles({
      name: "storage-bin.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await page.getByLabel("Image fit").selectOption("stretch");
    await page.getByLabel("Image width").fill("80");
    await page.getByRole("button", { name: "Trim plate to content" }).click();
    await page.waitForFunction(() => {
      const input = document.querySelector('[aria-label="Plate width"]');
      return input instanceof HTMLInputElement && Number(input.value) > 62;
    });
  },
);
await capture(1440, 960, "labelmaker-shape-menu-1440x960.png", async (page) => {
  await page.getByRole("button", { name: "Shapes" }).click();
  await page.getByRole("menu", { name: "Add shape" }).waitFor();
});
await capture(1440, 960, "labelmaker-shape-1440x960.png", async (page) => {
  await page.getByRole("button", { name: "Shapes" }).click();
  await page.getByRole("menuitem", { name: "Rectangle" }).click();
  await page.getByRole("button", { name: "rectangle shape element" }).waitFor();
});
await capture(
  1440,
  960,
  "labelmaker-shape-menu-dark-1440x960.png",
  async (page) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.getByRole("button", { name: "Shapes" }).click();
    await page.getByRole("menu", { name: "Add shape" }).waitFor();
  },
);
await capture(
  1440,
  960,
  "labelmaker-add-printer-1440x960.png",
  async (page) => {
    await page
      .getByRole("button", { name: "Selected printer: Studio Labeler" })
      .click();
    await page.getByRole("menuitem", { name: "Add a printer" }).click();
    await page.getByText("Workshop Printer").waitFor();
  },
);
await capture(1100, 760, "labelmaker-compact-1100x760.png");

console.log(`Screenshots saved to ${screenshotDirectory}`);
