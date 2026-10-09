'use strict';

/**
 * 多显示器 / DPI 坐标钳制。
 * ---------------------------------------------------------------
 * 记忆的坐标是"虚拟桌面绝对坐标"。用户拔掉外接屏后，这个坐标可能落在
 * 不存在的区域，宠物就会飞到看不见的地方。启动时必须钳回可见区域。
 * 对应 PRD 验收 A3 的稳定性要求与 DEV_PLAN M1-5。
 * 纯函数，不依赖 electron，可直接单元测试。
 */

const DEFAULT_MARGIN = 24;

/**
 * 可见性巡检允许的越界像素（DPI 舍入噪声）。
 * ⚠️ 不要改成 0 —— 见 ensureVisible 的事故注释：150% 缩放下右边缘会稳定多出
 * 1~2px，tolerance=0 会让巡检永不收敛，宠物每 5 秒被挪一次且窗口持续变大。
 */
const VISIBLE_TOLERANCE = 8;

/**
 * 判断某个点落在哪块显示器的工作区内
 * @param {{x:number,y:number}} pos
 * @param {Array} displays [{ workArea:{x,y,width,height}, isPrimary }]
 * @returns {object|null}
 */
function findDisplayFor(pos, displays) {
  if (!Array.isArray(displays)) return null;
  for (const d of displays) {
    const a = d && d.workArea;
    if (!a) continue;
    if (pos.x >= a.x && pos.x < a.x + a.width && pos.y >= a.y && pos.y < a.y + a.height) return d;
  }
  return null;
}

/**
 * 把窗口坐标钳制到合法可见区域
 * @param {{x:number,y:number}} pos 期望坐标
 * @param {Array} displays 显示器列表（来自 screen.getAllDisplays()）
 * @param {{width:number,height:number}} size 窗口尺寸
 * @param {number} [margin]
 * @returns {{x:number,y:number}}
 */
function clampToDisplays(pos, displays, size, margin) {
  const m = Number.isFinite(margin) ? margin : DEFAULT_MARGIN;
  const desired = { x: Math.round(pos && pos.x) || 0, y: Math.round(pos && pos.y) || 0 };

  if (!Array.isArray(displays) || displays.length === 0) return desired;

  const host = findDisplayFor(desired, displays);
  if (host) {
    const a = host.workArea;
    const maxX = Math.max(a.x, a.x + a.width - size.width);
    const maxY = Math.max(a.y, a.y + a.height - size.height);
    return {
      x: Math.min(Math.max(desired.x, a.x), maxX),
      y: Math.min(Math.max(desired.y, a.y), maxY),
    };
  }

  // 坐标不在任何显示器内（例如拔掉了外接屏）→ 回主屏右下角
  const primary = displays.find((d) => d && d.isPrimary) || displays[0];
  const a = primary.workArea;
  return {
    x: Math.round(Math.max(a.x, a.x + a.width - size.width - m)),
    y: Math.round(Math.max(a.y, a.y + a.height - size.height - m)),
  };
}

/** 默认起始位置：主屏右下角 */
function defaultPosition(displays, size, margin) {
  return cornerForShow(displays, size, { margin });
}

/**
 * "显示宠物"强制落点（M9 增强）。
 * -------------------------------------------------------------------------
 * 与"沿用旧坐标再兜底"不同：**每次点击显示都把宠物强制放到某块屏的右下角**，
 * 彻底规避"点了显示却看不见"——旧坐标可能落在已拔掉的副屏、被全屏窗口盖住、
 * 或改 DPI 缩放后错位，此时窗口"合法可见"但用户根本看不到。
 *
 * 尺寸一律取窗口**真实 bounds**（不用常量，见文件顶部实测教训）。
 *
 * @param {Array} displays 显示器列表（来自 screen.getAllDisplays()）
 * @param {{width:number,height:number}} size 窗口真实尺寸
 * @param {{margin?:number, nearPoint?:{x:number,y:number}}} [opts]
 *        nearPoint 通常传鼠标位置：多屏时落到"鼠标所在那块屏"的右下角
 * @returns {{x:number,y:number}}
 */
function cornerForShow(displays, size, opts) {
  const o = opts || {};
  const m = Number.isFinite(o.margin) ? o.margin : DEFAULT_MARGIN;
  const sz = size || { width: 0, height: 0 };
  if (!Array.isArray(displays) || displays.length === 0) return { x: 0, y: 0 };

  let host = null;
  if (o.nearPoint && Number.isFinite(o.nearPoint.x) && Number.isFinite(o.nearPoint.y)) {
    host = findDisplayFor(o.nearPoint, displays);
  }
  if (!host) host = displays.find((d) => d && d.isPrimary) || displays[0];
  const a = host && host.workArea;
  if (!a) return { x: 0, y: 0 };

  return {
    x: Math.round(Math.max(a.x, a.x + a.width - sz.width - m)),
    y: Math.round(Math.max(a.y, a.y + a.height - sz.height - m)),
  };
}

/* ============================================================================
 * 矩形级工具（M9）——所有位移路径统一走这里
 * ----------------------------------------------------------------------------
 * ⚠️ 实测教训（勿删）：
 *   之前 win:moveBy / win:setPos 一律用固定常量 PET_WINDOW(320x400) 做钳制，
 *   而不是窗口的真实边界。一旦实际尺寸与常量不符（DPI 缩放、系统调整、
 *   未来改版），钳制结果就是错的，宠物会被送到屏幕外——用户表现就是
 *   "漫游时突然消失"。下面这组函数一律以**真实矩形**为输入。
 * ========================================================================== */

