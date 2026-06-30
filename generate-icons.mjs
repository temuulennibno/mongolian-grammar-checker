// Generates simple, clean PNG icons (no external deps) representing a document
// with a red spell-check underline. Restrained blue + white, no gradients/glow.
import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('icons', { recursive: true });

const BLUE = [37, 92, 184];
const WHITE = [255, 255, 255];
const RED = [229, 57, 53];

function px(buf, w, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}

function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4, 0); // transparent
  const r = Math.round(size * 0.18); // corner radius for rounded square
  const inRound = (x, y) => {
    // rounded-rect mask over the full canvas
    const min = 0, max = size - 1;
    const cx = Math.min(Math.max(x, min + r), max - r);
    const cy = Math.min(Math.max(y, min + r), max - r);
    const dx = x < min + r ? x - (min + r) : x > max - r ? x - (max - r) : 0;
    const dy = y < min + r ? y - (min + r) : y > max - r ? y - (max - r) : 0;
    return dx * dx + dy * dy <= r * r;
  };

  // document inset
  const pad = Math.round(size * 0.24);
  const docL = pad, docR = size - pad, docT = Math.round(size * 0.16), docB = size - Math.round(size * 0.16);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRound(x, y)) continue;
      // base blue tile
      let color = BLUE;
      // white document panel
      if (x >= docL && x < docR && y >= docT && y < docB) color = WHITE;
      px(buf, size, x, y, color);
    }
  }

  // text lines (light gray) + a red underline to suggest spellcheck
  const gray = [200, 200, 205];
  const lineH = Math.max(1, Math.round(size * 0.055));
  const rows = [0.34, 0.5, 0.66];
  rows.forEach((fr, idx) => {
    const y0 = Math.round(size * fr);
    const lx0 = docL + Math.round(size * 0.07);
    const lx1 = docR - Math.round(size * 0.07);
    for (let y = y0; y < y0 + lineH; y++) {
      for (let x = lx0; x < lx1; x++) {
        if (x >= docL && x < docR && y >= docT && y < docB) px(buf, size, x, y, gray);
      }
    }
    // red wavy-ish underline beneath the middle line
    if (idx === 1) {
      const uy = y0 + lineH + Math.max(1, Math.round(size * 0.02));
      for (let x = lx0; x < lx1; x++) {
        const wob = Math.round(Math.sin((x - lx0) * 0.9) * Math.max(1, size * 0.012));
        for (let t = 0; t < lineH; t++) {
          const y = uy + wob + t;
          if (x >= docL && x < docR && y >= docT && y < docB) px(buf, size, x, y, RED);
        }
      }
    }
  });

  return encodePNG(buf, size, size);
}

// Minimal PNG encoder (RGBA, no filtering)
function encodePNG(rgba, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // 10,11,12 = 0 (deflate, default filter, no interlace)

  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = deflateSync(raw);

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

for (const size of [16, 48, 128]) {
  writeFileSync(`icons/icon${size}.png`, makeIcon(size));
  console.log(`icons/icon${size}.png`);
}
