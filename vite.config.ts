import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ command, mode }) => ({
  appType: "mpa",
  base: command === "build" || mode === "production" ? "/morph/" : "/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        caseStudy: resolve(root, "case-study/index.html"),
      },
    },
  },
}));
