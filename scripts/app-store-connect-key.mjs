import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const KEYCHAIN_SERVICE = "com.opendle.labelmaker.app-store-connect-api-key";

export function readAppStoreConnectApiKey(keyId) {
  const result = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", keyId, "-w"],
    {
      encoding: null,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Could not read App Store Connect API key ${keyId} from the login Keychain.`,
    );
  }
  const key = decodeKeychainPassword(result.stdout);
  if (
    !key.includes(Buffer.from("-----BEGIN PRIVATE KEY-----")) ||
    !key.includes(Buffer.from("-----END PRIVATE KEY-----"))
  ) {
    key.fill(0);
    throw new Error(`The Keychain item for ${keyId} is not a valid API key.`);
  }
  return key;
}

export async function runAltoolWithAppStoreConnectApiKey(
  args,
  { keyId, issuerId, cwd },
) {
  const temporaryDirectory = await mkdtemp(
    resolve(tmpdir(), "label-maker-app-store-key-"),
  );
  const imagePath = resolve(temporaryDirectory, "key.dmg");
  const mountPath = resolve(temporaryDirectory, "mounted-key");
  const keyPath = resolve(mountPath, `AuthKey_${keyId}.p8`);
  const imagePassword = createImagePassword();
  let apiPrivateKey;
  let imageIsMounted = false;
  let failure;

  try {
    await mkdir(mountPath, { mode: 0o700 });
    run(
      "/usr/bin/hdiutil",
      [
        "create",
        "-size",
        "2m",
        "-fs",
        "HFS+",
        "-volname",
        "Label Maker Upload Key",
        "-encryption",
        "AES-256",
        "-stdinpass",
        imagePath,
      ],
      { input: imagePassword },
    );
    run(
      "/usr/bin/hdiutil",
      [
        "attach",
        "-mountpoint",
        mountPath,
        "-nobrowse",
        "-noautoopen",
        "-stdinpass",
        imagePath,
      ],
      { input: imagePassword },
    );
    imageIsMounted = true;
    apiPrivateKey = readAppStoreConnectApiKey(keyId);
    await writeFile(keyPath, apiPrivateKey, { mode: 0o600 });
    apiPrivateKey.fill(0);
    apiPrivateKey = undefined;

    run(
      "/usr/bin/xcrun",
      [
        "altool",
        ...args,
        "--api-key",
        keyId,
        "--api-issuer",
        issuerId,
        "--p8-file-path",
        keyPath,
      ],
      {
        cwd,
      },
    );
  } catch (error) {
    failure = error;
  } finally {
    apiPrivateKey?.fill(0);
    imagePassword.fill(0);
    await rm(keyPath, { force: true }).catch((error) => {
      failure ??= error;
    });
    if (imageIsMounted) {
      try {
        run("/usr/bin/hdiutil", ["detach", mountPath, "-force"]);
      } catch (error) {
        failure ??= error;
      }
    }
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(
      (error) => {
        failure ??= error;
      },
    );
  }
  if (failure) throw failure;
}

function createImagePassword() {
  const random = randomBytes(32);
  const password = Buffer.alloc(random.length * 2 + 1);
  const hexadecimal = Buffer.from("0123456789abcdef");
  for (let index = 0; index < random.length; index += 1) {
    password[index * 2] = hexadecimal[random[index] >> 4];
    password[index * 2 + 1] = hexadecimal[random[index] & 0x0f];
  }
  password[password.length - 1] = 0x0a;
  random.fill(0);
  return password;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: process.env,
    input: options.input,
    stdio: options.input
      ? ["pipe", "inherit", "inherit"]
      : ["ignore", "inherit", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${String(result.status)}.`);
  }
}

function decodeKeychainPassword(value) {
  let end = value.length;
  while (
    end > 0 &&
    (value[end - 1] === 0x0a ||
      value[end - 1] === 0x0d ||
      value[end - 1] === 0x20 ||
      value[end - 1] === 0x09)
  ) {
    end -= 1;
  }
  const isHexadecimal =
    end > 0 && end % 2 === 0 && value.subarray(0, end).every(isHexadecimalByte);
  if (!isHexadecimal) {
    const decoded = Buffer.from(value);
    value.fill(0);
    return decoded;
  }

  const decoded = Buffer.alloc(end / 2);
  for (let index = 0; index < end; index += 2) {
    decoded[index / 2] =
      hexadecimalNibble(value[index]) * 16 +
      hexadecimalNibble(value[index + 1]);
  }
  value.fill(0);
  return decoded;
}

function isHexadecimalByte(value) {
  return (
    (value >= 0x30 && value <= 0x39) ||
    (value >= 0x41 && value <= 0x46) ||
    (value >= 0x61 && value <= 0x66)
  );
}

function hexadecimalNibble(value) {
  if (value >= 0x30 && value <= 0x39) return value - 0x30;
  if (value >= 0x41 && value <= 0x46) return value - 0x41 + 10;
  return value - 0x61 + 10;
}
