const { contextBridge, ipcRenderer } =
  require("electron") as typeof import("electron");

contextBridge.exposeInMainWorld("labelmakerHost", {
  presentation: "desktop",
  platform:
    process.platform === "darwin"
      ? "macos"
      : process.platform === "win32"
        ? "windows"
        : "linux",
  listPrinters: () => ipcRenderer.invoke("labelmaker:list-printers"),
  discoverPrinters: () => ipcRenderer.invoke("labelmaker:discover-printers"),
  addPrinter: (printerId: string) =>
    ipcRenderer.invoke("labelmaker:add-printer", printerId),
  removePrinter: (printerId: string) =>
    ipcRenderer.invoke("labelmaker:remove-printer", printerId),
  getActivePrinterId: () => ipcRenderer.invoke("labelmaker:get-active-printer"),
  setActivePrinterId: (printerId: string) =>
    ipcRenderer.invoke("labelmaker:set-active-printer", printerId),
  updatePrinterSettings: (printerId: string, settings: unknown) =>
    ipcRenderer.invoke(
      "labelmaker:update-printer-settings",
      printerId,
      settings,
    ),
  loadWorkspaceRecovery: () =>
    ipcRenderer.invoke("labelmaker:load-workspace-recovery"),
  storeWorkspaceRecovery: (state: unknown) =>
    ipcRenderer.invoke("labelmaker:store-workspace-recovery", state),
  newWorkspace: (hasUnsavedChanges: boolean, document: unknown) =>
    ipcRenderer.invoke("labelmaker:new-workspace", hasUnsavedChanges, document),
  openWorkspace: (hasUnsavedChanges: boolean, document: unknown) =>
    ipcRenderer.invoke(
      "labelmaker:open-workspace",
      hasUnsavedChanges,
      document,
    ),
  saveWorkspace: (document: unknown) =>
    ipcRenderer.invoke("labelmaker:save-workspace", document),
  saveWorkspaceAs: (document: unknown) =>
    ipcRenderer.invoke("labelmaker:save-workspace-as", document),
  print: (request: unknown) => ipcRenderer.invoke("labelmaker:print", request),
});
