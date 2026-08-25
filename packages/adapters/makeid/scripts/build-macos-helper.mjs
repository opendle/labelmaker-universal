import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const source = fileURLToPath(
  new URL("../macos-helper/MakeIdBluetoothHelper.m", import.meta.url),
);
const outputDirectory = fileURLToPath(new URL("../dist/bin", import.meta.url));
const output = fileURLToPath(
  new URL("../dist/bin/makeid-bluetooth-helper", import.meta.url),
);
await mkdir(outputDirectory, { recursive: true });
const result = spawnSync(
  "xcrun",
  [
    "clang",
    "-fobjc-arc",
    "-framework",
    "Foundation",
    "-framework",
    "IOBluetooth",
    "-o",
    output,
    source,
  ],
  { cwd: packageRoot, encoding: "utf8" },
);
if (result.status !== 0) {
  process.stderr.write(
    result.stderr || "Could not build the macOS Bluetooth helper\n",
  );
  process.exit(result.status ?? 1);
}
