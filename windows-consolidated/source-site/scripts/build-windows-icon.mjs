import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "desktop", "assets", "daymark.svg");
const outputDirectory = path.join(root, "desktop", "assets");
const pngPath = path.join(outputDirectory, "daymark.png");
const icoPath = path.join(outputDirectory, "daymark.ico");

await mkdir(outputDirectory, { recursive: true });
await sharp(source).resize(512, 512).png().toFile(pngPath);
await writeFile(icoPath, await pngToIco(pngPath));
console.log(`DAYMARK_WINDOWS_ICON_OK ${icoPath}`);
