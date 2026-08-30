import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../..");

describe.skipIf(process.platform !== "darwin")(
  "macOS development runtime",
  () => {
    it("installs an executable MakeID Bluetooth helper in app resources", async () => {
      await execFileAsync(
        process.execPath,
        [
          resolve(
            repositoryRoot,
            "packages/adapters/makeid/scripts/build-macos-helper.mjs",
          ),
        ],
        { cwd: repositoryRoot },
      );
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          resolve(repositoryRoot, "apps/desktop/scripts/launch-desktop.mjs"),
          "--prepare-only",
        ],
        { cwd: repositoryRoot },
      );
      const executable = stdout.trim();
      expect(executable).toMatch(
        /Labelmaker\.app\/Contents\/MacOS\/Labelmaker$/,
      );

      await expect(
        access(
          resolve(executable, "../../Resources/makeid-bluetooth-helper"),
          constants.X_OK,
        ),
      ).resolves.toBeUndefined();
    }, 60_000);
  },
);
