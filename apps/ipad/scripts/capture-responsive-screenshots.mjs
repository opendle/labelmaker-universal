import { mkdir, rm } from "node:fs/promises";
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
const screenshotDirectory = process.env
  .LABELMAKER_RESPONSIVE_SCREENSHOT_DIRECTORY
  ? resolve(process.env.LABELMAKER_RESPONSIVE_SCREENSHOT_DIRECTORY)
  : resolve(appDirectory, "../../artifacts/responsive");
const viewports = [
  { width: 1180, height: 820, save: true },
  { width: 1032, height: 1376, save: false },
  { width: 768, height: 1024, save: true },
  { width: 744, height: 1024, save: true },
  { width: 393, height: 852, save: true },
  { width: 852, height: 393, save: true },
  { width: 375, height: 667, save: false },
  { width: 667, height: 375, save: false },
  { width: 600, height: 800, save: false },
  { width: 430, height: 800, save: false },
  { width: 320, height: 667, save: false },
];

await mkdir(screenshotDirectory, { recursive: true });
await Promise.all(
  viewports.flatMap((viewport) =>
    viewport.save
      ? []
      : [
          rm(resolve(screenshotDirectory, screenshotName(viewport)), {
            force: true,
          }),
        ],
  ),
);
const server = await startStaticServer(buildDirectory);

let browser;
try {
  browser = await webkit.launch();
  for (const viewport of viewports) {
    await capture(viewport);
  }
} finally {
  await browser?.close();
  await server.close();
}

console.log(`Responsive screenshots saved to ${screenshotDirectory}.`);

