'use strict';

/**
 * PNG 调色板量化器（构建期使用，不随包分发）。
 * ---------------------------------------------------------------
 * 背景：项目只依赖 pngjs，而 pngjs **不支持写出 8 位调色板 PNG**
 * （只支持灰度/RGB/RGBA）。内置形象是 720x900 的卡通贴图，全彩
 * 存储单张 ~344KB、5 张共 1.6MB；量化到 256 色后单张 ~85KB。
 *
 * 本文件自己实现：4 维（R,G,B,A）中位切分量化 + 手写 PNG 编码
 * （IHDR/PLTE/tRNS/IDAT/IEND，自带 CRC32），零外部依赖。
 *
 * 关键设计：
 *   - 完全透明像素 (a===0) 单独占索引 0，不参与量化 —— 否则透明区
 *     可能被平均出非零 alpha，出现方边。
 *   - RGB 按 alpha 加权求簇心（避免半透明像素把颜色拉黑），
 *     alpha 按 count 加权 —— 边缘柔和过渡损失最小。
 *
 * 用法：
 *   const { quantizeToPalettePng } = require('./pngQuantize');
 *   const buf = quantizeToPalettePng(rgbaBuffer, width, height, 256);
 */

const zlib = require('zlib');

/* ------------------------------ CRC32 ------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ------------------------------ PNG 编码 ------------------------------ */

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 把索引图 + 调色板编码成 8 位调色板 PNG。
 * @param {Uint8Array|Buffer} indices 长度 = w*h，每个字节是一个调色板索引
 * @param {Array<{r:number,g:number,b:number,a:number}>} palette 1~256 项
 * @param {number} w
 * @param {number} h
 * @returns {Buffer}
 */
function encodePalettePng(indices, palette, w, h) {
  const n = palette.length;
  if (n < 1 || n > 256) throw new Error('调色板必须 1~256 色，实际 ' + n);
  if (indices.length !== w * h) throw new Error('索引数量与尺寸不符');

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 3;   // color type 3 = indexed
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const plte = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    plte[i * 3] = palette[i].r;
    plte[i * 3 + 1] = palette[i].g;
    plte[i * 3 + 2] = palette[i].b;
  }

  // tRNS：只有存在非 255 的 alpha 时才需要写；末尾连续的 255 可省略
  let lastSemi = -1;
  for (let i = 0; i < n; i++) if (palette[i].a !== 255) lastSemi = i;
  const trns = lastSemi >= 0
    ? Buffer.from(palette.slice(0, lastSemi + 1).map((p) => p.a))
    : null;

  // 扫描线：每行 1 字节 filter(0=None) + w 字节索引
  const raw = Buffer.alloc((w + 1) * h);
  const idx = Buffer.isBuffer(indices) ? indices : Buffer.from(indices);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    idx.copy(raw, y * (w + 1) + 1, y * w, y * w + w);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const parts = [PNG_SIG, chunk('IHDR', ihdr), chunk('PLTE', plte)];
  if (trns) parts.push(chunk('tRNS', trns));
  parts.push(chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/* ------------------------------ 中位切分量化 ------------------------------ */

/**
 * 4 维中位切分。
 * @param {Array<{r,g,b,a,count}>} entries 去重后的颜色条目（不含全透明）
 * @param {number} maxColors
 * @returns {Array<{r,g,b,a,members}>}
 */
function medianCut(entries, maxColors) {
  let buckets = [entries];
  while (buckets.length < maxColors) {
    // 挑 count 最多且还能切的桶
    let bi = -1, best = -1;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (b.length < 2) continue;
      let c = 0;
      for (let j = 0; j < b.length; j++) c += b[j].count;
      if (c > best) { best = c; bi = i; }
    }
    if (bi < 0) break; // 全是单元素桶，切不动了

    const b = buckets[bi];
    // 找跨度最大的通道
    let mn = [255, 255, 255, 255], mx = [0, 0, 0, 0];
    for (let j = 0; j < b.length; j++) {
      const e = b[j];
      const v = [e.r, e.g, e.b, e.a];
      for (let k = 0; k < 4; k++) {
        if (v[k] < mn[k]) mn[k] = v[k];
        if (v[k] > mx[k]) mx[k] = v[k];
      }
    }
    let ch = 0, bestRange = -1;
    for (let k = 0; k < 4; k++) {
      const r = mx[k] - mn[k];
      if (r > bestRange) { bestRange = r; ch = k; }
    }
    const key = ['r', 'g', 'b', 'a'][ch];
    b.sort((x, y) => x[key] - y[key]);

    // 按 count 累计中位切
    let total = 0;
    for (let j = 0; j < b.length; j++) total += b[j].count;
    let acc = 0, split = 1;
    for (let j = 0; j < b.length; j++) {
      acc += b[j].count;
      if (acc * 2 >= total) { split = j + 1; break; }
    }
    if (split <= 0) split = 1;
    if (split >= b.length) split = b.length - 1;

    buckets.splice(bi, 1, b.slice(0, split), b.slice(split));
  }

  // 求簇心
  return buckets.map((b) => {
    let count = 0, alphaSum = 0;
    let wR = 0, wG = 0, wB = 0, wSum = 0;
    for (let j = 0; j < b.length; j++) {
      const e = b[j];
      count += e.count;
      alphaSum += e.a * e.count;
      const w = e.count * Math.max(e.a, 1); // alpha 加权求 RGB 簇心
      wR += e.r * w; wG += e.g * w; wB += e.b * w; wSum += w;
    }
    const rgb = wSum > 0
      ? { r: Math.round(wR / wSum), g: Math.round(wG / wSum), b: Math.round(wB / wSum) }
      : { r: 0, g: 0, b: 0 };
    return {
      r: rgb.r, g: rgb.g, b: rgb.b,
      a: Math.round(alphaSum / count),
      members: b,
    };
  });
}

