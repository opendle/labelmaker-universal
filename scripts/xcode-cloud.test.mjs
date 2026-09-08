import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");
const project = readFileSync(
  join(repositoryRoot, "apps/ipad/Labelmaker.xcodeproj/project.pbxproj"),
  "utf8",
);
const buildPhase = JSON.parse(
  project.match(/shellScript = ("(?:\\.|[^"\\])*");/)[1],
);
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "labelmaker-cloud-"));
  temporaryDirectories.push(temporaryDirectory);
  const root = join(temporaryDirectory, "checkout with spaces");
  const sourceRoot = join(root, "apps/ipad");
  const scripts = join(sourceRoot, "ci_scripts");
  const bin = join(temporaryDirectory, "bin");
  const nodePrefix = join(temporaryDirectory, "node 24");
  const log = join(temporaryDirectory, "commands.log");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(bin);
  mkdirSync(join(nodePrefix, "bin"), { recursive: true });
  const hook = join(scripts, "ci_post_clone.sh");
  copyFileSync(
    join(repositoryRoot, "apps/ipad/ci_scripts/ci_post_clone.sh"),
    hook,
  );
  chmodSync(hook, 0o755);

  function executable(path, body) {
    writeFileSync(path, "#!/bin/sh\nset -eu\n" + body, { mode: 0o755 });
  }
  executable(
    join(bin, "brew"),
    'case "$*" in\n' +
      '  "install node@24") echo "brew install node@24" >> "$TEST_LOG" ;;\n' +
      '  "--prefix node@24") echo "$TEST_NODE_PREFIX" ;;\n' +
      "  *) exit 99 ;;\nesac\n",
  );
  executable(join(nodePrefix, "bin/node"), 'echo "v24.0.0"\n');
  executable(
    join(nodePrefix, "bin/npm"),
    'if [ "$1" = "--version" ]; then echo "11.0.0"; exit 0; fi\n' +
      'printf "%s|%s|%s\\n" "$PWD" "$*" "${ELECTRON_SKIP_BINARY_DOWNLOAD:-}" >> "$TEST_LOG"\n' +
      'if [ "$1" = "ci" ]; then exit "${TEST_INSTALL_STATUS:-0}"; fi\n' +
      'if [ "$*" = "run build:web --workspace @labelmaker/ipad" ]; then\n' +
      "  mkdir -p apps/ipad/Labelmaker/Resources/WebApp\n" +
      '  echo "<html>cloud</html>" > apps/ipad/Labelmaker/Resources/WebApp/index.html\n' +
      'elif [ "$*" = "run build --workspace @labelmaker/mobile-web" ]; then\n' +
      "  mkdir -p apps/mobile-web/dist\n" +
      '  echo "<html>local</html>" > apps/mobile-web/dist/index.html\n' +
      "else exit 98; fi\n",
  );
  return {
    root,
    sourceRoot,
    hook,
    nodePrefix,
    log,
    bundle: join(sourceRoot, "Labelmaker/Resources/WebApp"),
    env: {
      PATH: bin + ":/usr/bin:/bin",
      SRCROOT: sourceRoot,
      CI_XCODE_CLOUD: "TRUE",
      TEST_NODE_PREFIX: nodePrefix,
      TEST_LOG: log,
    },
  };
}

describe.skipIf(process.platform === "win32")(
  "Xcode Cloud web preparation",
  () => {
    it("prepares a clean checkout with Node 24 and development dependencies", () => {
      const setup = fixture();
      const result = spawnSync(setup.hook, [], {
        cwd: tmpdir(),
        env: { ...setup.env, NODE_ENV: "production" },
        encoding: "utf8",
      });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(readFileSync(setup.log, "utf8").trim().split("\n")).toEqual([
        "brew install node@24",
        setup.root + "|ci --include=dev|1",
        setup.root + "|run build:web --workspace @labelmaker/ipad|",
      ]);
      expect(existsSync(join(setup.bundle, "index.html"))).toBe(true);
    });

    it("stops before the web build when dependency installation fails", () => {
      const setup = fixture();
      const result = spawnSync(setup.hook, [], {
        env: { ...setup.env, TEST_INSTALL_STATUS: "42" },
      });
      expect(result.status).toBe(42);
      expect(readFileSync(setup.log, "utf8")).not.toContain("run build");
      expect(existsSync(setup.bundle)).toBe(false);
    });

    it("uses the prepared Cloud bundle without Node or npm on PATH", () => {
      const setup = fixture();
      mkdirSync(setup.bundle, { recursive: true });
      writeFileSync(join(setup.bundle, "index.html"), "<html>prepared</html>");
      const result = spawnSync("/bin/sh", ["-c", buildPhase], {
        env: { ...setup.env, PATH: "/no-tools" },
        encoding: "utf8",
      });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(readFileSync(join(setup.bundle, "index.html"), "utf8")).toBe(
        "<html>prepared</html>",
      );
    });

    it.each([false, true])(
      "rejects a missing or empty Cloud entry point (%s)",
      (empty) => {
        const setup = fixture();
        if (empty) {
          mkdirSync(setup.bundle, { recursive: true });
          writeFileSync(join(setup.bundle, "index.html"), "");
        }
        const result = spawnSync("/bin/sh", ["-c", buildPhase], {
          env: { ...setup.env, PATH: "/no-tools" },
          encoding: "utf8",
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("ci_scripts/ci_post_clone.sh");
      },
    );

    it("still rebuilds and replaces web resources outside Xcode Cloud", () => {
      const setup = fixture();
      mkdirSync(setup.bundle, { recursive: true });
      writeFileSync(join(setup.bundle, "stale.js"), "stale");
      // Keep this stub active when the build phase adds Homebrew to PATH.
      const script =
        'npm() { "$TEST_NODE_PREFIX/bin/npm" "$@"; }\n' + buildPhase;
      const result = spawnSync("/bin/sh", ["-c", script], {
        env: {
          ...setup.env,
          CI_XCODE_CLOUD: "",
          PATH: setup.nodePrefix + "/bin:" + setup.env.PATH,
        },
        encoding: "utf8",
      });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(readFileSync(join(setup.bundle, "index.html"), "utf8")).toContain(
        "local",
      );
      expect(existsSync(join(setup.bundle, "stale.js"))).toBe(false);
    });
  },
);