async function capture(viewport) {
  if (!browser) throw new Error("The screenshot browser is not available.");
  const context = await browser.newContext({
    colorScheme: "light",
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
    screen: { width: viewport.width, height: viewport.height },
    viewport: { width: viewport.width, height: viewport.height },
  });
  await context.addInitScript(installCaptureHost, false);
  const page = await context.newPage();
  const failures = watchPageFailures(page);
  try {
    await page.goto(server.url, { waitUntil: "networkidle" });
    await page.locator(".label-canvas").waitFor();
    await page
      .getByRole("button", { name: "Selected printer: Workshop printer" })
      .waitFor();
    await settlePage(page);

    const expectedLayout =
      viewport.width > 600 &&
      !(viewport.height <= 500 && viewport.width <= 1_000)
        ? "standard"
        : viewport.height <= 500
          ? "phone-short"
          : "phone";
    if (expectedLayout === "standard") {
      if (viewport.height > viewport.width) {
        await page
          .getByRole("button", { name: "Text element: RESISTORS" })
          .click();
        await page.locator(".inspector:not(.is-hidden)").waitFor();
      }
      const inspection = await inspectStandardIPad(page);
      if (!inspection.className.includes("layout-standard")) {
        throw new Error(
          `${viewport.width}x${viewport.height} used the wrong layout: ${inspection.className}`,
        );
      }
      if (inspection.overflow) {
        throw new Error(`${viewport.width}x${viewport.height} overflows.`);
      }
      if (!inspection.headerControlsFit) {
        throw new Error(
          `${viewport.width}x${viewport.height} cuts off header controls.`,
        );
      }
      if (viewport.width === 1180 && viewport.height === 820) {
        const keyboardMotion = await page.evaluate(() => {
          const shell = document.querySelector(".app-shell");
          const content = document.querySelector(".application-content");
          if (
            !(shell instanceof HTMLElement) ||
            !(content instanceof HTMLElement)
          ) {
            throw new Error("The iPad keyboard layout is incomplete.");
          }
          return {
            contentDuration: getComputedStyle(content).transitionDuration,
            contentProperty: getComputedStyle(content).transitionProperty,
            shellDuration: getComputedStyle(shell).transitionDuration,
            shellProperty: getComputedStyle(shell).transitionProperty,
          };
        });
        if (
          !keyboardMotion.shellProperty.includes("height") ||
          !keyboardMotion.shellProperty.includes("transform") ||
          keyboardMotion.shellDuration === "0s" ||
          !keyboardMotion.contentProperty.includes("grid-template-rows") ||
          keyboardMotion.contentDuration === "0s"
        ) {
          throw new Error(
            `The iPad keyboard layout does not animate: ${JSON.stringify(keyboardMotion)}.`,
          );
        }
      }
      if (viewport.height > viewport.width) {
        if (!inspection.inspectorFits) {
          throw new Error(
            `${viewport.width}x${viewport.height} lets the portrait inspector overflow.`,
          );
        }
        if (!inspection.inspectorHeightFollowsContent) {
          throw new Error(
            `${viewport.width}x${viewport.height} does not show the full portrait inspector content.`,
          );
        }
        if (!inspection.inspectorIsBelowEditorToolbar) {
          throw new Error(
            `${viewport.width}x${viewport.height} does not place the inspector below the editor toolbar.`,
          );
        }
        if (!inspection.inspectorIsFullWidth) {
          throw new Error(
            `${viewport.width}x${viewport.height} does not make the portrait inspector full-width.`,
          );
        }
      }
      if (viewport.width <= 850) {
        if (!inspection.historyIsCentered) {
          throw new Error(
            `${viewport.width}x${viewport.height} does not center undo and redo: ${JSON.stringify(inspection)}.`,
          );
        }
        if (!inspection.historyIsVerticallyAligned) {
          throw new Error(
            `${viewport.width}x${viewport.height} changes the undo and redo vertical alignment.`,
          );
        }
        if (!inspection.outputIsRightAligned) {
          throw new Error(
            `${viewport.width}x${viewport.height} does not right-align printer controls.`,
          );
        }
        if (!inspection.editorActionsAreIconOnly) {
          throw new Error(
            `${viewport.width}x${viewport.height} shows editor action labels.`,
          );
        }
        if (!inspection.editorToolbarFits) {
          throw new Error(
            `${viewport.width}x${viewport.height} scrolls the compact editor toolbar.`,
          );
        }
      }
      if (viewport.width === 768 && viewport.height === 1024) {
        await page.locator(".canvas-element-control").first().dblclick();
        await page
          .getByRole("textbox", { name: "Edit text on label" })
          .waitFor();
        const keyboardEditLayout = await page.evaluate(async () => {
          const shell = document.querySelector(".app-shell");
          const content = document.querySelector(".application-content");
          const body = document.querySelector(".desktop-body");
          if (
            !(shell instanceof HTMLElement) ||
            !(content instanceof HTMLElement) ||
            !(body instanceof HTMLElement)
          ) {
            throw new Error("The compact iPad editor is incomplete.");
          }
          document.documentElement.style.setProperty(
            "--visual-viewport-height",
            "600px",
          );
          shell.dataset.softwareKeyboard = "open";
          await new Promise((resolveFrame) =>
            requestAnimationFrame(resolveFrame),
          );
          return {
            bodyRow: getComputedStyle(body).gridRowStart,
            contentRows: getComputedStyle(content).gridTemplateRows,
          };
        });
        if (keyboardEditLayout.bodyRow !== "2") {
          throw new Error(
            `The compact iPad keyboard edit moves outside its animated row: ${JSON.stringify(keyboardEditLayout)}.`,
          );
        }
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
          const shell = document.querySelector(".app-shell");
          if (shell instanceof HTMLElement) {
            delete shell.dataset.softwareKeyboard;
          }
          document.documentElement.style.removeProperty(
            "--visual-viewport-height",
          );
        });
        await page.waitForTimeout(260);
      }
      if (inspection.printerActionGap < 4) {
        throw new Error(
          `${viewport.width}x${viewport.height} overlaps the printer settings and delete actions.`,
        );
      }
      if (failures.length > 0) {
        throw new Error(
          `The iPad app reported an error: ${failures.join("; ")}`,
        );
      }
      if (viewport.save) {
        await page.screenshot({
          path: resolve(screenshotDirectory, screenshotName(viewport)),
        });
      }
      return;
    }

    const inspection = await page.evaluate(() => {
      const shell = document.querySelector(".app-shell");
      const strip = document.querySelector(".phone-plate-strip");
      const header = document.querySelector(".phone-titlebar");
      const surface = document.querySelector(".work-surface");
      const canvas = document.querySelector(".label-canvas");
      if (
        !(shell instanceof HTMLElement) ||
        !(strip instanceof HTMLElement) ||
        !(header instanceof HTMLElement) ||
        !(surface instanceof HTMLElement) ||
        !(canvas instanceof HTMLElement)
      ) {
        throw new Error("The responsive editor is incomplete.");
      }
      const client = document.documentElement;
      const surfaceBounds = surface.getBoundingClientRect();
      const canvasBounds = canvas.getBoundingClientRect();
      const headerBounds = header.getBoundingClientRect();
      const visibleHeaderButtons = Array.from(
        header.querySelectorAll("button"),
      ).filter((target) => target.getBoundingClientRect().width > 0);
      const headerActions = header.querySelector(".phone-header-actions");
      const phoneCommandButtons = Array.from(
        document.querySelectorAll(".phone-command-scroll button"),
      );
      const undersizedTargets = Array.from(
        document.querySelectorAll(
          ".phone-titlebar button, .phone-editor-toolbar button, .phone-plate-strip .plate-thumb-select, .phone-plate-strip .add-plate",
        ),
      ).flatMap((target) => {
        const bounds = target.getBoundingClientRect();
        if (bounds.width === 0 || bounds.height === 0) return [];
        return bounds.width < 44 || bounds.height < 44
          ? [
              {
                label: target.getAttribute("aria-label") ?? target.textContent,
                width: bounds.width,
                height: bounds.height,
              },
            ]
          : [];
      });
      return {
        canvasFits:
          canvasBounds.left >= surfaceBounds.left - 1 &&
          canvasBounds.right <= surfaceBounds.right + 1 &&
          canvasBounds.top >= surfaceBounds.top - 1 &&
          canvasBounds.bottom <= surfaceBounds.bottom + 1,
        className: shell.className,
        compactPrinterStatusVisible:
          document
            .querySelector(".printer-compact-status")
            ?.getBoundingClientRect().width === 7,
        directSaveVisible:
          document.querySelector(".phone-save-action")?.getBoundingClientRect()
            .width === 44,
        headerActionsScroll:
          headerActions instanceof HTMLElement &&
          headerActions.scrollWidth > headerActions.clientWidth,
        headerControlsFit: visibleHeaderButtons.every((target) => {
          const bounds = target.getBoundingClientRect();
          return (
            bounds.left >= headerBounds.left - 0.5 &&
            bounds.right <= headerBounds.right + 0.5
          );
        }),
        phoneCommandsHaveVisibleText: phoneCommandButtons.some((target) =>
          target.textContent?.trim(),
        ),
        quickRowVisible:
          document
            .querySelector(".phone-quick-command-row")
            ?.getBoundingClientRect().height === 48,
        overflow:
          client.scrollWidth > client.clientWidth ||
          client.scrollHeight > client.clientHeight,
        stripHeight: strip.getBoundingClientRect().height,
        undersizedTargets,
      };
    });
    if (!inspection.className.includes(`layout-${expectedLayout}`)) {
      throw new Error(
        `${viewport.width}x${viewport.height} used the wrong layout: ${inspection.className}`,
      );
    }
    if (inspection.overflow) {
      throw new Error(`${viewport.width}x${viewport.height} overflows.`);
    }
    if (
      viewport.width >= 375 &&
      (!inspection.headerControlsFit || inspection.headerActionsScroll)
    ) {
      throw new Error(
        `${viewport.width}x${viewport.height} does not fit the icon header.`,
      );
    }
    if (!inspection.directSaveVisible) {
      throw new Error(`${viewport.width}x${viewport.height} hides Save.`);
    }
    if (!inspection.compactPrinterStatusVisible) {
      throw new Error(
        `${viewport.width}x${viewport.height} hides the printer status.`,
      );
    }
    if (!inspection.canvasFits) {
      throw new Error(
        `${viewport.width}x${viewport.height} does not fit the label canvas.`,
      );
    }
    if (inspection.phoneCommandsHaveVisibleText) {
      throw new Error(
        `${viewport.width}x${viewport.height} shows text in the Phone command row.`,
      );
    }
    if (!inspection.quickRowVisible) {
      throw new Error(
        `${viewport.width}x${viewport.height} does not show the selected-element row.`,
      );
    }
    const expectedStripHeight = expectedLayout === "phone-short" ? 54 : 68;
    if (Math.abs(inspection.stripHeight - expectedStripHeight) > 0.5) {
      throw new Error(
        `${viewport.width}x${viewport.height} has a ${inspection.stripHeight} px label strip.`,
      );
    }
    if (inspection.undersizedTargets.length > 0) {
      throw new Error(
        `${viewport.width}x${viewport.height} has controls smaller than 44 px: ${JSON.stringify(inspection.undersizedTargets)}`,
      );
    }
    if (failures.length > 0) {
      throw new Error(
        `The Phone app reported an error: ${failures.join("; ")}`,
      );
    }
    if (viewport.save) {
      await page.screenshot({
        path: resolve(screenshotDirectory, screenshotName(viewport)),
      });
    }
    if (viewport.width === 393 && viewport.height === 852) {
      await page
        .getByRole("button", { name: "More element properties" })
        .click();
      const keyboardSheet = await page.evaluate(() => {
        const shell = document.querySelector(".app-shell");
        const dialog = document.querySelector(".phone-property-modal .dialog");
        if (
          !(shell instanceof HTMLElement) ||
          !(dialog instanceof HTMLElement)
        ) {
          throw new Error("The Phone property sheet is incomplete.");
        }
        document.documentElement.style.setProperty(
          "--visual-viewport-height",
          "500px",
        );
        shell.dataset.softwareKeyboard = "open";
        const bounds = dialog.getBoundingClientRect();
        return { height: bounds.height, top: bounds.top };
      });
      if (
        Math.abs(keyboardSheet.top - 8) > 0.5 ||
        Math.abs(keyboardSheet.height - 484) > 0.5
      ) {
        throw new Error(
          `The Phone keyboard sheet does not fill the available height: ${JSON.stringify(keyboardSheet)}.`,
        );
      }
      await page.getByRole("button", { name: "Close properties" }).click();
      await page.evaluate(() => {
        const shell = document.querySelector(".app-shell");
        if (shell instanceof HTMLElement) {
          delete shell.dataset.softwareKeyboard;
        }
        document.documentElement.style.removeProperty(
          "--visual-viewport-height",
        );
      });
      await page.getByRole("button", { name: "Icons" }).click();
      const iconSearch = page.getByRole("searchbox", { name: "Search icons" });
      await iconSearch.waitFor();
      if (
        !(await iconSearch.evaluate(
          (input) => input === document.activeElement,
        ))
      ) {
        throw new Error("The Phone icon search does not receive focus.");
      }
      await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: "Icon library" }).waitFor({
        state: "hidden",
      });
      await page.locator(".canvas-element-control").first().dblclick();
      await page.getByRole("textbox", { name: "Edit text on label" }).waitFor();
      const phoneChromeVisible = await page.evaluate(() => {
        const shell = document.querySelector(".app-shell");
        if (!(shell instanceof HTMLElement)) return false;
        shell.dataset.softwareKeyboard = "open";
        const header = document.querySelector(".phone-titlebar");
        const toolbar = document.querySelector(".phone-editor-toolbar");
        return [header, toolbar].every(
          (element) =>
            element instanceof HTMLElement &&
            element.getBoundingClientRect().height > 0 &&
            getComputedStyle(element).display !== "none",
        );
      });
      if (!phoneChromeVisible) {
        throw new Error("The Phone keyboard state hides the editor chrome.");
      }
    }
  } finally {
    await context.close();
  }
}

