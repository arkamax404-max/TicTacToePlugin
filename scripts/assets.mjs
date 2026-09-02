import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import { generateRuntimeStateAssets } from "./state-assets.mjs";
import { generateNewGameAssets } from "./new-game-assets.mjs";
import { withAssetsTreeGuard } from "./assets-tree-guard.mjs";

const COLORS = {
  bg: [16, 24, 32, 255],
  panel: [27, 42, 54, 255],
  cyan: [100, 230, 255, 255],
  orange: [255, 179, 71, 255],
  green: [112, 240, 168, 255],
  white: [245, 248, 250, 255],
  muted: [113, 134, 151, 255],
};
const USER_SUPPLIED_STATE_ASSETS = new Set(["blank.png", "cross.png", "circle.png"]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function canvas(width, height, color = COLORS.bg) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = color[0];
    pixels[index + 1] = color[1];
    pixels[index + 2] = color[2];
    pixels[index + 3] = color[3];
  }
  return { width, height, pixels };
}

function setPixel(image, x, y, color) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const index = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  image.pixels.set(color, index);
}

function rect(image, x, y, width, height, color) {
  for (let py = y; py < y + height; py += 1)
    for (let px = x; px < x + width; px += 1) setPixel(image, px, py, color);
}

function circle(image, cx, cy, radius, color, thickness = radius) {
  const inner = Math.max(0, radius - thickness);
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const distance = x * x + y * y;
      if (distance <= radius * radius && distance >= inner * inner)
        setPixel(image, cx + x, cy + y, color);
    }
  }
}

function line(image, x1, y1, x2, y2, thickness, color) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let step = 0; step <= steps; step += 1) {
    const ratio = steps ? step / steps : 0;
    circle(
      image,
      Math.round(x1 + (x2 - x1) * ratio),
      Math.round(y1 + (y2 - y1) * ratio),
      Math.ceil(thickness / 2),
      color,
    );
  }
}

const FONT = {
  " ": ["000", "000", "000", "000", "000", "000", "000"],
  "-": ["000", "000", "000", "111", "000", "000", "000"],
  "0": ["111", "101", "101", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "010", "010", "111"],
  "2": ["111", "001", "001", "111", "100", "100", "111"],
  "3": ["111", "001", "001", "111", "001", "001", "111"],
  "4": ["101", "101", "101", "111", "001", "001", "001"],
  "5": ["111", "100", "100", "111", "001", "001", "111"],
  "6": ["111", "100", "100", "111", "101", "101", "111"],
  "7": ["111", "001", "001", "010", "010", "010", "010"],
  "8": ["111", "101", "101", "111", "101", "101", "111"],
  "9": ["111", "101", "101", "111", "001", "001", "111"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["111", "010", "010", "010", "010", "010", "111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
};

function textWidth(value, scale) {
  return [...value].reduce(
    (width, character) => width + ((FONT[character]?.[0].length || 5) + 1) * scale,
    -scale,
  );
}

function text(image, value, centerX, y, scale, color) {
  const upper = value.toUpperCase();
  let x = Math.round(centerX - textWidth(upper, scale) / 2);
  for (const character of upper) {
    const glyph = FONT[character] || FONT[" "];
    glyph.forEach((row, rowIndex) =>
      [...row].forEach((pixel, columnIndex) => {
        if (pixel === "1")
          rect(image, x + columnIndex * scale, y + rowIndex * scale, scale, scale, color);
      }),
    );
    x += (glyph[0].length + 1) * scale;
  }
}

function logo(image, cx, cy, size) {
  const gap = Math.round(size * 0.16);
  line(image, cx - size / 2, cy - gap, cx + size / 2, cy - gap, 8, COLORS.muted);
  line(image, cx - size / 2, cy + gap, cx + size / 2, cy + gap, 8, COLORS.muted);
  line(image, cx - gap, cy - size / 2, cx - gap, cy + size / 2, 8, COLORS.muted);
  line(image, cx + gap, cy - size / 2, cx + gap, cy + size / 2, 8, COLORS.muted);
  line(image, cx - size * 0.4, cy - size * 0.4, cx - size * 0.15, cy - size * 0.15, 12, COLORS.cyan);
  line(image, cx - size * 0.15, cy - size * 0.4, cx - size * 0.4, cy - size * 0.15, 12, COLORS.cyan);
  circle(image, cx + size * 0.28, cy + size * 0.28, size * 0.16, COLORS.orange, 10);
}

function placementIcon(position) {
  const image = canvas(196, 196);
  const gridX = 37;
  const gridY = 20;
  const cellSize = 36;
  const gap = 7;
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const selected = row * 3 + column === position;
      const x = gridX + column * (cellSize + gap);
      const y = gridY + row * (cellSize + gap);
      rect(image, x, y, cellSize, cellSize, selected ? COLORS.cyan : COLORS.muted);
      rect(image, x + 6, y + 6, cellSize - 12, cellSize - 12, selected ? COLORS.panel : COLORS.bg);
    }
  }
  text(image, String(position + 1), 98, 151, 6, COLORS.white);
  return image;
}

