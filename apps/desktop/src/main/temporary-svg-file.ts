import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withTemporarySvgFile<T>(
  svg: string,
  operation: (filePath: string) => T | Promise<T>,
  parentDirectory = tmpdir(),
): Promise<T> {
  const directory = await mkdtemp(join(parentDirectory, "labelmaker-raster-"));
  const filePath = join(directory, "plate.svg");
  try {
    await writeFile(filePath, svg, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return await operation(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
