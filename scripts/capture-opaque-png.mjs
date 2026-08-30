import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";

export async function captureOpaquePng(page, path) {
  const rawPath = `${path}.rgba.png`;
  try {
    await page.screenshot({ path: rawPath });
    convertToRgb(rawPath, path);
  } finally {
    await rm(rawPath, { force: true });
  }
  return readOpaquePngSize(path);
}

function convertToRgb(sourcePath, outputPath) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      sourcePath,
      "-frames:v",
      "1",
      "-vf",
      "format=rgb24",
      "-compression_level",
      "9",
      outputPath,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.error?.code === "ENOENT") {
    throw new Error(
      "FFmpeg is required to create RGB App Store screenshots without an alpha channel.",
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `FFmpeg could not remove the screenshot alpha channel: ${(result.stderr || result.stdout).trim()}`,
    );
  }
}

async function readOpaquePngSize(path) {
  const png = await readFile(path);
  const pngSignature = "89504e470d0a1a0a";
  if (png.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error(`${path} is not a PNG file.`);
  }
  const colorType = png[25];
  if (colorType !== 2) {
    throw new Error(
      `${path} uses PNG color type ${String(colorType)}; expected RGB color type 2 without alpha.`,
    );
  }
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}
