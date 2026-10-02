// Minimal PNG encoder (truecolor + alpha) — pure Node, no dependencies.
// Produces valid PNGs via crc32 + zlib deflate of filtered scanlines.
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Encode RGBA pixels into a PNG.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba  length = width*height*4
 */
export function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** Create a blank RGBA canvas. */
export function canvas(w, h) {
  return { w, h, data: new Uint8Array(w * h * 4) };
}

/** Set pixel with alpha blend. */
export function px(img, x, y, r, g, b, a) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= img.w || y >= img.h || a <= 0) return;
  const i = (y * img.w + x) * 4;
  const sa = a / 255;
  const da = img.data[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) { img.data[i] = img.data[i+1] = img.data[i+2] = img.data[i+3] = 0; return; }
  img.data[i]   = Math.round((r * sa + img.data[i]   * da * (1 - sa)) / oa);
  img.data[i+1] = Math.round((g * sa + img.data[i+1] * da * (1 - sa)) / oa);
  img.data[i+2] = Math.round((b * sa + img.data[i+2] * da * (1 - sa)) / oa);
  img.data[i+3] = Math.round(oa * 255);
}

/** Anti-aliased ring (annulus) stroke, optional arc range in radians. */
export function ring(img, cx, cy, radius, thickness, r, g, b, a, arc = null, soft = 1.2) {
  const x0 = Math.max(0, Math.floor(cx - radius - thickness / 2 - soft));
  const x1 = Math.min(img.w - 1, Math.ceil(cx + radius + thickness / 2 + soft));
  const y0 = Math.max(0, Math.floor(cy - radius - thickness / 2 - soft));
  const y1 = Math.min(img.h - 1, Math.ceil(cy + radius + thickness / 2 + soft));
  const outer = radius + thickness / 2, inner = radius - thickness / 2;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > outer + soft || d < inner - soft) continue;
      let cov;
      if (d >= outer) cov = 1 - (d - outer) / soft;
      else if (d <= inner) cov = 1 - (inner - d) / soft;
      else cov = 1;
      if (arc) {
        const ang = Math.atan2(dy, dx); // -PI..PI
        const [a0, a1] = arc;
        const inArc = a0 <= a1 ? (ang >= a0 && ang <= a1) : (ang >= a0 || ang <= a1);
        if (!inArc) continue;
      }
      px(img, x, y, r, g, b, Math.round(a * Math.max(0, Math.min(1, cov))));
    }
  }
}

/** Anti-aliased filled circle. */
export function circle(img, cx, cy, radius, r, g, b, a, soft = 1.2) {
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(img.w - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(img.h - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d <= radius - soft) px(img, x, y, r, g, b, a);
    else if (d <= radius + soft) px(img, x, y, r, g, b, Math.round(a * (1 - (d - radius) / (2 * soft))));
  }
}

/** Anti-aliased rounded rectangle (filled). */
export function roundRect(img, x0, y0, w, h, rad, r, g, b, a, soft = 1) {
  for (let y = Math.max(0, y0 - 1); y <= Math.min(img.h - 1, y0 + h + 1); y++) {
    for (let x = Math.max(0, x0 - 1); x <= Math.min(img.w - 1, x0 + w + 1); x++) {
      const pxc = x + 0.5, pyc = y + 0.5;
      if (pxc < x0 || pxc > x0 + w || pyc < y0 || pyc > y0 + h) continue;
      const inX = pxc - x0, inY = pyc - y0;
      let dx = 0, dy = 0;
      if (inX < rad && inY < rad) { dx = rad - inX; dy = rad - inY; }
      else if (inX > w - rad && inY < rad) { dx = inX - (w - rad); dy = rad - inY; }
      else if (inX < rad && inY > h - rad) { dx = rad - inX; dy = inY - (h - rad); }
      else if (inX > w - rad && inY > h - rad) { dx = inX - (w - rad); dy = inY - (h - rad); }
      const d = Math.hypot(dx, dy);
      let cov = d <= rad - soft ? 1 : d <= rad + soft ? 1 - (d - rad) / (2 * soft) : 0;
      cov = Math.max(0, Math.min(1, cov));
      if (cov > 0) px(img, x, y, r, g, b, Math.round(a * cov));
    }
  }
}

/** High-quality box-filter downscale (RGBA). */
export function resize(src, dw, dh) {
  const out = new Uint8Array(dw * dh * 4);
  const sx = src.w / dw, sy = src.h / dh;
  for (let y = 0; y < dh; y++) {
    const fy0 = y * sy, fy1 = (y + 1) * sy;
    for (let x = 0; x < dw; x++) {
      const fx0 = x * sx, fx1 = (x + 1) * sx;
      let r = 0, g = 0, b = 0, a = 0, cnt = 0;
      for (let yy = Math.floor(fy0); yy < Math.min(src.h, Math.ceil(fy1)); yy++) {
        const wy = Math.min(yy + 1, fy1) - Math.max(yy, fy0);
        if (wy <= 0) continue;
        for (let xx = Math.floor(fx0); xx < Math.min(src.w, Math.ceil(fx1)); xx++) {
          const wx = Math.min(xx + 1, fx1) - Math.max(xx, fx0);
          if (wx <= 0) continue;
          const wgt = wx * wy;
          const i = (yy * src.w + xx) * 4;
          r += src.data[i] * wgt; g += src.data[i+1] * wgt; b += src.data[i+2] * wgt; a += src.data[i+3] * wgt;
          cnt += wgt;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = Math.round(r / cnt); out[o+1] = Math.round(g / cnt);
      out[o+2] = Math.round(b / cnt); out[o+3] = Math.round(a / cnt);
    }
  }
  return { w: dw, h: dh, data: out };
}
