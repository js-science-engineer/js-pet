'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const K = require('../src/shared/keying');

/** 造一张 w*h 的 RGBA 图，fn(x,y) 返回 [r,g,b,a] */
function makeImage(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      const i = (y * w + x) * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = c[3];
    }
  }
  return { data, width: w, height: h };
}

const GREEN = [40, 130, 50, 255];
const RED = [200, 60, 60, 255];
const GRAY = [233, 230, 228, 255];

test('M4 · isBgGreen / isBgNeutral 判定', () => {
  const d = [...GREEN, ...RED, ...GRAY, ...[195, 219, 221, 255]];
  assert.equal(K.isBgGreen(d, 0), true, '绿幕是背景');
  assert.equal(K.isBgGreen(d, 4), false, '红色角色不是背景');
  assert.equal(K.isBgGreen(d, 8), false, '浅灰不是绿幕背景');
  assert.equal(K.isBgNeutral(d, 8, 9), true, '浅灰在饱和度阈值内是背景');
  assert.equal(K.isBgNeutral(d, 4, 9), false, '红色饱和度高，不是背景');
  assert.equal(K.isBgNeutral(d, 12, 9), false, '淡蓝色（sat=26）不是背景');
});

test('M4 · detectBackground 自动识别绿幕与中性背景', () => {
  const g = makeImage(20, 20, () => GREEN);
  assert.equal(K.detectBackground(g.data, 20, 20).mode, 'green');

  const n = makeImage(20, 20, () => GRAY);
  assert.equal(K.detectBackground(n.data, 20, 20).mode, 'neutral');
});

test('M4 · 绿幕抠图：角色完整保留、背景清空、无漏抠', () => {
  const img = makeImage(40, 40, (x, y) => {
    const inBox = x >= 10 && x < 30 && y >= 10 && y < 34;
    return inBox ? RED : GREEN;
  });
  const r = K.keyOut(img.data, 40, 40, { mode: 'green' });
  assert.ok(r.eaten > 0);
  assert.equal(r.mode, 'green');
  // 角色内部不透明
  const center = (20 * 40 + 20) * 4;
  assert.equal(img.data[center + 3], 255);
  // 四角已透明
  assert.equal(img.data[3], 0);
  assert.equal(K.missedBackgroundCount(img.data, 40, 40, { mode: 'green' }), 0);
});

test('M4 · 中性背景抠图：淡色角色不会被误判（sat 阈值默认 9）', () => {
  // 背景 sat=5，角色主体 sat=26（淡蓝）——这正是实际素材的情况
  const img = makeImage(40, 40, (x, y) => {
    const inBox = x >= 10 && x < 30 && y >= 10 && y < 34;
    return inBox ? [195, 219, 221, 255] : GRAY;
  });
  K.keyOut(img.data, 40, 40, { mode: 'neutral' });
  const center = (20 * 40 + 20) * 4;
  assert.equal(img.data[center + 3], 255, '角色主体必须保留');
  assert.equal(img.data[3], 0, '背景必须清空');
});

test('M4 · 漏抠统计：被角色圈住的绿幕残留要能被发现', () => {
  const img = makeImage(40, 40, (x, y) => {
    const inBox = x >= 10 && x < 30 && y >= 10 && y < 30;
    const inHole = x >= 15 && x < 25 && y >= 15 && y < 25;
    if (inHole) return GREEN;    // 角色内部藏了一块没抠掉的绿幕
    return inBox ? RED : GREEN;
  });
  K.keyOut(img.data, 40, 40, { mode: 'green' });
  const miss = K.missedBackgroundCount(img.data, 40, 40, { mode: 'green' });
  assert.equal(miss, 100, '10x10 的漏抠绿幕必须被统计到');
});

test('M4 · 漏抠统计：抠干净的图为 0', () => {
  const img = makeImage(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 10 && y < 34 ? RED : GREEN));
  K.keyOut(img.data, 40, 40, { mode: 'green' });
  assert.equal(K.missedBackgroundCount(img.data, 40, 40, { mode: 'green' }), 0);
});

test('M4 · despeckle 清掉碎片、保留主体', () => {
  const img = makeImage(40, 40, (x, y) => {
    const inBox = x >= 10 && x < 30 && y >= 10 && y < 34;
    const speck = x >= 36 && x < 38 && y >= 2 && y < 4;
    return (inBox || speck) ? RED : GREEN;
  });
  K.keyOut(img.data, 40, 40, { mode: 'green' });
  const removed = K.despeckle(img.data, 40, 40);
  assert.ok(removed > 0, '应清掉至少一个碎片');
  const center = (20 * 40 + 20) * 4;
  assert.equal(img.data[center + 3], 255, '主体保留');
  const speck = (3 * 40 + 37) * 4;
  assert.equal(img.data[speck + 3], 0, '碎片被清掉');
});

