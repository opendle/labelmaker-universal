import { _electron as electron } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { prepareDesktopRuntime } from "./capture-support.mjs";

const appDirectory = resolve(import.meta.dirname, "..");
const desktopExecutable = prepareDesktopRuntime();
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
const customScreenshotDirectory = process.env.LABELMAKER_SCREENSHOT_DIRECTORY;
const screenshotDirectory = customScreenshotDirectory
  ? resolve(customScreenshotDirectory)
  : resolve(appDirectory, "../../artifacts/screenshots");
const savedScreenshotNames = new Set([
  "labelmaker-primary-1440x960.png",
  "labelmaker-phone-1100x700.png",
  "labelmaker-phone-settings-600x500.png",
  "labelmaker-dark-1440x960.png",
  "labelmaker-flag-1440x960.png",
  "labelmaker-add-printer-1440x960.png",
  "labelmaker-compact-1100x760.png",
]);
await mkdir(screenshotDirectory, { recursive: true });
if (!customScreenshotDirectory) {
  const previousScreenshots = await readdir(screenshotDirectory, {
    withFileTypes: true,
  });
  await Promise.all(
    previousScreenshots.flatMap((entry) =>
      entry.isFile() &&
      /^(?:ipad|labelmaker)-.*\.png$/.test(entry.name) &&
      !savedScreenshotNames.has(entry.name)
        ? [rm(resolve(screenshotDirectory, entry.name), { force: true })]
        : [],
    ),
  );
}

const profileDirectory = await mkdtemp(
  join(tmpdir(), "labelmaker-screenshot-"),
);
let application;
let page;

async function closeCaptureApplication(ignoreCloseError = false) {
  let closeError;
  try {
    await application?.close();
  } catch (error) {
    closeError = error;
  }
  application = undefined;
  page = undefined;
  await rm(profileDirectory, { recursive: true, force: true });
  if (closeError && !ignoreCloseError) throw closeError;
}

async function launchCaptureApplication(width, height) {
  application = await electron.launch({
    args: ["--no-sandbox", `--user-data-dir=${profileDirectory}`, appDirectory],
    env: {
      ...process.env,
      LABELMAKER_ENABLE_MOCK_PRINTER: "1",
      LABELMAKER_DISABLE_HARDWARE_PRINTERS: "1",
      LABELMAKER_DISABLE_LEGACY_PRINTER_CONFIGURATION: "1",
      LABELMAKER_SCREENSHOT_MODE: "1",
      LABELMAKER_WINDOW_SIZE: `${width}x${height}`,
    },
  });
  page = await application.firstWindow();
}

async function capture(width, height, name, setup) {
  try {
    if (!application || !page) {
      await launchCaptureApplication(width, height);
    } else {
      await application.evaluate(
        ({ BrowserWindow }, size) => {
          const window = BrowserWindow.getAllWindows()[0];
          if (!window) throw new Error("The screenshot window is missing");
          window.setSize(size.width, size.height);
        },
        { width, height },
      );
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    await page.emulateMedia({ colorScheme: "light" });

    let teardown;
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
      await page.waitForSelector(".label-canvas");
      await page.waitForFunction(() => {
        const name = document
          .querySelector(".printer-trigger-copy strong")
          ?.textContent?.trim();
        return Boolean(name && name !== "No printer");
      });
      teardown = await setup?.(page);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolveFrame) =>
          requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
        );
      });
      await page.waitForTimeout(250);
      await page.evaluate(() => {
        const label = document.querySelector(".label-canvas");
        if (!(label instanceof HTMLElement))
          throw new Error("Label is missing");
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
      if (savedScreenshotNames.has(name)) {
        await page.screenshot({ path: resolve(screenshotDirectory, name) });
      }
    } finally {
      if (typeof teardown === "function")
        await teardown().catch(() => undefined);
    }
  } catch (error) {
    await closeCaptureApplication(true);
    throw error;
  }
}

async function setHiddenNumberControl(page, label, value) {
  await page.getByLabel(label).evaluate((input, nextValue) => {
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`${input} is not a number input`);
    }
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setValue) throw new Error("Input value setter is missing");
    setValue.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

