import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

export const STATE_SOURCE_FILES = Object.freeze({
  empty: "blank.png",
  X: "cross.png",
  O: "circle.png",
});

export const STATE_RUNTIME_FILES = Object.freeze({
  empty: "blank-runtime.png",
  X: "cross-runtime.png",
  O: "circle-runtime.png",
});

export const STATE_SOURCE_HASHES = Object.freeze({
  "blank.png": "23461db6ccef6f1add01b6ad56a5333b766ced4df72a67896ea40901d7d1206d",
  "cross.png": "9b5140fa6b828ab3f8a9af3caab9382d677af531e7e9cb96e9a008855b0e81f8",
  "circle.png": "9bfed5e2817f77744c2f8921c234edbab05effa2bba46432cb6d80575a9193d7",
});

export const RUNTIME_STATE_DIMENSION = 196;

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

function decodeRgbPng(data) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!data.subarray(0, 8).equals(signature)) throw new Error("State source is not a PNG");
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
      throw new Error(`Invalid PNG ${type} checksum`);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 2 || body[10] !== 0 || body[11] !== 0 || body[12] !== 0)
        throw new Error("State source must be an 8-bit, non-interlaced RGB PNG");
    } else if (type === "IDAT") {
      compressed.push(body);
    }
    offset += length + 12;
  }
  if (!width || !height || compressed.length === 0) throw new Error("State source PNG is incomplete");

  const encoded = inflateSync(Buffer.concat(compressed));
  const stride = width * 3;
  if (encoded.length !== (stride + 1) * height) throw new Error("Unexpected state source scanline size");
  const pixels = Buffer.alloc(stride * height);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = encoded[inputOffset];
    inputOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = encoded[inputOffset + x];
      const left = x >= 3 ? pixels[y * stride + x - 3] : 0;
      const above = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= 3 ? pixels[(y - 1) * stride + x - 3] : 0;
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
      } else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
      pixels[y * stride + x] = (raw + predictor) & 255;
    }
    inputOffset += stride;
  }
  return { width, height, pixels };
}

function resizeRgb(image, width, height) {
  const output = Buffer.alloc(width * height * 3);
  for (let dy = 0; dy < height; dy += 1) {
    const sourceYStart = dy * image.height;
    const sourceYEnd = (dy + 1) * image.height;
    const firstY = Math.floor(sourceYStart / height);
    const lastY = Math.ceil(sourceYEnd / height);
    for (let dx = 0; dx < width; dx += 1) {
      const sourceXStart = dx * image.width;
      const sourceXEnd = (dx + 1) * image.width;
      const firstX = Math.floor(sourceXStart / width);
      const lastX = Math.ceil(sourceXEnd / width);
      const totals = [0, 0, 0];
      for (let sy = firstY; sy < lastY; sy += 1) {
        const yWeight = Math.min(sourceYEnd, (sy + 1) * height) - Math.max(sourceYStart, sy * height);
        for (let sx = firstX; sx < lastX; sx += 1) {
          const xWeight = Math.min(sourceXEnd, (sx + 1) * width) - Math.max(sourceXStart, sx * width);
          const weight = xWeight * yWeight;
          const sourceOffset = (sy * image.width + sx) * 3;
          totals[0] += image.pixels[sourceOffset] * weight;
          totals[1] += image.pixels[sourceOffset + 1] * weight;
          totals[2] += image.pixels[sourceOffset + 2] * weight;
        }
      }
      const outputOffset = (dy * width + dx) * 3;
      const totalWeight = image.width * image.height;
      output[outputOffset] = Math.round(totals[0] / totalWeight);
      output[outputOffset + 1] = Math.round(totals[1] / totalWeight);
      output[outputOffset + 2] = Math.round(totals[2] / totalWeight);
    }
  }
  return output;
}

function encodeIndexedPng(pixels, width, height) {
  const palette = Buffer.alloc(216 * 3);
  for (let red = 0; red < 6; red += 1) {
    for (let green = 0; green < 6; green += 1) {
      for (let blue = 0; blue < 6; blue += 1) {
        const index = red * 36 + green * 6 + blue;
        palette[index * 3] = Math.round(red * 255 / 5);
        palette[index * 3 + 1] = Math.round(green * 255 / 5);
        palette[index * 3 + 2] = Math.round(blue * 255 / 5);
      }
    }
  }
  const scanlines = [];
  for (let y = 0; y < height; y += 1) {
    scanlines.push(Buffer.from([0]));
    const row = Buffer.alloc(width);
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const red = Math.round(pixels[offset] * 5 / 255);
      const green = Math.round(pixels[offset + 1] * 5 / 255);
      const blue = Math.round(pixels[offset + 2] * 5 / 255);
      row[x] = red * 36 + green * 6 + blue;
    }
    scanlines.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 3, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("PLTE", palette),
    chunk("IDAT", deflateSync(Buffer.concat(scanlines), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function optimizeRuntimeStatePng(source) {
  const image = decodeRgbPng(source);
  const pixels = resizeRgb(image, RUNTIME_STATE_DIMENSION, RUNTIME_STATE_DIMENSION);
  return encodeIndexedPng(pixels, RUNTIME_STATE_DIMENSION, RUNTIME_STATE_DIMENSION);
}

export function assertSourceStateAssets(root) {
  for (const filename of Object.values(STATE_SOURCE_FILES)) {
    const source = readFileSync(`${root}/assets/${filename}`);
    const hash = createHash("sha256").update(source).digest("hex");
    if (hash !== STATE_SOURCE_HASHES[filename])
      throw new Error(`User-supplied source artwork changed: assets/${filename}`);
  }
}

export function generateRuntimeStateAssets(root) {
  assertSourceStateAssets(root);
  for (const [state, filename] of Object.entries(STATE_SOURCE_FILES)) {
    const outputPath = `${root}/com.ulanzi.tictactoe.ulanziPlugin/assets/${STATE_RUNTIME_FILES[state]}`;
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, optimizeRuntimeStatePng(readFileSync(`${root}/assets/${filename}`)));
  }
}
