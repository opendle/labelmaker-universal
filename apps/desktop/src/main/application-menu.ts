import type { MenuItemConstructorOptions } from "electron";

export function macApplicationMenu(
  showMainWindow: () => void,
): MenuItemConstructorOptions[] {
  return [
    { role: "appMenu" },
    { label: "File", submenu: [{ role: "close" }] },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      role: "windowMenu",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        {
          id: "show-main-window",
          label: "Show Main Window",
          click: showMainWindow,
        },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];
}
