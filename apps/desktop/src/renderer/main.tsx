import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { LabelmakerApp } from "@labelmaker/ui";

import type { LabelmakerHost } from "@labelmaker/ui";

declare global {
  interface Window {
    readonly labelmakerHost: LabelmakerHost;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("Application root was not found");

createRoot(root).render(
  <StrictMode>
    <LabelmakerApp host={window.labelmakerHost} />
  </StrictMode>,
);