function encodePng(image) {
  const scanlines = [];
  for (let y = 0; y < image.height; y += 1) {
    scanlines.push(Buffer.from([0]));
    scanlines.push(image.pixels.subarray(y * image.width * 4, (y + 1) * image.width * 4));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(scanlines), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function save(path, image) {
  if (USER_SUPPLIED_STATE_ASSETS.has(basename(path)))
    throw new Error(`Refusing to overwrite user-supplied artwork: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(image));
}

export const GAMEPLAY_BANNER_SOURCE = "gameplay-banner-source.png";
export const GAMEPLAY_BANNER_SOURCE_HASH = "ca4eb34f9d2ed2b16d50c0ed23d20f5b15dfda09da7d191b6793d1731bc6b158";
export const STORE_ASSET_SOURCES = Object.freeze({
  "assets/banner-gameplay-source-v2.png": Object.freeze({
    width: 1774,
    height: 887,
    sha256: "c4f1395ba59b71713ec20a78902a06c32f9017146ef77d2e334a83554c56c976",
    output: "resources/store/cover.png",
    outputWidth: 1200,
    outputHeight: 600,
  }),
  "assets/cover-source-v2.png": Object.freeze({
    width: 1536,
    height: 1024,
    sha256: "c2fbd71542795dcd68cd56fd39112627c9d9e8ea8bd6810be2ce5dddd9cb4055",
    output: "resources/store/banner-gameplay.png",
    outputWidth: 1200,
    outputHeight: 800,
  }),
});
export const APPROVED_STORE_ASSETS = Object.freeze({
  "resources/store/cover.png": Object.freeze({
    width: 1200,
    height: 600,
    sha256: "79b542e208b336d0649b69d21e2e9a1ddbedf567aea6d6b56c50c33c95babe1d",
  }),
  "resources/store/banner-gameplay.png": Object.freeze({
    width: 1200,
    height: 800,
    sha256: "62b4795f848dcf0d0b8cb38f5b584588174a9c17fb2afee7232f49f5c3de02b7",
  }),
  "resources/store/banner-gameplay-2.png": Object.freeze({
    width: 1200,
    height: 800,
    sha256: "ebbc7e91f8d1f0ffe31bd260493d09c8281deaaf9dcba87275446baf16428fe8",
  }),
});

export function assertApprovedStoreAssets(root) {
  for (const [relativePath, expected] of Object.entries(APPROVED_STORE_ASSETS)) {
    const data = readFileSync(`${root}/${relativePath}`);
    if (data.toString("ascii", 1, 4) !== "PNG")
      throw new Error(`Approved store artwork is not PNG: ${relativePath}`);
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    if (width !== expected.width || height !== expected.height)
      throw new Error(`Approved store artwork has invalid dimensions: ${relativePath}`);
    const hash = createHash("sha256").update(data).digest("hex");
    if (hash !== expected.sha256)
      throw new Error(`Refusing to overwrite changed approved store artwork: ${relativePath}`);
  }
}

function decodePng(data) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!data.subarray(0, 8).equals(signature)) throw new Error("Store asset source is not a PNG");
  let offset = 8;
  let width;
  let height;
  let bytesPerPixel;
  const compressed = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = data.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([Buffer.from(type), body])) !== expectedCrc)
      throw new Error(`Invalid gameplay source PNG ${type} checksum`);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || ![2, 6].includes(body[9]) || body[10] !== 0 || body[11] !== 0 || body[12] !== 0)
        throw new Error("Store asset source must be an 8-bit, non-interlaced RGB or RGBA PNG");
      bytesPerPixel = body[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      compressed.push(body);
    }
    offset += length + 12;
  }
  if (!width || !height || compressed.length === 0)
    throw new Error("Gameplay banner source PNG is incomplete");

  const encoded = inflateSync(Buffer.concat(compressed));
  const stride = width * bytesPerPixel;
  if (encoded.length !== (stride + 1) * height)
    throw new Error("Unexpected gameplay banner source scanline size");
  const pixels = Buffer.alloc(stride * height);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = encoded[inputOffset];
    inputOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = encoded[inputOffset + x];
      const left = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? pixels[(y - 1) * stride + x - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const estimate = left + above - upperLeft;
        const leftDistance = Math.abs(estimate - left);
        const aboveDistance = Math.abs(estimate - above);
        const diagonalDistance = Math.abs(estimate - upperLeft);
        predictor = leftDistance <= aboveDistance && leftDistance <= diagonalDistance
          ? left
          : aboveDistance <= diagonalDistance ? above : upperLeft;
      } else if (filter !== 0) throw new Error(`Unsupported gameplay source PNG filter ${filter}`);
      pixels[y * stride + x] = (raw + predictor) & 255;
    }
    inputOffset += stride;
  }
  if (bytesPerPixel === 4) return { width, height, pixels };
  const rgbaPixels = Buffer.alloc(width * height * 4);
  for (let sourceOffset = 0, targetOffset = 0; sourceOffset < pixels.length; sourceOffset += 3, targetOffset += 4) {
    rgbaPixels[targetOffset] = pixels[sourceOffset];
    rgbaPixels[targetOffset + 1] = pixels[sourceOffset + 1];
    rgbaPixels[targetOffset + 2] = pixels[sourceOffset + 2];
    rgbaPixels[targetOffset + 3] = 255;
  }
  return { width, height, pixels: rgbaPixels };
}

function resizeArea(source, targetWidth, targetHeight) {
  if (source.width * targetHeight !== source.height * targetWidth)
    throw new Error("Store asset source and output aspect ratios must match");
  if (targetWidth > source.width || targetHeight > source.height)
    throw new Error("Area resampling only supports downscaling store assets");

  const target = canvas(targetWidth, targetHeight);
  const area = source.width * source.height;
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceYStart = Math.floor(targetY * source.height / targetHeight);
    const sourceYEnd = Math.ceil((targetY + 1) * source.height / targetHeight);
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceXStart = Math.floor(targetX * source.width / targetWidth);
      const sourceXEnd = Math.ceil((targetX + 1) * source.width / targetWidth);
      const sums = [0, 0, 0, 0];
      for (let sourceY = sourceYStart; sourceY < sourceYEnd; sourceY += 1) {
        const overlapY = Math.min((targetY + 1) * source.height, (sourceY + 1) * targetHeight)
          - Math.max(targetY * source.height, sourceY * targetHeight);
        for (let sourceX = sourceXStart; sourceX < sourceXEnd; sourceX += 1) {
          const overlapX = Math.min((targetX + 1) * source.width, (sourceX + 1) * targetWidth)
            - Math.max(targetX * source.width, sourceX * targetWidth);
          const weight = overlapX * overlapY;
          const sourceOffset = (sourceY * source.width + sourceX) * 4;
          for (let channel = 0; channel < 4; channel += 1)
            sums[channel] += source.pixels[sourceOffset + channel] * weight;
        }
      }
      const targetOffset = (targetY * targetWidth + targetX) * 4;
      for (let channel = 0; channel < 4; channel += 1)
        target.pixels[targetOffset + channel] = Math.round(sums[channel] / area);
    }
  }
  return target;
}

export function generateStoreAssetsV2(root) {
  for (const [relativeSourcePath, expected] of Object.entries(STORE_ASSET_SOURCES)) {
    const sourcePath = `${root}/${relativeSourcePath}`;
    const sourceData = readFileSync(sourcePath);
    const sourceHash = createHash("sha256").update(sourceData).digest("hex");
    if (sourceHash !== expected.sha256)
      throw new Error(`Authoritative store source changed: ${relativeSourcePath}`);
    const source = decodePng(sourceData);
    if (source.width !== expected.width || source.height !== expected.height)
      throw new Error(`Authoritative store source has invalid dimensions: ${relativeSourcePath}`);
    save(`${root}/${expected.output}`, resizeArea(source, expected.outputWidth, expected.outputHeight));
    if (createHash("sha256").update(readFileSync(sourcePath)).digest("hex") !== expected.sha256)
      throw new Error(`Authoritative store source changed during generation: ${relativeSourcePath}`);
  }
  writeFileSync(
    `${root}/com.ulanzi.tictactoe.ulanziPlugin/assets/banner-1.png`,
    readFileSync(`${root}/resources/store/banner-gameplay.png`),
  );
}

function drawScaledImage(target, source, targetX, targetY, scale) {
  for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < source.width; sourceX += 1) {
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const alpha = source.pixels[sourceOffset + 3] / 255;
      const color = [
        source.pixels[sourceOffset],
        source.pixels[sourceOffset + 1],
        source.pixels[sourceOffset + 2],
        255,
      ];
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const px = targetX + sourceX * scale + x;
          const py = targetY + sourceY * scale + y;
          if (alpha === 1) setPixel(target, px, py, color);
          else if (alpha > 0) {
            const targetOffset = (py * target.width + px) * 4;
            setPixel(target, px, py, [
              Math.round(color[0] * alpha + target.pixels[targetOffset] * (1 - alpha)),
              Math.round(color[1] * alpha + target.pixels[targetOffset + 1] * (1 - alpha)),
              Math.round(color[2] * alpha + target.pixels[targetOffset + 2] * (1 - alpha)),
              255,
            ]);
          }
        }
      }
    }
  }
}

export function generateGameplayBannerDraft2(root) {
  const sourcePath = `${root}/assets/${GAMEPLAY_BANNER_SOURCE}`;
  const sourceData = readFileSync(sourcePath);
  const sourceHash = createHash("sha256").update(sourceData).digest("hex");
  if (sourceHash !== GAMEPLAY_BANNER_SOURCE_HASH)
    throw new Error(`Authoritative gameplay screenshot changed: assets/${GAMEPLAY_BANNER_SOURCE}`);
  const source = decodePng(sourceData);
  if (source.width !== 1536 || source.height !== 1024)
    throw new Error("Authoritative gameplay banner must be 1536 x 1024 pixels");

  const banner = resizeArea(source, 1200, 800);

  const outputPath = `${root}/resources/store/banner-gameplay-2.png`;
  save(outputPath, banner);
  writeFileSync(
    `${root}/com.ulanzi.tictactoe.ulanziPlugin/assets/banner-2.png`,
    readFileSync(outputPath),
  );
  const finalSourceHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
  if (finalSourceHash !== GAMEPLAY_BANNER_SOURCE_HASH)
    throw new Error(`Authoritative gameplay screenshot changed during generation: assets/${GAMEPLAY_BANNER_SOURCE}`);
}

export function generateAssets(root) {
  const pluginAssets = `${root}/com.ulanzi.tictactoe.ulanziPlugin/assets`;
  assertApprovedStoreAssets(root);
  generateRuntimeStateAssets(root);
  generateNewGameAssets(root);

  const plugin = canvas(196, 196);
  logo(plugin, 98, 98, 126);
  save(`${pluginAssets}/plugin.png`, plugin);

  for (let position = 0; position < 9; position += 1)
    save(`${pluginAssets}/cell-${position + 1}.png`, placementIcon(position));

  const score = canvas(196, 196);
  text(score, "SCORE", 98, 28, 5, COLORS.white);
  text(score, "X 0", 98, 83, 6, COLORS.cyan);
  text(score, "O 0", 98, 137, 6, COLORS.orange);
  save(`${pluginAssets}/score.png`, score);

  writeFileSync(`${pluginAssets}/banner-1.png`, readFileSync(`${root}/resources/store/banner-gameplay.png`));
  writeFileSync(`${pluginAssets}/banner-2.png`, readFileSync(`${root}/resources/store/banner-gameplay-2.png`));
  assertApprovedStoreAssets(root);
}

if (process.argv[1]
  && fileURLToPath(import.meta.url).replaceAll("\\", "/") === process.argv[1].replaceAll("\\", "/")) {
  const root = fileURLToPath(new URL("../", import.meta.url)).replaceAll("\\", "/").replace(/\/$/, "");
  if (process.argv[2] === "--gameplay-banner-2") {
    withAssetsTreeGuard(root, "gameplay banner generation", () => generateGameplayBannerDraft2(root));
    console.log("Generated the second gameplay banner from the authoritative composited source.");
  } else if (process.argv[2] === "--store-assets-v2") {
    withAssetsTreeGuard(root, "store asset generation", () => generateStoreAssetsV2(root));
    console.log("Generated the v2 cover and gameplay banner from preserved authoritative sources.");
  } else {
    throw new Error("Use --gameplay-banner-2 or --store-assets-v2 for explicit asset regeneration");
  }
}
