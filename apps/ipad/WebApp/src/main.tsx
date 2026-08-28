import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { LabelmakerApp } from "@labelmaker/ui";

import { ipadHost } from "./ipad-host.js";

const root = document.getElementById("root");
if (!root) throw new Error("The Labelmaker root element is missing.");

document.documentElement.dataset.platform = "ipados";

createRoot(root).render(
  <StrictMode>
    <LabelmakerApp host={ipadHost} />
  </StrictMode>,
);
