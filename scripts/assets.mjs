import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { deflateSync } from "node:zlib";
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

export function generateAssets(root) {
  const pluginAssets = `${root}/com.ulanzi.tictactoe.ulanziPlugin/assets`;
  const storeAssets = `${root}/resources/store`;
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

  const cover = canvas(1200, 600);
  rect(cover, 55, 55, 1090, 490, COLORS.panel);
  logo(cover, 310, 300, 330);
  text(cover, "TIC-TAC-TOE", 825, 205, 11, COLORS.white);
  text(cover, "PLAY ON D200", 825, 345, 10, COLORS.cyan);
  save(`${storeAssets}/cover.png`, cover);

  const banner = canvas(1200, 800);
  rect(banner, 50, 50, 1100, 700, COLORS.panel);
  logo(banner, 350, 400, 430);
  text(banner, "TIC-TAC-TOE", 850, 180, 10, COLORS.white);
  text(banner, "MEDIUM AI", 850, 330, 10, COLORS.cyan);
  text(banner, "SESSION SCORE", 850, 450, 8, COLORS.orange);
  text(banner, "NO SETUP", 850, 565, 9, COLORS.green);
  save(`${storeAssets}/banner-gameplay.png`, banner);
  save(`${pluginAssets}/banner-1.png`, banner);
}