/**
 * RGBA 像素缓冲 → 256 色调色板 PNG。
 * @param {Buffer|Uint8Array} rgba 长度 = w*h*4
 * @param {number} w
 * @param {number} h
 * @param {number} [maxColors=256]
 * @returns {Buffer} PNG 文件内容
 */
function quantizeToPalettePng(rgba, w, h, maxColors) {
  const limit = Math.min(Math.max(maxColors || 256, 2), 256);

  // 去重统计：key = a*2^24 + r*2^16 + g*2^8 + b
  const map = new Map();
  let transparentCount = 0;
  const total = w * h;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2], a = rgba[o + 3];
    if (a === 0) { transparentCount++; continue; }
    const key = a * 16777216 + r * 65536 + g * 256 + b;
    const e = map.get(key);
    if (e) e.count++;
    else map.set(key, { r, g, b, a, count: 1 });
  }

  const entries = Array.from(map.values());
  // 透明占索引 0，剩余色位给非透明像素
  const buckets = entries.length
    ? medianCut(entries, Math.max(limit - 1, 1))
    : [];

  const palette = [{ r: 0, g: 0, b: 0, a: 0 }]; // 索引 0 = 全透明
  for (const bk of buckets) {
    const pi = palette.length;
    for (const e of bk.members) e._pi = pi;
    palette.push({ r: bk.r, g: bk.g, b: bk.b, a: bk.a });
  }

  const indices = Buffer.alloc(total);
  if (buckets.length === 0 && transparentCount === total) {
    // 整张全透明：indices 全 0，palette 只有透明项
  } else {
    for (let i = 0; i < total; i++) {
      const o = i * 4;
      const a = rgba[o + 3];
      if (a === 0) { indices[i] = 0; continue; }
      const key = a * 16777216 + rgba[o] * 65536 + rgba[o + 1] * 256 + rgba[o + 2];
      const e = map.get(key);
      indices[i] = e && e._pi !== undefined ? e._pi : 0;
    }
  }

  return encodePalettePng(indices, palette, w, h);
}

module.exports = { quantizeToPalettePng, encodePalettePng, medianCut, crc32 };
