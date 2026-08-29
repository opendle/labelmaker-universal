import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDirectory = resolve(import.meta.dirname, "..");
const lucidePackage = fileURLToPath(
  import.meta.resolve("lucide-react/package.json"),
);
const iconDirectory = resolve(dirname(lucidePackage), "dist/esm/icons");
const indexSource = await readFile(resolve(iconDirectory, "index.js"), "utf8");
const exportPattern = /export \{ default as (\w+) \} from '\.\/(.+)\.js';/g;
const exports = Array.from(indexSource.matchAll(exportPattern), (match) => ({
  label: match[1]
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2"),
  name: match[1],
  path: match[2],
}));

const icons = await Promise.all(
  exports.map(async ({ label, name, path }) => {
    const module = await import(
      pathToFileURL(resolve(iconDirectory, `${path}.js`)).href
    );
    return { name, label, node: module.__iconNode };
  }),
);

const destination = resolve(
  rootDirectory,
  "packages/ui/src/lucide-icon-catalog.json",
);
await writeFile(destination, `${JSON.stringify({ icons })}\n`, "utf8");
console.log(`Generated ${icons.length} icons in ${destination}`);
