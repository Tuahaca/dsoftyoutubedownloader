// Generates the extension's PNG icons (red rounded square + white download arrow) with no
// dependencies. Run with `npm run icons`; output is committed in packages/extension/public/icons.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../packages/extension/public/icons/', import.meta.url);
const BG = [229, 50, 45];
const FG = [255, 255, 255];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function inRoundedRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function inTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const s = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = s(x, y, ax, ay, bx, by);
  const d2 = s(x, y, bx, by, cx, cy);
  const d3 = s(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
function inArrow(x, y) {
  const stem = x >= 0.42 && x <= 0.58 && y >= 0.17 && y <= 0.5;
  const head = inTriangle(x, y, [0.22, 0.46], [0.78, 0.46], [0.5, 0.74]);
  const bar = x >= 0.22 && x <= 0.78 && y >= 0.8 && y <= 0.88;
  return stem || head || bar;
}

function render(size) {
  const SS = 4; // 4x4 supersampling for anti-aliasing
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0 + RGBA
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (!inRoundedRect(x, y, 0.22)) continue;
          if (inArrow(x, y)) fg++;
          else bg++;
        }
      }
      const total = SS * SS;
      const alpha = (bg + fg) / total;
      const mix = fg + bg > 0 ? fg / (fg + bg) : 0;
      const o = 1 + px * 4;
      for (let i = 0; i < 3; i++) row[o + i] = Math.round(BG[i] * (1 - mix) + FG[i] * mix);
      row[o + 3] = Math.round(alpha * 255);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(new URL(`icon-${size}.png`, OUT), render(size));
  console.log(`icon-${size}.png`);
}
