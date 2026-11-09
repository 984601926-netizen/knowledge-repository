// One-time generation of the repository's code-defined application icon.
import fs from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
const canvas = createCanvas(256, 256);
canvas
  .getContext("2d")
  .drawImage(
    await loadImage(fs.readFileSync("build/icon.svg")),
    0,
    0,
    256,
    256,
  );
const png = canvas.toBuffer("image/png");
fs.writeFileSync("build/icon.png", png);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
fs.writeFileSync("build/icon.ico", Buffer.concat([header, png]));
