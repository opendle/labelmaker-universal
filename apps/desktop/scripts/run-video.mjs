import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const captureScript = fileURLToPath(
  new URL("./capture-video.mjs", import.meta.url),
);
const command = process.platform === "linux" ? "xvfb-run" : process.execPath;
const args =
  process.platform === "linux"
    ? ["-a", "-s", "-screen 0 1920x1080x24", process.execPath, captureScript]
    : [captureScript];

const child = spawn(command, args, {
  env: process.env,
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(`Could not start the video capture: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Video capture stopped with signal ${signal}`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
