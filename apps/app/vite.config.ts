import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import vibelang from "vibelang-vite";
import { defineConfig } from "vite";

// `vite build` writes the page to dist/client; `vite build --ssr src/worker.vibe` the Worker to dist/worker, whole,
// for workerd (wrangler.jsonc, "main" and "assets").
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [vibelang(), react(), tailwindcss()],
  build: { outDir: isSsrBuild ? "dist/worker" : "dist/client", emptyOutDir: true },
  ssr: { noExternal: true, target: "webworker" },
}));
