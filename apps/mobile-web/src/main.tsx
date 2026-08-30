import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { LabelmakerApp } from "@labelmaker/ui";

import { createMobileHost } from "./mobile-host.js";
import { createNativeBridge, validateHostInfo } from "./native-bridge.js";

const root = document.getElementById("root");
if (!root) throw new Error("The Labelmaker root element is missing.");

const bridge = createNativeBridge();
const hostInfo = validateHostInfo(await bridge.call("getHostInfo", {}));
const host = createMobileHost({ bridge, ...hostInfo });

document.documentElement.dataset.platform = hostInfo.platform;
document.documentElement.dataset.presentation = hostInfo.presentation;

createRoot(root).render(
  <StrictMode>
    <LabelmakerApp host={host} />
  </StrictMode>,
);
