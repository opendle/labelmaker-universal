import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  root: fileURLToPath(new URL("./WebApp", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      "@labelmaker/adapter-makeid": fileURLToPath(
        new URL("../../packages/adapters/makeid/src/index.ts", import.meta.url),
      ),
      "@labelmaker/adapter-mock": fileURLToPath(
        new URL("../../packages/adapters/mock/src/index.ts", import.meta.url),
      ),
      "@labelmaker/domain": fileURLToPath(
        new URL("../../packages/domain/src/index.ts", import.meta.url),
      ),
      "@labelmaker/ui": fileURLToPath(
        new URL("../../packages/ui/src/index.ts", import.meta.url),
      ),
      "@labelmaker/documents": fileURLToPath(
        new URL("../../packages/documents/src/index.ts", import.meta.url),
      ),
      "@labelmaker/printing": fileURLToPath(
        new URL("../../packages/printing/src/index.ts", import.meta.url),
      ),
      "@labelmaker/rendering": fileURLToPath(
        new URL("../../packages/rendering/src/index.ts", import.meta.url),
      ),
    },
  },
  build: {
    outDir: fileURLToPath(
      new URL("./Labelmaker/Resources/WebApp", import.meta.url),
    ),
    emptyOutDir: true,
  },
});
