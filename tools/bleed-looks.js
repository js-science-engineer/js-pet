'use strict';

/**
 * 内置形象边缘清洗 + 体积压缩：对已归一化的成品 PNG 原地处理。
 *
 * 做两件事：
 *   1) 边缘颜色回渗 —— 绿幕抠图后边缘半透明像素的 RGB 残留
 *      "角色×背景"混合脏色（实测边缘平均 RGB≈82，本体≈172）。
 *      浏览器把 720px 贴图缩到 ~150px 显示时按 alpha 预乘采样，
 *      脏色被一起混进去 —— 浅色壁纸上表现为一圈发暗发脏的边。
 *   2) 调色板量化到 256 色 —— 全彩存储单张 ~344KB，量化后 ~85KB。
 *      必须与回渗在同一步完成：否则单独跑回渗会用全彩写回、
 *      把体积重新涨回去（曾发生过）。
 *
 * 用法：
 *   node tools/bleed-looks.js                      # 处理 src/renderer/pet/looks/*.png
 *   node tools/bleed-looks.js <图片路径...>        # 处理指定图片
 *   node tools/bleed-looks.js --dry-run [图片...]  # 只统计，不写回
 *   node tools/bleed-looks.js --no-quant [图片...] # 回渗但不量化（保留全彩）
 *
 * 回渗只改半透明边缘像素的 RGB，不动 alpha —— 轮廓、柔和过渡保持原样。
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const K = require('../src/shared/keying.js');
const { quantizeToPalettePng } = require('./pngQuantize.js');

const LOOKS_DIR = path.join(__dirname, '..', 'src', 'renderer', 'pet', 'looks');

/** 统计"脏边"：半透明且明显偏暗/偏绿的边缘像素数 */
function dirtyEdges(data, w, h) {
  let semi = 0, dark = 0, green = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4, a = data[o + 3];
    if (a === 0 || a >= 250) continue;
    semi++;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    if (r + g + b < 330) dark++;                 // 偏暗
    if (g - r > 18 && g - b > 18) green++;       // 偏绿
  }
  return { semi, dark, green };
}

const kb = (n) => (n / 1024).toFixed(0) + 'KB';

function processFile(file, dryRun, quantize) {
  const bytesBefore = fs.statSync(file).size;
  const png = PNG.sync.read(fs.readFileSync(file));
  const before = dirtyEdges(png.data, png.width, png.height);
  const fixed = K.edgeColorBleed(png.data, png.width, png.height);
  const after = dirtyEdges(png.data, png.width, png.height);

  let bytesAfter = bytesBefore;
  if (!dryRun) {
    const buf = quantize
      ? quantizeToPalettePng(png.data, png.width, png.height, 256)
      : PNG.sync.write(png);
    fs.writeFileSync(file, buf);
    bytesAfter = buf.length;
  }

  console.log(
    `${path.basename(file).padEnd(10)} ` +
    `回渗=${String(fixed).padStart(5)}px  ` +
    `脏边 ${before.dark + before.green} → ${after.dark + after.green}` +
    ` (暗 ${before.dark}→${after.dark}, 绿 ${before.green}→${after.green})  ` +
    `体积 ${kb(bytesBefore)} → ${dryRun ? '(dry-run)' : kb(bytesAfter)}` +
    (dryRun && !quantize ? '' : '')
  );
  return { before, after, fixed, bytesBefore, bytesAfter };
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const quantize = !args.includes('--no-quant');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  files.push(...fs.readdirSync(LOOKS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => path.join(LOOKS_DIR, f)));
}
if (!files.length) {
  console.error('没有找到可处理的 PNG');
  process.exit(2);
}

let total = 0, sizeBefore = 0, sizeAfter = 0;
for (const f of files) {
  const r = processFile(f, dryRun, quantize);
  total += r.fixed;
  sizeBefore += r.bytesBefore;
  sizeAfter += r.bytesAfter;
}
if (dryRun) {
  console.log(`[dry-run] 共需回渗 ${total} 像素`);
} else {
  console.log(`完成：回渗 ${total} 像素，合计体积 ${kb(sizeBefore)} → ${kb(sizeAfter)}`);
}