await capture(1440, 960, "labelmaker-primary-1440x960.png", async (page) => {
  const iconCatalogLoaded = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .some((entry) => entry.name.includes("lucide-icon-catalog")),
  );
  if (iconCatalogLoaded) {
    throw new Error("The icon catalog loaded during application launch");
  }
  const headerHeights = await page.evaluate(() => {
    const selectors = [
      ".printer-trigger",
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

  if ((await page.getByLabel("Label name").count()) !== 0) {
    throw new Error("The label name input is still in the editor toolbar");
  }
  await page.getByRole("button", { name: /^Rename label 1:/ }).dblclick();
  const labelNameWidth = await page
    .getByLabel("Label name")
    .evaluate((input) => input.getBoundingClientRect().width);
  if (labelNameWidth < 100) {
    throw new Error(
      `Plate strip label name input is too narrow: ${labelNameWidth}`,
    );
  }
  await page.getByLabel("Label name").press("Escape");

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
await capture(600, 500, "labelmaker-phone-600x500.png", async (page) => {
  const phoneLayout = await page.locator(".app-shell").getAttribute("class");
  if (!phoneLayout?.includes("layout-phone-short")) {
    throw new Error(
      `The 600x500 window did not use Phone mode: ${phoneLayout}`,
    );
  }
  await page.locator(".phone-plate-strip").waitFor();
  const undersizedTargets = await page
    .locator(
      ".phone-titlebar button, .phone-editor-toolbar button, .phone-plate-strip .plate-thumb-select, .phone-plate-strip .add-plate",
    )
    .evaluateAll((targets) =>
      targets.flatMap((target) => {
        const bounds = target.getBoundingClientRect();
        return bounds.width < 44 || bounds.height < 44
          ? [
              {
                label: target.getAttribute("aria-label") ?? target.textContent,
                width: bounds.width,
                height: bounds.height,
              },
            ]
          : [];
      }),
    );
  if (undersizedTargets.length > 0) {
    throw new Error(
      `Phone controls are smaller than 44 px: ${JSON.stringify(undersizedTargets)}`,
    );
  }
});
await capture(1100, 700, "labelmaker-phone-1100x700.png", async (page) => {
  const shellClass = await page.locator(".app-shell").getAttribute("class");
  if (!shellClass?.includes("layout-phone")) {
    throw new Error(
      `The 1100x700 window did not use Phone mode: ${shellClass}`,
    );
  }
  const visibleHeaderText = await page
    .locator(".phone-titlebar")
    .evaluate((header) =>
      Array.from(
        header.querySelectorAll(
          ".printer-trigger-copy, .printer-add-trigger strong, .print-label",
        ),
      ).flatMap((label) =>
        label.getBoundingClientRect().width > 0
          ? [label.textContent?.trim() ?? ""]
          : [],
      ),
    );
  if (visibleHeaderText.some(Boolean)) {
    throw new Error(
      `The Phone header contains visible button text: ${JSON.stringify(visibleHeaderText)}`,
    );
  }
});
await capture(
  600,
  500,
  "labelmaker-phone-settings-600x500.png",
  async (page) => {
    await page.getByRole("button", { name: "Label settings" }).click();
    await page
      .getByRole("dialog", { name: "Label settings" })
      .getByRole("button", { name: "Save settings" })
      .waitFor();
    const sheetGeometry = await page
      .getByRole("dialog", { name: "Label settings" })
      .evaluate((dialog) => {
        const bounds = dialog.getBoundingClientRect();
        const style = getComputedStyle(dialog);
        return {
          bottomLeft: style.borderBottomLeftRadius,
          bottomRight: style.borderBottomRightRadius,
          top: bounds.top,
        };
      });
    if (
      sheetGeometry.top > 12 ||
      sheetGeometry.bottomLeft === "0px" ||
      sheetGeometry.bottomRight === "0px"
    ) {
      throw new Error(
        `The Phone settings sheet is not top-aligned and rounded: ${JSON.stringify(sheetGeometry)}`,
      );
    }
  },
);
await capture(1101, 700, "labelmaker-standard-1101x700.png", async (page) => {
  const shellClass = await page.locator(".app-shell").getAttribute("class");
  if (!shellClass?.includes("layout-standard")) {
    throw new Error(
      `The 1101x700 window did not use standard mode: ${shellClass}`,
    );
  }
  const clipped = await page.evaluate(() => {
    const titlebar = document
      .querySelector(".titlebar")
      ?.getBoundingClientRect();
    const titleActions = document
      .querySelector(".title-actions")
      ?.getBoundingClientRect();
    const toolbar = document
      .querySelector(".editor-toolbar")
      ?.getBoundingClientRect();
    const trim = document
      .querySelector(".toolbar-trim-button")
      ?.getBoundingClientRect();
    return {
      header: Boolean(
        titlebar &&
        titleActions &&
        (titleActions.left < titlebar.left ||
          titleActions.right > titlebar.right),
      ),
      toolbar: Boolean(
        toolbar &&
        trim &&
        (trim.left < toolbar.left || trim.right > toolbar.right),
      ),
    };
  });
  if (clipped.header || clipped.toolbar) {
    throw new Error(
      `The narrow standard layout clips controls: ${JSON.stringify(clipped)}`,
    );
  }
});
await capture(
  1440,
  960,
  "labelmaker-plate-reorder-1440x960.png",
  async (page) => {
    const source = await page.locator(".plate-thumb").first().boundingBox();
    const destination = await page.locator(".plate-thumb").nth(2).boundingBox();
    if (!source || !destination) {
      throw new Error("Plate reorder targets are missing");
    }
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      destination.x + destination.width * 0.75,
      destination.y + destination.height / 2,
    );
    await page.waitForFunction(() => {
      const names = Array.from(
        document.querySelectorAll(".plate-thumb .thumb-name"),
        (name) => name.textContent?.trim(),
      );
      return (
        names.join(",") === "Capacitors,Connectors,Resistors" &&
        document.querySelector(".plate-thumb.dragging .thumb-name")
          ?.textContent === "Resistors"
      );
    });
    return async () => page.mouse.up();
  },
);
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
await capture(1440, 960, "labelmaker-icons-1440x960.png", async (page) => {
  await page.getByRole("button", { name: "Icons" }).click();
  const dialog = page.getByRole("dialog", { name: "Icon library" });
  await dialog.waitFor();
  const search = page.getByRole("searchbox", { name: "Search icons" });
  if (!(await search.evaluate((input) => input === document.activeElement))) {
    throw new Error("Icon search did not receive focus");
  }
  await search.fill("accessibility");
  await dialog
    .getByRole("list", { name: "Icons" })
    .getByRole("button")
    .first()
    .waitFor();
  await search.press("Enter");
  await dialog.waitFor({ state: "detached" });
  await page.getByLabel("Image brightness").waitFor();
  await page.getByLabel("Image contrast").waitFor();

  await page.getByRole("button", { name: "Icons" }).click();
  await dialog.waitFor();
  if (!(await search.evaluate((input) => input === document.activeElement))) {
    throw new Error("Icon search did not receive focus when reopened");
  }
  await search.fill("star");
  const firstIcon = dialog
    .getByRole("list", { name: "Icons" })
    .getByRole("button")
    .first();
  await firstIcon.waitFor();
  if ((await firstIcon.getAttribute("aria-pressed")) !== "true") {
    throw new Error("The first filtered icon is not selected");
  }
  await search.press("ArrowDown");
  if (!(await firstIcon.evaluate((icon) => icon === document.activeElement))) {
    throw new Error("Arrow Down did not move focus to the icon list");
  }
  const rowColumns = await dialog
    .getByRole("list", { name: "Icons" })
    .getByRole("button")
    .evaluateAll((icons) => {
      const firstTop = icons[0]?.getBoundingClientRect().top;
      return firstTop === undefined
        ? 0
        : icons.findIndex(
            (icon) => icon.getBoundingClientRect().top > firstTop + 1,
          );
    });
  await page.keyboard.press("ArrowDown");
  const focusedIndex = await dialog
    .getByRole("list", { name: "Icons" })
    .getByRole("button")
    .evaluateAll((icons) => icons.indexOf(document.activeElement));
  if (rowColumns <= 0 || focusedIndex !== rowColumns) {
    throw new Error(
      `Arrow Down did not move to the next icon row: ${focusedIndex} / ${rowColumns}`,
    );
  }
  await page.keyboard.press("ArrowUp");
  if (!(await firstIcon.evaluate((icon) => icon === document.activeElement))) {
    throw new Error("Arrow Up did not move to the previous icon row");
  }
  if ((await dialog.getByRole("button", { name: "Cancel" }).count()) > 0) {
    throw new Error("The icon library has a Cancel action");
  }
});
await capture(1440, 960, "labelmaker-icons-dark-1440x960.png", async (page) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "Icons" }).click();
  const dialog = page.getByRole("dialog", { name: "Icon library" });
  await dialog.waitFor();
  const search = page.getByRole("searchbox", { name: "Search icons" });
  await search.fill("star");
  await dialog
    .getByRole("list", { name: "Icons" })
    .getByRole("button")
    .first()
    .waitFor();
  await search.press("ArrowDown");
  if (
    !(await dialog
      .getByRole("list", { name: "Icons" })
      .getByRole("button")
      .first()
      .evaluate((icon) => icon === document.activeElement))
  ) {
    throw new Error("Dark icon library keyboard focus is missing");
  }
});
await capture(
  1440,
  960,
  "labelmaker-icon-inserted-1440x960.png",
  async (page) => {
    await page.getByRole("button", { name: "Icons" }).click();
    const search = page.getByRole("searchbox", { name: "Search icons" });
    await search.fill("accessibility");
    await page
      .getByRole("list", { name: "Icons" })
      .getByRole("button")
      .first()
      .waitFor();
    await search.press("Enter");
    await page.getByLabel("Image brightness").waitFor();
    await page.getByLabel("Image contrast").waitFor();
  },
);
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
  await setHiddenNumberControl(page, "Text frame width", "120");
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
  await page.getByLabel("Image brightness").waitFor();
  await page.getByLabel("Image contrast").waitFor();
});
await capture(1101, 760, "labelmaker-image-1101x760.png", async (page) => {
  await page.getByLabel("Choose image").setInputFiles({
    name: "storage-bin.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "Image element" }).waitFor();
  await page.getByLabel("Image brightness").waitFor();
  await page.getByLabel("Image contrast").waitFor();
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
    await setHiddenNumberControl(page, "Image width", "80");
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
await closeCaptureApplication();

console.log(`Screenshots saved to ${screenshotDirectory} in one app session`);
