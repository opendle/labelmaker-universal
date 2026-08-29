import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function runCapture(scriptName, description) {
  const captureScript = fileURLToPath(new URL(scriptName, import.meta.url));
  const command = process.platform === "linux" ? "xvfb-run" : process.execPath;
  const args =
    process.platform === "linux"
      ? ["-a", "-s", "-screen 0 1920x1080x24", process.execPath, captureScript]
      : [captureScript];
  const child = spawn(command, args, { env: process.env, stdio: "inherit" });
  const title = `${description[0]?.toUpperCase()}${description.slice(1)}`;
  child.once("error", (error) => {
    console.error(
      `Could not start the ${description} capture: ${error.message}`,
    );
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      console.error(`${title} capture stopped with signal ${signal}`);
      process.exitCode = 1;
    } else {
      process.exitCode = code ?? 1;
    }
  });
}

export function prepareDesktopRuntime() {
  const prepared = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./launch-desktop.mjs", import.meta.url)),
      "--prepare-only",
    ],
    { encoding: "utf8" },
  );
  if (prepared.status !== 0) {
    throw new Error(
      `Could not prepare the desktop runtime: ${(prepared.stderr || prepared.stdout).trim()}`,
    );
  }
  const executable = prepared.stdout.trim();
  if (!executable) {
    throw new Error("The desktop runtime did not report an executable");
  }
  return executable;
}