test('M4 · feather 只软化"半透明边缘"，不动全透明与不透明像素', () => {
  // 外圈全透明 / 一圈半透明(128) / 内部不透明
  const img = makeImage(21, 21, (x, y) => {
    if (x >= 6 && x < 15 && y >= 6 && y < 15) return [200, 60, 60, 255];
    if (x >= 5 && x < 16 && y >= 5 && y < 16) return [200, 60, 60, 128];
    return [0, 0, 0, 0];
  });
  const before = img.data[(5 * 21 + 5) * 4 + 3];
  K.feather(img.data, 21, 21);
  const core = (10 * 21 + 10) * 4;
  assert.equal(img.data[core + 3], 255, '主体核心 alpha 不变');
  const after = img.data[(5 * 21 + 5) * 4 + 3];
  assert.notEqual(after, before, '半透明边缘应被平滑');
  assert.ok(after > 0 && after < 255, `软化后 alpha 应在 (0,255)，实际 ${after}`);
});

test('M4 · bbox 计算前景包围盒', () => {
  const img = makeImage(40, 40, (x, y) => (x >= 10 && x < 25 && y >= 5 && y < 20 ? RED : [0, 0, 0, 0]));
  const b = K.bbox(img.data, 40, 40);
  assert.deepEqual({ x0: b.x0, y0: b.y0, w: b.w, h: b.h }, { x0: 10, y0: 5, w: 15, h: 15 });
  assert.equal(K.bbox(makeImage(4, 4, () => [0, 0, 0, 0]).data, 4, 4), null);
});

test('M4 · transparentRatio', () => {
  const img = makeImage(10, 10, (x, y) => (y < 5 ? [0, 0, 0, 0] : RED));
  assert.equal(K.transparentRatio(img.data, 10, 10), 0.5);
});

/* ---------------- despill 绿色去污（M4b） ---------------- */

test('M4b · despill 把绿污染压回中性（g ≤ max(r,b)）', () => {
  const w = 2, h = 1;
  const data = new Uint8Array([36, 90, 31, 255, 20, 120, 18, 255]); // 两个绿污染像素
  const n = K.despill(data, w, h);
  assert.equal(n, 2);
  assert.ok(data[1] <= Math.max(data[0], data[2]) + 0); // g 压到 cap
  assert.ok(data[5] <= Math.max(data[4], data[6]) + 0);
  // 不再满足绿色判据
  assert.equal(K.isBgGreen(data, 0), false);
  assert.equal(K.isBgGreen(data, 4), false);
});

test('M4b · despill 不动正常像素与透明像素', () => {
  const data = new Uint8Array([
    200, 80, 60, 255,   // 正常肤色
    10, 20, 30, 0,      // 全透明（绿色也无妨）
    100, 110, 90, 255,  // g-r=10 < 25，不算污染
  ]);
  const n = K.despill(data, 3, 1);
  assert.equal(n, 0);
  assert.equal(data[1], 80);
  assert.equal(data[7], 0);   // 透明像素 alpha 不变
  assert.equal(data[11], 255); // 正常像素 alpha 不变
});

test('M4b · despill 阈值可调', () => {
  const data = new Uint8Array([100, 135, 90, 255]); // g-r=35, g-b=45
  assert.equal(K.despill(data, 1, 1, 25), 1);
  const d2 = new Uint8Array([100, 135, 90, 255]);
  assert.equal(K.despill(d2, 1, 1, 40), 0); // 阈值 40 时不判为污染
});

test('M4b · 回归：自适应阈值，蓝绿过渡角色不被误抠（side.png 事故）', () => {
  // 真实素材数据：绿幕 rgb(14,148,21)，角色下身青绿渐变 g-r 最高约 79
  const img = makeImage(40, 40, (x, y) => {
    const inBox = x >= 10 && x < 30 && y >= 10 && y < 34;
    if (inBox) return [56, 135, 97, 255];  // 角色的蓝绿过渡色
    return [14, 148, 21, 255];             // 纯绿幕
  });
  const r = K.keyOut(img.data, 40, 40, { mode: 'green' });
  const center = (20 * 40 + 20) * 4;
  assert.equal(img.data[center + 3], 255, '蓝绿过渡色必须保留（旧阈值会把肚子抠穿）');
  assert.equal(img.data[3], 0, '绿幕背景必须清空');
  assert.equal(K.missedBackgroundCount(img.data, 40, 40, { mode: 'green' }), 0);
});

