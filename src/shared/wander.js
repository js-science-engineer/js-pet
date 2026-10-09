/* ============================================================================
 * JsPetWander — 桌面漫游步进规划（纯逻辑，渲染进程使用，可单测）
 * ----------------------------------------------------------------------------
 * ⚠️ 实测教训（勿删）：
 *   最初的实现是"盲走 + 交给主进程事后钳制"——撞到屏幕边缘只会被钳住不动，
 *   宠物看起来像卡死；更糟的是当时所有钳制都用固定的 320x400 常量，
 *   与实际窗口尺寸/DPI 不符时会把宠物送到屏幕外，表现为"突然消失"。
 *   因此这里的原则是：**先用真实窗口边界和真实显示器工作区算出下一步，
 *   边界处主动掉头**，让主进程的钳制只作为最后一道保险。
 *
 * 所有坐标都是"虚拟桌面绝对坐标"（DIP），与主进程 win:moveBy 同一坐标系。
 * ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JsPetWander = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MIN_DIST = 40;
  var MAX_DIST = 130;

  /** 两点矩形是否交叠（面积 > 0）与交叠面积 */
  function overlapArea(rect, area) {
    var w = Math.min(rect.x + rect.width, area.x + area.width) - Math.max(rect.x, area.x);
    var h = Math.min(rect.y + rect.height, area.y + area.height) - Math.max(rect.y, area.y);
    return (w > 0 && h > 0) ? w * h : 0;
  }

  /**
   * 选出生效的显示器工作区：优先"中心点所在的那块"，否则交叠面积最大的一块。
   * @returns {{x:number,y:number,width:number,height:number}|null}
   */
  function activeWorkArea(bounds, displays) {
    if (!bounds || !Array.isArray(displays) || displays.length === 0) return null;
    var cx = bounds.x + bounds.width / 2;
    var cy = bounds.y + bounds.height / 2;
    for (var i = 0; i < displays.length; i++) {
      var d = displays[i];
      var a = d && d.workArea;
      if (!a) continue;
      if (cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height) return a;
    }
    var best = null, bestArea = 0;
    for (var j = 0; j < displays.length; j++) {
      var dj = displays[j];
      var aj = dj && dj.workArea;
      if (!aj) continue;
      var ov = overlapArea(bounds, aj);
      if (ov > bestArea) { bestArea = ov; best = aj; }
    }
    return best;
  }

  /**
   * 规划下一小步。
   * @param {{bounds:{x,y,width,height}, displays:Array, dir?:number,
   *          minDist?:number, maxDist?:number, rand?:function}} o
   * @returns {{dx:number, dy:number, dir:number, reason:string}}
   *   dir ∈ {-1,1}；reason: 'ok' | 'flip' | 'stuck' | 'no-display'
   */
  function planStep(o) {
    var opts = o || {};
    var bounds = opts.bounds;
    var rand = typeof opts.rand === 'function' ? opts.rand : Math.random;
    var dir = (opts.dir === 1 || opts.dir === -1) ? opts.dir : (rand() < 0.5 ? -1 : 1);

    if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.width)) {
      return { dx: 0, dy: 0, dir: dir, reason: 'no-display' };
    }

    var area = activeWorkArea(bounds, opts.displays);
    if (!area) {
      // 拿不到屏幕信息时宁可不走，也不冒险把宠物推出屏幕
      return { dx: 0, dy: 0, dir: dir, reason: 'no-display' };
    }

    var minX = area.x;
    var maxX = Math.max(minX, area.x + area.width - bounds.width);
    if (maxX <= minX) {
      // 屏幕比窗口还窄：原地不动，等环境恢复正常
      return { dx: 0, dy: 0, dir: dir, reason: 'stuck' };
    }

    var lo = Number.isFinite(opts.minDist) ? opts.minDist : MIN_DIST;
    var hi = Number.isFinite(opts.maxDist) ? opts.maxDist : MAX_DIST;
    if (hi < lo) hi = lo;
    var dist = lo + Math.floor(rand() * (hi - lo + 1));

    function candidateFor(d) {
      var raw = bounds.x + d * dist;
      return Math.min(Math.max(raw, minX), maxX);
    }

    var cand = candidateFor(dir);
    if (cand === bounds.x) {
      // 当前方向已顶到边缘 → 掉头
      dir = -dir;
      cand = candidateFor(dir);
      if (cand === bounds.x) {
        var mid = Math.round((minX + maxX) / 2);
        if (mid !== bounds.x) return { dx: mid - bounds.x, dy: 0, dir: dir, reason: 'stuck' };
        return { dx: 0, dy: 0, dir: dir, reason: 'stuck' };
      }
      return { dx: cand - bounds.x, dy: 0, dir: dir, reason: 'flip' };
    }
    return { dx: cand - bounds.x, dy: 0, dir: dir, reason: 'ok' };
  }

  return { planStep, activeWorkArea, overlapArea, MIN_DIST, MAX_DIST };
});