function screenshotName(viewport) {
  return `labelmaker-${viewport.width > 600 && viewport.height > 500 ? "ipad" : "phone"}-${viewport.width}x${viewport.height}.png`;
}

async function inspectStandardIPad(page) {
  const inspection = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const header = document.querySelector(".titlebar");
    const history = document.querySelector(".title-actions .toolbar-cluster");
    const output = document.querySelector(".header-output-actions");
    const toolbar = document.querySelector(".editor-toolbar");
    const inspector = document.querySelector(".inspector");
    if (
      !(shell instanceof HTMLElement) ||
      !(header instanceof HTMLElement) ||
      !(history instanceof HTMLElement) ||
      !(output instanceof HTMLElement) ||
      !(toolbar instanceof HTMLElement) ||
      !(inspector instanceof HTMLElement)
    ) {
      throw new Error("The standard iPad editor is incomplete.");
    }
    const client = document.documentElement;
    const headerBounds = header.getBoundingClientRect();
    const historyBounds = history.getBoundingClientRect();
    const outputBounds = output.getBoundingClientRect();
    const toolbarBounds = toolbar.getBoundingClientRect();
    const inspectorBounds = inspector.getBoundingClientRect();
    const propertyStack = inspector.querySelector(".property-stack");
    const propertyStackBounds = propertyStack?.getBoundingClientRect();
    const propertyStackStyle = propertyStack
      ? getComputedStyle(propertyStack)
      : null;
    const propertyChildren = propertyStack
      ? Array.from(propertyStack.children).filter(
          (child) => child.getBoundingClientRect().height > 0,
        )
      : [];
    const lastPropertyBottom = propertyChildren.reduce(
      (bottom, child) => Math.max(bottom, child.getBoundingClientRect().bottom),
      propertyStackBounds?.top ?? 0,
    );
    const visibleHeaderButtons = Array.from(
      header.querySelectorAll("button"),
    ).filter((target) => target.getBoundingClientRect().width > 0);
    const editorActionLabels = Array.from(
      toolbar.querySelectorAll(".tool-button-label"),
    );
    return {
      className: shell.className,
      dimensions: {
        clientWidth: client.clientWidth,
        innerWidth: window.innerWidth,
        shellWidth: shell.getBoundingClientRect().width,
        visualWidth: window.visualViewport?.width,
      },
      editorActionsAreIconOnly: editorActionLabels.every(
        (label) => label.getBoundingClientRect().width === 0,
      ),
      editorToolbarFits: toolbar.scrollWidth <= toolbar.clientWidth,
      headerControlsFit: visibleHeaderButtons.every((target) => {
        const bounds = target.getBoundingClientRect();
        return (
          bounds.left >= headerBounds.left - 0.5 &&
          bounds.right <= headerBounds.right + 0.5
        );
      }),
      historyIsCentered:
        Math.abs(
          historyBounds.left + historyBounds.width / 2 - client.clientWidth / 2,
        ) <= 1,
      historyIsVerticallyAligned:
        Math.abs(
          historyBounds.top +
            historyBounds.height / 2 -
            (outputBounds.top + outputBounds.height / 2),
        ) <= 1,
      historyLeft: historyBounds.left,
      historyWidth: historyBounds.width,
      inspectorFits:
        inspectorBounds.left >= -0.5 &&
        inspectorBounds.right <= client.clientWidth + 0.5 &&
        inspectorBounds.top >= -0.5 &&
        inspectorBounds.bottom <= client.clientHeight + 0.5 &&
        (!(propertyStack instanceof HTMLElement) ||
          propertyStack.scrollWidth <= propertyStack.clientWidth),
      inspectorHeightFollowsContent:
        propertyStackBounds === undefined ||
        propertyStackStyle === null ||
        Math.abs(
          propertyStackBounds.bottom -
            lastPropertyBottom -
            Number.parseFloat(propertyStackStyle.paddingBottom),
        ) <= 1,
      inspectorIsBelowEditorToolbar:
        Math.abs(inspectorBounds.top - toolbarBounds.bottom) <= 1,
      inspectorIsFullWidth:
        Math.abs(inspectorBounds.left) <= 1 &&
        Math.abs(inspectorBounds.right - client.clientWidth) <= 1,
      inspectorBounds: {
        bottom: inspectorBounds.bottom,
        left: inspectorBounds.left,
        right: inspectorBounds.right,
        top: inspectorBounds.top,
      },
      propertyStackWidth:
        propertyStack instanceof HTMLElement
          ? {
              client: propertyStack.clientWidth,
              scroll: propertyStack.scrollWidth,
            }
          : null,
      outputIsRightAligned:
        Math.abs(headerBounds.right - outputBounds.right) <= 14,
      overflow:
        client.scrollWidth > client.clientWidth ||
        client.scrollHeight > client.clientHeight,
    };
  });
  const printerTrigger = page.getByRole("button", {
    name: "Selected printer: Workshop printer",
  });
  await printerTrigger.click();
  const printerActionGap = await page.evaluate(() => {
    const actions = Array.from(
      document.querySelectorAll(".header-printer-row > .icon-button"),
    );
    if (actions.length < 2) return Number.POSITIVE_INFINITY;
    const settings = actions[0]?.getBoundingClientRect();
    const remove = actions[1]?.getBoundingClientRect();
    if (!settings || !remove) return Number.NEGATIVE_INFINITY;
    return remove.left - settings.right;
  });
  await printerTrigger.click();
  return { ...inspection, printerActionGap };
}
