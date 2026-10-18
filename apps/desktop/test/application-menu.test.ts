import { describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";

import { macApplicationMenu } from "../src/main/application-menu.js";

describe("macOS application menu", () => {
  it("keeps the main window command available without an open window", () => {
    const showMainWindow = vi.fn();
    const template = macApplicationMenu(showMainWindow);
    const windowMenu = template.find((item) => item.role === "windowMenu");
    const submenu = windowMenu?.submenu as MenuItemConstructorOptions[];
    const command = submenu.find((item) => item.id === "show-main-window");

    expect(command?.label).toBe("Show Main Window");
    expect(command?.enabled).not.toBe(false);
    expect(command?.role).toBeUndefined();
    expect(command?.click).toBe(showMainWindow);
  });

  it("keeps the native app, edit, view, and window actions", () => {
    const template = macApplicationMenu(vi.fn());
    expect(template).toEqual(
      expect.arrayContaining([
        { role: "appMenu" },
        { label: "File", submenu: [{ role: "close" }] },
        { role: "editMenu" },
        { role: "viewMenu" },
        expect.objectContaining({
          role: "windowMenu",
          submenu: expect.arrayContaining([
            { role: "minimize" },
            { role: "zoom" },
            { role: "front" },
          ]),
        }),
      ]),
    );
  });
});
