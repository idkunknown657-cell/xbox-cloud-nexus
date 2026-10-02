// Generates all application icons from the "Nexus" mark: an original design —
// three intersecting orbital rings around a play-triangle core.
// Pure Node (zlib), no image dependencies. Output: build/icon.ico + PNGs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG, canvas, px, ring, circle, roundRect, resize } from './lib/png.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const buildDir = path.join(root, 'build');
fs.mkdirSync(buildDir, { recursive: true });

const GREEN = [0x6c, 0xd8, 0x50];   // nexus green (original tone)
const DARK  = [0x0d, 0x16, 0x11];

/** Draw the Nexus mark into an s-size canvas. */
function drawMark(s) {
  const img = canvas(s, s);
  const cx = s / 2, cy = s / 2;
  const scale = s / 256;

  // Rounded dark tile background for sizes >= 64 (transparent elsewhere)
  if (s >= 64) {
    roundRect(img, 0, 0, s, s, Math.round(56 * scale), DARK[0], DARK[1], DARK[2], 255, Math.max(1, 2 * scale));
    for (let i = 0; i < 24; i++) {
      const rr = 128 * scale - i * (110 * scale / 24);
      ring(img, cx, cy, rr, 110 * scale / 24 + 1, 0x08, 0x12, 0x0d, Math.round(24 - i));
    }
  }

  // Three orbital rings
  const r1 = 86 * scale, r2 = 64 * scale, r3 = 74 * scale;
  const th = 9 * scale;
  ring(img, cx, cy, r1, th, GREEN[0], GREEN[1], GREEN[2], 235, null, Math.max(1, 1.4 * scale));
  ring(img, cx - 6 * scale, cy + 2 * scale, r2, th * 0.9, 0x9f, 0xe8, 0x7a, 205, [-2.6, 0.6], Math.max(1, 1.4 * scale));
  ring(img, cx + 6 * scale, cy - 2 * scale, r3, th * 0.9, 0x3f, 0xa8, 0x5c, 205, [0.5, 3.7], Math.max(1, 1.4 * scale));

  // orbit nodes
  circle(img, cx + r1 * Math.cos(-0.9), cy + r1 * Math.sin(-0.9), 6.5 * scale, 0xd8, 0xff, 0xc2, 255);
  circle(img, cx - 6 * scale + r2 * Math.cos(0.6), cy + 2 * scale + r2 * Math.sin(0.6), 5 * scale, 0x9f, 0xe8, 0x7a, 255);

  // Play-triangle core with soft glow
  for (let g = 6; g > 0; g--) {
    const gr = (14 + g * 7) * scale;
    ring(img, cx, cy, gr - 10 * scale, 11 * scale, GREEN[0], GREEN[1], GREEN[2], Math.round(8 + (6 - g) * 6));
  }
  const r = 46 * scale;
  const h = r * Math.sqrt(3) / 2;
  const p = [
    [cx + r * 0.72, cy],
    [cx - r * 0.45, cy - h * 0.62],
    [cx - r * 0.45, cy + h * 0.62],
  ];
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const [ax, ay] = p[0], [bx, by] = p[1], [qx, qy] = p[2];
      const d = (bx - ax) * (qy - ay) - (qx - ax) * (by - ay);
      const u = ((x + 0.5 - ax) * (qy - ay) - (qx - ax) * (y + 0.5 - ay)) / d;
      const v = ((bx - ax) * (y + 0.5 - ay) - (x + 0.5 - ax) * (by - ay)) / d;
      const w = 1 - u - v;
      if (u >= -0.02 && v >= -0.02 && w >= -0.02) {
        const cov = Math.min(1, (Math.min(u, v, w) + 0.02) / 0.02);
        px(img, x, y, 0xe4, 0xff, 0xd1, Math.round(255 * cov));
      }
    }
  }
  return img;
}

// ---- ICO container (multi-size BMP entries) ----
function bmpFromPNG(img) {
  const { w, h, data } = img;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(w, 4);
  header.writeInt32LE(h * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);          // BI_RGB
  header.writeUInt32LE(w * h * 4, 20);
  const xor = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4, di = ((h - 1 - y) * w + x) * 4;
      xor[di] = data[si + 2]; xor[di + 1] = data[si + 1]; xor[di + 2] = data[si]; xor[di + 3] = data[si + 3];
    }
  }
  const andMask = Buffer.alloc(Math.ceil(w / 32) * 4 * h);
  return Buffer.concat([header, xor, andMask]);
}

function buildICO(sizes) {
  const imgs = sizes.map((s) => ({ s, img: drawMark(s) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(imgs.length, 4);
  let offset = 6 + 16 * imgs.length;
  const dir = Buffer.alloc(16 * imgs.length);
  const bodies = [];
  imgs.forEach(({ s, img }, i) => {
    const body = bmpFromPNG(img);
    const o = i * 16;
    dir[o] = s >= 256 ? 0 : s;
    dir[o + 1] = s >= 256 ? 0 : s;
    dir[o + 4] = 1; dir[o + 6] = 32;
    dir.writeUInt32LE(body.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += body.length;
    bodies.push(body);
  });
  return Buffer.concat([header, dir, ...bodies]);
}

fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildICO([16, 24, 32, 48, 64, 128, 256]));
for (const s of [16, 24, 32, 48, 64, 128, 256, 512]) {
  const img = drawMark(s);
  fs.writeFileSync(path.join(buildDir, `icon-${s}.png`), encodePNG(img.w, img.h, img.data));
}
const master = drawMark(2048);
fs.writeFileSync(path.join(buildDir, 'icon-1024.png'), encodePNG(1024, 1024, resize(master, 1024, 1024).data));

console.log('Icons written to build/: icon.ico + 16..512 PNGs + 1024 master');
