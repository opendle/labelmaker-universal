import { spawnSync } from "node:child_process";

function report(command, args, missingMessage) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, FALLOW_UPDATE_CHECK: "off" },
  });
  if (result.error?.code === "ENOENT") console.log(missingMessage);
}

const gitDirectory =
  spawnSync("git", ["rev-parse", "--git-dir"], {
    encoding: "utf8",
  }).stdout?.trim() || ".git";

// Report dead code in the changed files. This report does not fail the check.
report(
  "fallow",
  ["review", "--brief"],
  "fallow is not installed: no dead code report.",
);

// Report copied code in the changed files. This report does not fail the check.
report(
  "jscpd",
  [
    "--changed",
    "--baseline",
    `${gitDirectory}/jscpd-baseline.json`,
    "--reporters",
    "ai",
    "--no-colors",
    "-i",
    "**/*.test.*,**/test/**,**/LabelmakerTests/**",
    "apps",
    "packages",
    "scripts",
  ],
  "jscpd is not installed: no duplicate report.",
);
