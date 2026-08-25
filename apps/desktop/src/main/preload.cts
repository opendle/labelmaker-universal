const { contextBridge, ipcRenderer } =
  require("electron") as typeof import("electron");

contextBridge.exposeInMainWorld("labelmakerHost", {
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
  newWorkspace: (hasUnsavedChanges: boolean) =>
    ipcRenderer.invoke("labelmaker:new-workspace", hasUnsavedChanges),
  openWorkspace: (hasUnsavedChanges: boolean) =>
    ipcRenderer.invoke("labelmaker:open-workspace", hasUnsavedChanges),
  saveWorkspace: (document: unknown) =>
    ipcRenderer.invoke("labelmaker:save-workspace", document),
  saveWorkspaceAs: (document: unknown) =>
    ipcRenderer.invoke("labelmaker:save-workspace-as", document),
  print: (request: unknown) => ipcRenderer.invoke("labelmaker:print", request),
});
