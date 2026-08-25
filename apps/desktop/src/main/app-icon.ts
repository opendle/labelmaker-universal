import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, type NativeImage } from "electron";

let appIconPromise: Promise<NativeImage> | undefined;

async function renderAppIcon(): Promise<NativeImage> {
  const iconPath = fileURLToPath(
    new URL("../renderer/app-icon.svg", import.meta.url),
  );
  const svg = readFileSync(iconPath).toString("base64");
  const surface = new BrowserWindow({
    show: false,
    width: 512,
    height: 512,
    useContentSize: true,
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      sandbox: true,
    },
  });

  try {
    await surface.loadURL(`data:image/svg+xml;base64,${svg}`);
    const icon = await surface.webContents.capturePage({
      x: 0,
      y: 0,
      width: 512,
      height: 512,
    });
    if (icon.isEmpty()) throw new Error("The app icon could not be rendered");
    return icon;
  } finally {
    surface.destroy();
  }
}

export async function installAppIcon(window: BrowserWindow): Promise<void> {
  appIconPromise ??= renderAppIcon();
  const icon = await appIconPromise;
  if (!window.isDestroyed()) window.setIcon(icon);
  if (process.platform === "darwin" && app.dock) app.dock.setIcon(icon);
}
