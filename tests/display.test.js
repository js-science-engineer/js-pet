'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { clampToDisplays, defaultPosition, cornerForShow, findDisplayFor } = require('../src/main/display');

const SIZE = { width: 320, height: 400 };

const PRIMARY = { id: 1, isPrimary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const SECOND = { id: 2, isPrimary: false, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };

test('M1-5 · 坐标在主屏内 → 原样保留', () => {
  const out = clampToDisplays({ x: 900, y: 500 }, [PRIMARY, SECOND], SIZE);
  assert.deepEqual(out, { x: 900, y: 500 });
});

test('M1-5 · 坐标完全落在主屏合法区域内（右下极限值）→ 原样保留', () => {
  const out = clampToDisplays({ x: 1600, y: 640 }, [PRIMARY, SECOND], SIZE);
  assert.deepEqual(out, { x: 1600, y: 640 });
});

test('M1-5 · 坐标在副屏内 → 不做跨屏搬家', () => {
  const out = clampToDisplays({ x: 2400, y: 300 }, [PRIMARY, SECOND], SIZE);
  assert.deepEqual(out, { x: 2400, y: 300 });
});

test('M1-5 · 部分越界 → 钳回该屏工作区内', () => {
  const out = clampToDisplays({ x: 1900, y: 1000 }, [PRIMARY], SIZE);
  assert.deepEqual(out, { x: 1600, y: 640 });
});

test('M1-5 · 坐标完全在所有显示器之外（负坐标）→ 回主屏右下角', () => {
  // 规格见 DEV_PLAN M1-5：不在任何显示器内 → 钳制到主屏右下角
  const out = clampToDisplays({ x: -500, y: -300 }, [PRIMARY], SIZE);
  assert.deepEqual(out, { x: 1920 - 320 - 24, y: 1040 - 400 - 24 });
});

test('M1-5 · 外接屏被拔掉（坐标落在不存在的区域）→ 回主屏右下角', () => {
  // 之前宠物在副屏 x=2400，现在副屏没了
  const out = clampToDisplays({ x: 2400, y: 300 }, [PRIMARY], SIZE);
  assert.deepEqual(out, { x: 1920 - 320 - 24, y: 1040 - 400 - 24 });
});

test('M1-5 · 多屏时优先回主屏而不是第一个显示器', () => {
  const notPrimaryFirst = [
    { id: 2, isPrimary: false, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } },
    { id: 1, isPrimary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  ];
  const out = clampToDisplays({ x: 99999, y: 99999 }, notPrimaryFirst, SIZE);
  assert.deepEqual(out, { x: 1920 - 320 - 24, y: 1040 - 400 - 24 });
});

test('M1-5 · 无显示器信息时退化为原坐标，不抛异常', () => {
  assert.deepEqual(clampToDisplays({ x: 12, y: 34 }, [], SIZE), { x: 12, y: 34 });
  assert.deepEqual(clampToDisplays({ x: 12, y: 34 }, null, SIZE), { x: 12, y: 34 });
});

test('M1-5 · 显示器工作区小于窗口时不会产生负坐标', () => {
  const tiny = [{ id: 1, isPrimary: true, workArea: { x: 0, y: 0, width: 100, height: 100 } }];
  const out = clampToDisplays({ x: 500, y: 500 }, tiny, SIZE);
  assert.ok(out.x >= 0 && out.y >= 0, `不应出现负坐标，实际 ${JSON.stringify(out)}`);
});

test('M1-5 · 工作区带偏移（任务栏在左/上）时以 workArea 为基准', () => {
  const shifted = [{ id: 1, isPrimary: true, workArea: { x: 80, y: 40, width: 1840, height: 1000 } }];

  // 落在偏移后的工作区内 → 原样保留
  assert.deepEqual(clampToDisplays({ x: 100, y: 60 }, shifted, SIZE), { x: 100, y: 60 });

  // 落在工作区内但窗口会溢出 → 按 workArea 的四边钳制（证明用的是 workArea 而非屏幕 bounds）
  assert.deepEqual(clampToDisplays({ x: 1900, y: 1030 }, shifted, SIZE), { x: 1600, y: 640 });

  // 落在偏移工作区的左上之外 → 回落到该屏右下角（同样基于 workArea 计算）
  assert.deepEqual(clampToDisplays({ x: 0, y: 0 }, shifted, SIZE), { x: 1576, y: 616 });
});

test('M1-5 · defaultPosition 落在主屏右下角并留出边距', () => {
  assert.deepEqual(defaultPosition([PRIMARY, SECOND], SIZE), { x: 1920 - 320 - 24, y: 1040 - 400 - 24 });
});

test('M1-5 · defaultPosition 在无显示器信息时返回原点', () => {
  assert.deepEqual(defaultPosition([], SIZE), { x: 0, y: 0 });
});

test('M1-5 · findDisplayFor 命中判定为左闭右开', () => {
  assert.ok(findDisplayFor({ x: 0, y: 0 }, [PRIMARY]));
  assert.equal(findDisplayFor({ x: 1920, y: 0 }, [PRIMARY]), null, '右边界不属于该显示器');
  assert.ok(findDisplayFor({ x: 1920, y: 0 }, [SECOND]));
});

/* ============================================================================
 * M9 · 矩形级钳制与可见性保障
 * 事故背景：漫游时宠物"突然消失"——位移钳制用的是固定常量尺寸，
 * 且完全没有监听显示器变化（拔屏/改分辨率后宠物被永久留在屏幕外）。
 * ========================================================================== */

const {
  intersectArea, displayForRect, clampRect, clampRectToArea, ensureVisible, VISIBLE_TOLERANCE,
} = require('../src/main/display');

const RECT = (x, y) => ({ x, y, width: 320, height: 400 });

test('M9 · intersectArea 计算交叠面积，不相交为 0', () => {
  assert.equal(intersectArea(RECT(0, 0), PRIMARY.workArea), 320 * 400);
  assert.equal(intersectArea(RECT(1800, 900), PRIMARY.workArea), 120 * 140);
  assert.equal(intersectArea(RECT(5000, 5000), PRIMARY.workArea), 0);
});

test('M9 · clampRect 用矩形自身尺寸钳制（不再依赖常量）', () => {
  // 320 宽 → 右极限 1600；若误用常量以外的尺寸就会算错
  assert.deepEqual(clampRect(RECT(1900, 1000), [PRIMARY]), { x: 1600, y: 640 });
  // 换了尺寸（例如将来窗口变大到 400x500）→ 极限随之改变
  assert.deepEqual(clampRect({ x: 1900, y: 1000, width: 400, height: 500 }, [PRIMARY]), { x: 1520, y: 540 });
});

test('M9 · clampRect 落在副屏时只受副屏约束', () => {
  assert.deepEqual(clampRect(RECT(2000, 100), [PRIMARY, SECOND]), { x: 2000, y: 100 });
});

test('M9 · clampRect 无显示器信息时原样返回', () => {
  assert.deepEqual(clampRect(RECT(123, 456), []), { x: 123, y: 456 });
});

test('M9 · ensureVisible：完整可见 → 无需干预（返回 null）', () => {
  assert.equal(ensureVisible(RECT(800, 300), [PRIMARY]), null);
  assert.equal(ensureVisible(RECT(1600, 640), [PRIMARY]), null, '贴边但仍完整可见');
});

test('M9 · ensureVisible：右/下越界 → 拉回工作区内', () => {
  assert.deepEqual(ensureVisible(RECT(1800, 900), [PRIMARY]), { x: 1600, y: 640 });
});

test('M9 · ensureVisible：窗口底部压在任务栏之外（负方向越界）→ 拉回', () => {
  assert.deepEqual(ensureVisible(RECT(-50, -80), [PRIMARY]), { x: 0, y: 0 });
});

test('M9 · ensureVisible：完全在屏幕外（缩放到副屏之外）→ 拉回最近的那块屏', () => {
  // 窗口在第二块屏右侧外 100px → 拉回第二块屏
  assert.deepEqual(ensureVisible(RECT(3940, 100), [PRIMARY, SECOND]), { x: 3520, y: 100 });
});

test('M9 · ensureVisible：外接屏被拔掉 → 回到剩余屏幕内（不会永久丢失）', () => {
  // 宠物原来在副屏 x=2400，副屏没了（只剩主屏）
  const fixed = ensureVisible(RECT(2400, 300), [PRIMARY]);
  assert.deepEqual(fixed, { x: 1600, y: 300 });
});

test('M9 · ensureVisible：分辨率变小后原来合法的坐标需要纠正', () => {
  const small = [{ id: 1, isPrimary: true, workArea: { x: 0, y: 0, width: 1280, height: 720 } }];
  assert.deepEqual(ensureVisible(RECT(1200, 600), small), { x: 960, y: 320 });
});

test('M9 · ensureVisible：屏幕比窗口还小 → 落到左上角而不是负数', () => {
  const tiny = [{ id: 1, isPrimary: true, workArea: { x: 0, y: 0, width: 200, height: 150 } }];
  assert.deepEqual(ensureVisible(RECT(0, 0), tiny), { x: 0, y: 0 });
});

test('M9 · ensureVisible：多屏拼接处跨越屏边界 → 拉进交叠更多的那块', () => {
  // 跨在两屏之间（1600~3700 仍在第二块屏内且越出右边缘）
  const fixed = ensureVisible(RECT(3700, 100), [PRIMARY, SECOND]);
  assert.deepEqual(fixed, { x: 3520, y: 100 });
});

test('M9 · displayForRect 优先交叠面积最大的一块', () => {
  assert.equal(displayForRect(RECT(1900, 100), [PRIMARY, SECOND]).id, 2);
  assert.equal(displayForRect(RECT(1700, 100), [PRIMARY, SECOND]).id, 1);
});

/* ============================================================================
 * M9 · 巡检容差（tolerance）—— 防止"永不收敛"把宠物一直挪来挪去
 * ----------------------------------------------------------------------------
 * 事故：150% 缩放下 Windows 的 DIP 换算有 1~2px 舍入误差，窗口右边缘稳定
 * 多出 1px。tolerance=0 时巡检每 5 秒都判定"越界"→ 挪窗 → 挪窗又让尺寸涨
 * 2px → 溢出更多 → 永不收敛：宠物每 5 秒动一次、窗口一路涨到 805×823，
 * 用户看到的就是"关了散步宠物还在动"。
 * ========================================================================== */

test('M9 · ensureVisible：越界在容差内的舍入噪声 → 不干预', () => {
  // 右边缘多出 1px（真实事故形态：1708 > 工作区 1707）
  const oneMore = { x: PRIMARY.workArea.width - 319, y: 300, width: 320, height: 400 };
  assert.deepEqual(ensureVisible(oneMore, [PRIMARY]), { x: PRIMARY.workArea.width - 320, y: 300 },
    '不给容差时 1px 溢出会被判定越界（这是旧行为，正是死循环的来源）');
  assert.equal(
    ensureVisible(oneMore, [PRIMARY], { tolerance: VISIBLE_TOLERANCE }),
    null,
    '给了容差就必须放过 1px 舍入噪声 —— 否则巡检永不收敛'
  );
});

test('M9 · ensureVisible：容差只吸收噪声，真越界照样纠正', () => {
  // 越出右边缘 20px：远超容差，必须纠正
  const out = { x: PRIMARY.workArea.width - 300, y: 300, width: 320, height: 400 };
  assert.deepEqual(
    ensureVisible(out, [PRIMARY], { tolerance: VISIBLE_TOLERANCE }),
    { x: PRIMARY.workArea.width - 320, y: 300 }
  );
});

test('M9 · ensureVisible：容差覆盖四边（左/上负方向同样生效）', () => {
  const leak = { x: -1, y: -1, width: 320, height: 400 };
  assert.equal(ensureVisible(leak, [PRIMARY], { tolerance: VISIBLE_TOLERANCE }), null);
  assert.deepEqual(ensureVisible(leak, [PRIMARY]), { x: 0, y: 0 });
});

test('M9 · ensureVisible：容差参数非法时退回严格模式（不能变成"永不管"）', () => {
  const oneMore = { x: PRIMARY.workArea.width - 319, y: 300, width: 320, height: 400 };
  for (const bad of [NaN, -5, '8', null, undefined]) {
    const r = bad === undefined
      ? ensureVisible(oneMore, [PRIMARY])
      : ensureVisible(oneMore, [PRIMARY], { tolerance: bad });
    assert.deepEqual(r, { x: PRIMARY.workArea.width - 320, y: 300 }, `tolerance=${String(bad)} 应退回严格模式`);
  }
});

test('M9 · displayForRect 完全在外时退回中心最近的一块', () => {
  assert.equal(displayForRect(RECT(-800, 100), [PRIMARY, SECOND]).id, 1);
  assert.equal(displayForRect(RECT(9000, 100), [PRIMARY, SECOND]).id, 2);
});

test('M9 · clampRectToArea 在工作区内的坐标原样返回', () => {
  assert.deepEqual(clampRectToArea(RECT(500, 500), PRIMARY.workArea), { x: 500, y: 500 });
});

/* ============================================================================
 * M9 · 「显示宠物」强制落点（右下角）
 * ----------------------------------------------------------------------------
 * 事故背景：点击"显示宠物"有时看不见——旧做法沿用旧坐标，只在窗口越界时才纠正；
 * 窗口若"合法可见"但落在副屏 / 被全屏窗口盖住 / 改 DPI 后错位，点了也白点。
 * 新做法：每次点击都把宠物**强制**放到右下角（多屏时落到鼠标所在那块屏）。
 * ========================================================================== */

test('M9 · cornerForShow 单屏 → 主屏右下角并留边距', () => {
  assert.deepEqual(cornerForShow([PRIMARY], SIZE), { x: 1920 - 320 - 24, y: 1040 - 400 - 24 });
});

test('M9 · cornerForShow 多屏默认回主屏右下角（不随机挑屏）', () => {
  // 即使副屏排在数组前面，也要认 isPrimary 那块
  assert.deepEqual(cornerForShow([SECOND, PRIMARY], SIZE), { x: 1920 - 320 - 24, y: 1040 - 400 - 24 });
});

test('M9 · cornerForShow 传鼠标位置 → 落到鼠标所在那块屏的右下角', () => {
  // 鼠标在副屏（x 1920~3840）→ 副屏右下角
  assert.deepEqual(
    cornerForShow([PRIMARY, SECOND], SIZE, { nearPoint: { x: 2500, y: 500 } }),
    { x: 1920 + 1920 - 320 - 24, y: 1040 - 400 - 24 }
  );
  // 鼠标在主屏 → 主屏右下角
  assert.deepEqual(
    cornerForShow([PRIMARY, SECOND], SIZE, { nearPoint: { x: 100, y: 100 } }),
    { x: 1920 - 320 - 24, y: 1040 - 400 - 24 }
  );
});

test('M9 · cornerForShow 鼠标点落在显示器之外 → 退回主屏', () => {
  assert.deepEqual(
    cornerForShow([PRIMARY], SIZE, { nearPoint: { x: -9999, y: -9999 } }),
    { x: 1920 - 320 - 24, y: 1040 - 400 - 24 }
  );
  // 鼠标坐标非法（NaN）同样退回主屏，不抛异常
  assert.deepEqual(
    cornerForShow([PRIMARY], SIZE, { nearPoint: { x: NaN, y: 0 } }),
    { x: 1920 - 320 - 24, y: 1040 - 400 - 24 }
  );
});

test('M9 · cornerForShow 用窗口真实尺寸算，不是固定常量', () => {
  const big = { width: 500, height: 600 };
  assert.deepEqual(cornerForShow([PRIMARY], big), { x: 1920 - 500 - 24, y: 1040 - 600 - 24 });
});

test('M9 · cornerForShow 支持自定义边距', () => {
  assert.deepEqual(cornerForShow([PRIMARY], SIZE, { margin: 0 }), { x: 1920 - 320, y: 1040 - 400 });
});

test('M9 · cornerForShow 无显示器信息 → 原点，不抛异常', () => {
  assert.deepEqual(cornerForShow([], SIZE), { x: 0, y: 0 });
  assert.deepEqual(cornerForShow(null, SIZE), { x: 0, y: 0 });
});

test('M9 · cornerForShow 屏幕小于窗口 → 落在屏幕左上角而不是负坐标', () => {
  const tiny = [{ id: 1, isPrimary: true, workArea: { x: 0, y: 0, width: 200, height: 150 } }];
  assert.deepEqual(cornerForShow(tiny, SIZE), { x: 0, y: 0 });
});

test('M9 · cornerForShow 工作区带偏移（任务栏在左/上）→ 以 workArea 右下为准', () => {
  const shifted = [{ id: 1, isPrimary: true, workArea: { x: 80, y: 40, width: 1840, height: 1000 } }];
  assert.deepEqual(cornerForShow(shifted, SIZE), { x: 80 + 1840 - 320 - 24, y: 40 + 1000 - 400 - 24 });
});

test('M9 · cornerForShow 与 defaultPosition 行为一致（启动落点回归）', () => {
  assert.deepEqual(defaultPosition([PRIMARY, SECOND], SIZE), cornerForShow([PRIMARY, SECOND], SIZE));
});
