import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import { generateRuntimeStateAssets } from "./state-assets.mjs";
import { generateNewGameAssets } from "./new-game-assets.mjs";

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
export const GAMEPLAY_BANNER_SOURCE_HASH = "e5ba391bab00e695763fc8034b72fbe6df113296a2ca5521842b3c10599f225f";
export const APPROVED_STORE_ASSETS = Object.freeze({
  "resources/store/cover.png": Object.freeze({
    width: 1200,
    height: 600,
    sha256: "cce7be752f789f15c8a42366c142d490cd5072b5665de424075f3df3c6183d79",
  }),
  "resources/store/banner-gameplay.png": Object.freeze({
    width: 1200,
    height: 800,
    sha256: "7fdf39bc92e14a8192ce37b2fee300ae6ea1df7444399cbe7c50fb04951a18bc",
  }),
  "resources/store/banner-gameplay-2.png": Object.freeze({
    width: 1200,
    height: 800,
    sha256: "16fc9d8f70bd97ca881e427338c4329c579ec89a0caa4e3d3a337590992a77e8",
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

function decodeRgbaPng(data) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!data.subarray(0, 8).equals(signature)) throw new Error("Gameplay banner source is not a PNG");
  let offset = 8;
  let width;
  let height;
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
      if (body[8] !== 8 || body[9] !== 6 || body[10] !== 0 || body[11] !== 0 || body[12] !== 0)
        throw new Error("Gameplay banner source must be an 8-bit, non-interlaced RGBA PNG");
    } else if (type === "IDAT") {
      compressed.push(body);
    }
    offset += length + 12;
  }
  if (!width || !height || compressed.length === 0)
    throw new Error("Gameplay banner source PNG is incomplete");

  const encoded = inflateSync(Buffer.concat(compressed));
  const stride = width * 4;
  if (encoded.length !== (stride + 1) * height)
    throw new Error("Unexpected gameplay banner source scanline size");
  const pixels = Buffer.alloc(stride * height);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = encoded[inputOffset];
    inputOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = encoded[inputOffset + x];
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const above = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
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
  return { width, height, pixels };
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
  const source = decodeRgbaPng(sourceData);
  if (source.width !== 460 || source.height !== 281)
    throw new Error("Authoritative gameplay screenshot must be 460 x 281 pixels");

  const banner = canvas(1200, 800);
  rect(banner, 50, 50, 1100, 700, COLORS.panel);
  text(banner, "PLAY ON D200", 600, 65, 9, COLORS.white);
  text(banner, "VS MACHINE", 250, 140, 4, COLORS.cyan);
  text(banner, "X OR O", 600, 140, 4, COLORS.orange);
  text(banner, "SESSION SCORE", 950, 140, 4, COLORS.green);
  rect(banner, 132, 172, 936, 578, COLORS.cyan);
  rect(banner, 136, 176, 928, 570, COLORS.panel);
  drawScaledImage(banner, source, 140, 180, 2);

  const outputPath = `${root}/resources/store/banner-gameplay-2.png`;
  save(outputPath, banner);
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
  if (process.argv[2] !== "--gameplay-banner-2")
    throw new Error("Use --gameplay-banner-2 to generate the review draft without rebuilding approved assets");
  const root = fileURLToPath(new URL("../", import.meta.url)).replaceAll("\\", "/").replace(/\/$/, "");
  generateGameplayBannerDraft2(root);
  console.log("Generated resources/store/banner-gameplay-2.png without rebuilding approved assets.");
}