test('M4b · greenThresholds 下限 40、按背景色差 70% 推算', () => {
  const th = K.greenThresholds([14, 148, 21]);
  assert.ok(th.gr > 90 && th.gr < 110, 'gr≈(148-14)*0.7≈93.8, 实际 ' + th.gr);
  assert.ok(th.gb > 80 && th.gb < 100, 'gb≈(148-21)*0.7≈88.9, 实际 ' + th.gb);
  const th2 = K.greenThresholds([10, 60, 15]); // 很淡的绿幕
  assert.equal(th2.gr, 40, '色差小时取下限 40');
  assert.equal(K.greenThresholds(null).gr, 98, '缺省背景 [0,140,30] → (140-0)*0.7=98');
});

/* ============================================================================
 * M9 · 边缘颜色回渗（edgeColorBleed）
 * ----------------------------------------------------------------------------
 * 事故背景：抠图后边缘半透明像素的 RGB 残留"角色×背景"混合脏色
 * （实测内置形象边缘平均 RGB≈82，本体≈172）。浏览器缩小贴图时按
 * alpha 预乘采样，脏色被混进角色 —— 浅色壁纸上一圈发暗发脏的边。
 * ========================================================================== */

test('M9 · edgeColorBleed：半透明边缘像素被回渗成本体色，alpha 不动', () => {
  // 3x1：左 opaque 红本体、中间 1px 半透明脏暗边、右全透明
  const img = makeImage(3, 1, (x) =>
    x === 0 ? [200, 60, 60, 255]
    : x === 1 ? [30, 30, 30, 128]
    : [0, 0, 0, 0]);
  const n = K.edgeColorBleed(img.data, 3, 1);
  assert.equal(n, 1, '只回渗那 1 个半透明像素');
  assert.equal(img.data[4], 200, 'R 回渗成本体红');
  assert.equal(img.data[5], 60, 'G 回渗成本体红');
  assert.equal(img.data[6], 60, 'B 回渗成本体红');
  assert.equal(img.data[7], 128, 'alpha 保持 128，边缘柔和过渡不变');
  // 两端像素一律不动
  assert.deepEqual(
    Array.from(img.data.subarray(0, 4)), [200, 60, 60, 255], '不透明像素不动');
  assert.deepEqual(
    Array.from(img.data.subarray(8, 12)), [0, 0, 0, 0], '全透明像素不动');
});

test('M9 · edgeColorBleed：没有半透明像素就一律不动', () => {
  const img = makeImage(2, 1, (x) =>
    x === 0 ? [200, 60, 60, 255] : [0, 0, 0, 0]);
  const before = Uint8Array.from(img.data);
  assert.equal(K.edgeColorBleed(img.data, 2, 1), 0, '没有半透明像素就不动');
  assert.deepEqual(Array.from(img.data), Array.from(before));
});

test('M9 · edgeColorBleed：半径内找不到不透明色源时保持原样（不炸）', () => {
  const img = makeImage(3, 3, () => [30, 30, 30, 100]);
  const before = Uint8Array.from(img.data);
  assert.equal(K.edgeColorBleed(img.data, 3, 3), 0, '无色源不回渗');
  assert.deepEqual(Array.from(img.data), Array.from(before));
});

test('M9 · edgeColorBleed：radius 可配置且够不着时保持原样', () => {
  // 5x1：色源在 x=0，半透明像素在 x=4 —— radius=3 够不着，radius=4 能回渗
  const img = makeImage(5, 1, (x) =>
    x === 0 ? [200, 60, 60, 255]
    : x === 4 ? [30, 30, 30, 128]
    : [0, 0, 0, 0]);
  const before = Uint8Array.from(img.data);
  assert.equal(K.edgeColorBleed(img.data, 5, 1, { radius: 3 }), 0,
    'radius=3 够不着 4px 外的色源');
  assert.deepEqual(Array.from(img.data), Array.from(before));
  assert.equal(K.edgeColorBleed(img.data, 5, 1, { radius: 4 }), 1, 'radius=4 命中');
  assert.equal(img.data[16], 200, 'R 被回渗');
  assert.equal(img.data[19], 128, 'alpha 不动');
});

test('M9 · edgeColorBleed：距离加权偏向更近的色源', () => {
  // 5x1：白在 x=0、黑在 x=4、半透明在 x=1 —— 离白更近，应偏向白
  const img = makeImage(5, 1, (x) =>
    x === 0 ? [255, 255, 255, 255]
    : x === 1 ? [40, 40, 40, 128]
    : x === 4 ? [0, 0, 0, 255]
    : [0, 0, 0, 0]);
  K.edgeColorBleed(img.data, 5, 1);
  const v = img.data[4];
  assert.ok(v > 128, `距离加权应偏向更近的白色源，实际 ${v}`);
});

