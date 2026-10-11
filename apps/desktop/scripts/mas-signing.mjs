import { relative, resolve, sep } from "node:path";

export function masSigningOptions(
  filePath,
  { appPath, resourcesDirectory, mode },
) {
  const path = resolve(filePath);
  const frameworkChild = relative(
    resolve(appPath, "Contents/Frameworks"),
    path,
  ).split(sep)[0];
  const electronHelper = frameworkChild?.endsWith(".app") === true;
  const entitlementFile =
    path === resolve(appPath)
      ? "entitlements.plist"
      : electronHelper
        ? "entitlements-child-jit.plist"
        : "entitlements-child.plist";
  return {
    entitlements: resolve(resourcesDirectory, "mas", entitlementFile),
    hardenedRuntime: true,
    ...(mode === "development" ? { timestamp: "none" } : {}),
  };
}
