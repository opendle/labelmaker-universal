import { spawnSync } from "node:child_process";

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
