import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const base = process.env.PAGES_BASE_PATH ?? "/compound/";

// A separate client-only target: the local Vinext/Sites server remains intact.
export default defineConfig({
  root: fileURLToPath(new URL("./pages", import.meta.url)),
  base,
  plugins: [react()],
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  define: { "process.env.NEXT_PUBLIC_BASE_PATH": JSON.stringify(base) },
  build: {
    outDir: fileURLToPath(new URL("./out", import.meta.url)),
    emptyOutDir: true,
  },
});
