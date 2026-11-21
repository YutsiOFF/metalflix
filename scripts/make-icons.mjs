// Generates the home-screen icons (PNG) from the same M as favicon.svg.
//
// No image library: the shapes are rasterised here and the PNG is assembled by
// hand, so the repository keeps zero build-time dependencies for its icons.
//
// Usage: node scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join("public", "icons");
const BACKGROUND = [11, 11, 13];
const FOREGROUND = [229, 9, 20];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Distance from a point to a segment, in normalised units. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The M of the wordmark: two stems and two diagonals, inside 0..1. */
function inGlyph(x, y) {
  if (y < 0.26 || y > 0.74) return false;
  if ((x >= 0.24 && x <= 0.35) || (x >= 0.65 && x <= 0.76)) return true;
  return segmentDistance(x, y, 0.295, 0.27, 0.5, 0.54) < 0.055 || segmentDistance(x, y, 0.705, 0.27, 0.5, 0.54) < 0.055;
}

/** `scale` shrinks the glyph: maskable icons need it inside the safe zone. */
function draw(size, scale) {
  const rgba = Buffer.alloc(size * size * 4);
  const margin = (1 - scale) / 2;
  const samples = 3;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const u = (x + (sx + 0.5) / samples) / size;
          const v = (y + (sy + 0.5) / samples) / size;
          if (inGlyph((u - margin) / scale, (v - margin) / scale)) hits += 1;
        }
      }
      const alpha = hits / (samples * samples);
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        rgba[offset + channel] = Math.round(BACKGROUND[channel] + (FOREGROUND[channel] - BACKGROUND[channel]) * alpha);
      }
      rgba[offset + 3] = 255;
    }
  }
  return encodePng(size, rgba);
}

mkdirSync(OUT, { recursive: true });

const ICONS = [
  ["icon-192.png", 192, 0.86],
  ["icon-512.png", 512, 0.86],
  ["icon-maskable-512.png", 512, 0.66],
  ["apple-touch-icon.png", 180, 0.86],
];

for (const [name, size, scale] of ICONS) {
  writeFileSync(join(OUT, name), draw(size, scale));
  console.log(`${name.padEnd(24)} ${size}×${size}`);
}
