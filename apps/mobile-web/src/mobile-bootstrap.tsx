import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { LabelmakerApp } from "@labelmaker/ui";

import { createMobileHost } from "./mobile-host.js";
import { createNativeBridge, type NativeBridge } from "./native-bridge.js";
import { validateHostInfo } from "./native-bridge.js";

export async function mountMobileApplication(
  rootElement: HTMLElement,
  bridge?: NativeBridge,
): Promise<void> {
  const root = createRoot(rootElement);
  try {
    const activeBridge = bridge ?? createNativeBridge();
    const hostInfo = validateHostInfo(
      await activeBridge.call("getHostInfo", {}),
    );
    const host = createMobileHost({ bridge: activeBridge, ...hostInfo });
    document.documentElement.dataset.platform = hostInfo.platform;
    document.documentElement.dataset.presentation = hostInfo.presentation;
    root.render(
      <StrictMode>
        <LabelmakerApp host={host} />
      </StrictMode>,
    );
  } catch {
    root.render(
      <main className="mobile-startup-failure" role="alert">
        <h1>Label Maker could not start</h1>
        <p>Close the application and open it again.</p>
      </main>,
    );
  }
}
