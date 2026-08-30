import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withTemporarySvgPage<T>(
  svg: string,
  widthPixels: number,
  heightPixels: number,
  operation: (pagePath: string) => T | Promise<T>,
  parentDirectory = tmpdir(),
): Promise<T> {
  assertDimension(widthPixels, "widthPixels");
  assertDimension(heightPixels, "heightPixels");
  const directory = await mkdtemp(join(parentDirectory, "labelmaker-raster-"));
  const svgPath = join(directory, "plate.svg");
  const pagePath = join(directory, "raster.html");
  try {
    await Promise.all([
      writeFile(svgPath, svg, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      }),
      writeFile(pagePath, rasterPage(widthPixels, heightPixels), {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      }),
    ]);
    return await operation(pagePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function rasterPage(widthPixels: number, heightPixels: number): string {
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:white}#plate{display:block;width:${widthPixels}px;height:${heightPixels}px}</style><img id="plate" src="plate.svg" alt="">`;
}

function assertDimension(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}
