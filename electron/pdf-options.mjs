import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
const directory = (name) => path.join(root, name).replaceAll("\\", "/") + "/";
export const pdfOptions = {
  cMapUrl: directory("cmaps"),
  cMapPacked: true,
  standardFontDataUrl: directory("standard_fonts"),
  wasmUrl: directory("wasm"),
  useSystemFonts: true,
};
