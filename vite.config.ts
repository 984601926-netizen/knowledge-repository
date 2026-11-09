import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "offline-pdf-support",
      closeBundle() {
        fs.copyFileSync("build/icon.png", "dist/icon.png");
        for (const name of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
          const source = "node_modules/pdfjs-dist/" + name;
          if (fs.existsSync(source))
            fs.cpSync(source, "dist/pdf-support/" + name, { recursive: true });
        }
      },
    },
  ],
  base: "./",
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: { chunkSizeWarningLimit: 1500 },
});
