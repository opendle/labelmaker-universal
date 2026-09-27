import { open, rm } from "node:fs/promises";

export async function withReleaseVersionLock(versionPath, reserve) {
  const lockPath = `${versionPath}.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        `A release version lock exists at ${lockPath}. Wait for the other upload to select its build number, then try again. If no upload is running, remove the lock.`,
      );
    }
    throw error;
  }
  try {
    return await reserve();
  } finally {
    try {
      await lock.close();
    } finally {
      await rm(lockPath, { force: true });
    }
  }
}
