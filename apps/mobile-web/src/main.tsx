import { mountMobileApplication } from "./mobile-bootstrap.js";

const root = document.getElementById("root");
if (!root) throw new Error("The Labelmaker root element is missing.");

await mountMobileApplication(root);
