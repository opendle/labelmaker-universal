import { execFileSync } from "node:child_process";

const family = process.argv[2];
if (family !== "iphone" && family !== "ipad") {
  throw new Error("Select the iphone or ipad simulator family.");
}

const value = JSON.parse(
  execFileSync("xcrun", ["simctl", "list", "devices", "available", "-j"], {
    encoding: "utf8",
  }),
);
const prefix = family === "iphone" ? "iPhone" : "iPad";
const candidates = Object.entries(value.devices ?? {})
  .flatMap(([runtime, devices]) =>
    Array.isArray(devices)
      ? devices.map((device) => ({ ...device, runtime }))
      : [],
  )
  .filter(
    (device) =>
      device.isAvailable !== false &&
      typeof device.udid === "string" &&
      typeof device.name === "string" &&
      device.name.startsWith(prefix),
  )
  .sort((left, right) =>
    right.runtime.localeCompare(left.runtime, undefined, { numeric: true }),
  );
const selected = candidates[0];
if (!selected) {
  throw new Error(`No available ${prefix} simulator was found.`);
}
process.stdout.write(selected.udid);
