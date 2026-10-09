'use strict';

/**
 * M9 · 桌面漫游步进规划测试
 * 事故背景：宠物漫游时"突然消失"。旧实现是盲走 + 事后钳制，
 * 撞边只会卡住，且拿不到屏幕信息时仍会继续走，最终被推出屏幕。
 * 现在要求：每一步都必须落在真实工作区内，边界处主动掉头。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const W = require('../src/shared/wander');

const SCREEN = { id: 1, isPrimary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const R = (x, y) => ({ x, y, width: 320, height: 400 });
/** 固定随机的桩：让每一步可复现 */
const fixedRand = (v) => () => v;

test('M9 · 屏幕中央向右走：正常前进且不越界', () => {
  const p = W.planStep({ bounds: R(500, 600), displays: [SCREEN], dir: 1, rand: fixedRand(0) });
  assert.equal(p.reason, 'ok');
  assert.equal(p.dir, 1);
  assert.equal(p.dx, 40); // minDist=40
});

test('M9 · 顶到右边缘 → 主动掉头（不是卡住不动）', () => {
  // 右极限 x = 1920-320 = 1600
  const p = W.planStep({ bounds: R(1600, 600), displays: [SCREEN], dir: 1, rand: fixedRand(0.5) });
  assert.equal(p.reason, 'flip');
  assert.equal(p.dir, -1, '方向必须翻转');
  assert.ok(p.dx < 0, '应向左移动，实际 dx=' + p.dx);
  assert.ok(1600 + p.dx >= 0);
});

test('M9 · 顶到左边缘 → 主动掉头向右', () => {
  const p = W.planStep({ bounds: R(0, 600), displays: [SCREEN], dir: -1, rand: fixedRand(0.5) });
  assert.equal(p.reason, 'flip');
  assert.equal(p.dir, 1);
  assert.ok(p.dx > 0);
});

test('M9 · 拿不到显示器信息时宁可不动（绝不含糊地乱走）', () => {
  assert.equal(W.planStep({ bounds: R(500, 600), displays: [], dir: 1 }).dx, 0);
  assert.equal(W.planStep({ bounds: R(500, 600), displays: null, dir: 1 }).reason, 'no-display');
  assert.equal(W.planStep({ displays: [SCREEN], dir: 1 }).reason, 'no-display');
  assert.equal(W.planStep({ bounds: R(500, 600), displays: [], dir: 1 }).reason, 'no-display');
});

test('M9 · 屏幕比窗口还窄 → 停在原地等待环境恢复', () => {
  const narrow = [{ id: 1, isPrimary: true, workArea: { x: 0, y: 0, width: 200, height: 1040 } }];
  const p = W.planStep({ bounds: R(0, 600), displays: narrow, dir: 1 });
  assert.equal(p.reason, 'stuck');
  assert.equal(p.dx, 0);
});

test('M9 · 工作区有偏移（任务栏在左/上）时按偏移后的边界走', () => {
  const shifted = [{ id: 1, isPrimary: true, workArea: { x: 80, y: 40, width: 1840, height: 1000 } }];
  // 左极限 = 80
  const p = W.planStep({ bounds: R(80, 600), displays: shifted, dir: -1, rand: fixedRand(0.5) });
  assert.equal(p.dir, 1);
  assert.ok(80 + p.dx > 80);
});

test('M9 · 只在本屏内漫游，不会自动跑到另一块屏上', () => {
  const second = { id: 2, isPrimary: false, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };
  const displays = [SCREEN, second];
  // 从左边界向走一步：恰好贴到左极限 0，绝不为负（那会跑到主屏之外）
  const p = W.planStep({ bounds: R(100, 600), displays, dir: -1, rand: fixedRand(1) });
  assert.equal(p.dx, -100);
  assert.equal(100 + p.dx, 0);

  // 已经在左极限 → 必须掉头向右，不能继续往左
  const q = W.planStep({ bounds: R(0, 600), displays, dir: -1, rand: fixedRand(0.5) });
  assert.equal(q.dir, 1);
  assert.ok(q.dx > 0, '在左边缘应掉头向右');
});

test('M9 · 在第二块屏上漫游受第二块屏约束', () => {
  const second = { id: 2, isPrimary: false, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };
  const bounds = R(3520, 600); // 第二块屏的右极限
  const p = W.planStep({ bounds, displays: [SCREEN, second], dir: 1, rand: fixedRand(0.5) });
  assert.ok(p.dx <= 0, '第二块屏右极限处必须掉头，实际 dx=' + p.dx);
});

test('M9 · 属性测试：任意起点与随机值，结果恒在合法区间内', () => {
  let rng = 12345;
  const rand = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
  const minX = 0, maxX = 1600;
  for (let i = 0; i < 400; i++) {
    const x = Math.round(rand() * (maxX + 400)) - 200; // 含越界起点
    const dir = rand() < 0.5 ? -1 : 1;
    const p = W.planStep({ bounds: R(x, 600), displays: [SCREEN], dir, rand });
    const nx = x + p.dx;
    assert.ok(nx >= minX && nx <= maxX, `越界: 起点 ${x} dx ${p.dx} → ${nx}`);
    assert.ok([-1, 1].includes(p.dir));
  }
});

test('M9 · activeWorkArea 命中窗口中心所在的那块屏', () => {
  const second = { id: 2, isPrimary: false, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };
  assert.equal(W.activeWorkArea(R(2000, 100), [SCREEN, second]).x, 1920);
  assert.equal(W.activeWorkArea(R(500, 100), [SCREEN, second]).x, 0);
});

test('M9 · activeWorkArea 完全在外时退回交叠最大的那块', () => {
  const second = { id: 2, isPrimary: false, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };
  // 1919~2239：与主屏交叠 1px 宽，与副屏交叠 319px 宽
  assert.equal(W.activeWorkArea(R(1919, 100), [SCREEN, second]).x, 1920);
});

test('M9 · 距离参数可配置且被尊重', () => {
  const p = W.planStep({ bounds: R(500, 600), displays: [SCREEN], dir: 1, minDist: 10, maxDist: 10, rand: fixedRand(0.9) });
  assert.equal(p.dx, 10);
});