/** 两个矩形的交叠面积（不相交返回 0） */
function intersectArea(rect, area) {
  const w = Math.min(rect.x + rect.width, area.x + area.width) - Math.max(rect.x, area.x);
  const h = Math.min(rect.y + rect.height, area.y + area.height) - Math.max(rect.y, area.y);
  return (w > 0 && h > 0) ? w * h : 0;
}

/**
 * 选出生效显示器：优先交叠面积最大的一块；
 * 完全在所有显示器之外时，退回"中心点最近"的一块（拔屏/改分辨率后的兜底）。
 * @returns {object|null} display 对象
 */
function displayForRect(rect, displays) {
  if (!Array.isArray(displays) || displays.length === 0) return null;
  let best = null;
  let bestArea = 0;
  for (const d of displays) {
    const a = d && d.workArea;
    if (!a) continue;
    const ov = intersectArea(rect, a);
    if (ov > bestArea) { bestArea = ov; best = d; }
  }
  if (best) return best;

  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  let nearest = null;
  let nearestDist = Infinity;
  for (const d of displays) {
    const a = d && d.workArea;
    if (!a) continue;
    // 中心点到工作区的最短距离（在区内则为 0）
    const dx = Math.max(a.x - cx, 0, cx - (a.x + a.width));
    const dy = Math.max(a.y - cy, 0, cy - (a.y + a.height));
    const dist = dx * dx + dy * dy;
    if (dist < nearestDist) { nearestDist = dist; nearest = d; }
  }
  return nearest;
}

/** 把矩形左上角钳进某块工作区（保持矩形完整可见） */
function clampRectToArea(rect, area) {
  const maxX = Math.max(area.x, area.x + area.width - rect.width);
  const maxY = Math.max(area.y, area.y + area.height - rect.height);
  return {
    x: Math.min(Math.max(Math.round(rect.x), area.x), Math.round(maxX)),
    y: Math.min(Math.max(Math.round(rect.y), area.y), Math.round(maxY)),
  };
}

/**
 * 按**矩形自身尺寸**把窗口钳制到可见区域。
 * 与 clampToDisplays(传常量尺寸) 的区别：尺寸来自真实 bounds，永远准确。
 * @param {{x:number,y:number,width:number,height:number}} rect
 * @param {Array} displays
 */
function clampRect(rect, displays) {
  if (!Array.isArray(displays) || displays.length === 0) {
    return { x: Math.round(rect.x), y: Math.round(rect.y) };
  }
  const host = displayForRect(rect, displays);
  if (!host) return { x: Math.round(rect.x), y: Math.round(rect.y) };
  return clampRectToArea(rect, host.workArea);
}

/**
 * 可见性保障（运行期巡检 + 显示器变化时调用）。
 * 窗口完整落在某块工作区内 → 返回 null（无需干预）；
 * 否则返回应移动到的坐标，保证宠物一定回到屏幕里。
 *
 * ⚠️ 容差参数（tolerance）是救命参数，务必理解后再改：
 * -------------------------------------------------------------------------
 * 事故：DPI 缩放（150%）下，Windows 对无边框透明窗口的 DIP↔物理像素换算有
 * 1~2px 的舍入误差。窗口右边缘会稳定地"多出 1px"（如 1708 > 工作区 1707）。
 * 于是巡检每 5 秒都判定"越界"→ setPosition 挪 1px → 而每次 setPosition 又让
 * 窗口尺寸涨 2px → 下次溢出更多 → **永不收敛**：宠物每 5 秒动一次、窗口
 * 从 326×406 一路涨到 805×823。用户看到的就是"明明关了散步，宠物还在动"。
 *
 * 结论：1~2px 的溢出是舍入噪声，不是真越界，绝不能据此反复挪窗。
 * 巡检请传 tolerance（见 index.js 的 GUARD_TOLERANCE）。
 *
 * @param {{x:number,y:number,width:number,height:number}} rect 窗口真实边界
 * @param {Array} displays
 * @param {{tolerance?:number}} [opts] tolerance 允许的越界像素（默认 0＝严格）
 * @returns {{x:number,y:number}|null}
 */
function ensureVisible(rect, displays, opts) {
  if (!rect || !Array.isArray(displays) || displays.length === 0) return null;
  const t = opts && Number.isFinite(opts.tolerance) ? Math.max(0, opts.tolerance) : 0;
  for (const d of displays) {
    const a = d && d.workArea;
    if (!a) continue;
    if (rect.x >= a.x - t && rect.y >= a.y - t &&
        rect.x + rect.width <= a.x + a.width + t &&
        rect.y + rect.height <= a.y + a.height + t) {
      return null; // 完整可见（含容差内的舍入噪声）
    }
  }
  const host = displayForRect(rect, displays);
  if (!host) return null;
  return clampRectToArea(rect, host.workArea);
}

module.exports = {
  clampToDisplays, defaultPosition, cornerForShow, findDisplayFor, DEFAULT_MARGIN,
  VISIBLE_TOLERANCE,
  intersectArea, displayForRect, clampRectToArea, clampRect, ensureVisible,
};
