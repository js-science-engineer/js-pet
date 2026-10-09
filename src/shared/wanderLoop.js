/* ============================================================================
 * JsPetWanderLoop — 可强制停止的漫游调度器（纯逻辑，渲染进程使用，可单测）
 * ----------------------------------------------------------------------------
 * 用户诉求：「桌面散步，点击一下正常散步，再点击一下，停止散步」。
 *
 * ⚠️ 为什么必须单独做一层 token 失效机制（勿删）：
 *   漫游的一步是**异步**的（读窗口边界 → 拉显示器信息 → 移动窗口）。
 *   如果在异步途中用户点了"停止散步"，朴素实现会：
 *     · 在途的那一步仍然把宠物挪走（停不下来）；
 *     · 这一步结束后还可能把自己重新排进定时器（复活）。
 *   于是用户看到的就是"关了散步宠物还在动"。这里用单调自增的 token 解决：
 *   每次 start/stop 都让 token+1，所有异步续段在动宠物之前先问一句
 *   `isStale()`，一旦作废就**立刻收手**：不移动、不重排、不复活。
 *
 * 依赖全部可注入（setTimeout / clearTimeout / random），因此可以脱离浏览器与
 * Electron 完整单测。
 * ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JsPetWanderLoop = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_MIN_DELAY = 2600;
  var DEFAULT_MAX_DELAY = 5200;

  /**
   * @param {object} o
   *   step {function(isStale):any}   走一步；可返回 Promise。异步阶段之间必须
   *                                  调用 isStale() 复查，作废就不要再动宠物。
   *   onStart / onStop {function}    起停回调（用于切换走动动画等表现）
   *   setTimeout / clearTimeout      可注入（测试用假定时器）
   *   random {function}              取 [minDelay, maxDelay] 之间的间隔用
   *   minDelay / maxDelay {number}   步间隔（毫秒）
   * @returns {{start:function,stop:function,isRunning:function,isStale:function}}
   */
  function createWanderLoop(o) {
    var opts = o || {};
    var step = opts.step;
    if (typeof step !== 'function') throw new Error('createWanderLoop 需要 step 回调');

    var setT = typeof opts.setTimeout === 'function' ? opts.setTimeout : setTimeout;
    var clearT = typeof opts.clearTimeout === 'function' ? opts.clearTimeout : clearTimeout;
    var random = typeof opts.random === 'function' ? opts.random : Math.random;
    var minDelay = Number.isFinite(opts.minDelay) ? opts.minDelay : DEFAULT_MIN_DELAY;
    var maxDelay = Number.isFinite(opts.maxDelay) ? opts.maxDelay : DEFAULT_MAX_DELAY;
    if (maxDelay < minDelay) maxDelay = minDelay;

    var running = false;
    var token = 0;      // start/stop 时自增，用于作废所有在途步骤
    var timer = null;

    function isRunning() { return running; }

    /** 某个 token 是否已作废（已停止，或已被下一次 start 取代） */
    function isStale(t) { return !running || t !== token; }

    function delay() {
      return Math.round(minDelay + random() * (maxDelay - minDelay));
    }

    function arm(t) {
      if (isStale(t)) return;
      timer = setT(function () { timer = null; run(t); }, delay());
    }

    function run(t) {
      if (isStale(t)) return Promise.resolve();
      return Promise.resolve()
        .then(function () { return step(function () { return isStale(t); }); })
        .catch(function () {})
        .then(function () {
          // 作废就不重排：这是"点了停止就真的不再动"的第二半保证
          if (isStale(t)) return;
          arm(t);
        });
    }

    /** 开始散步。已在跑则返回 false（幂等，不会叠加两个循环） */
    function start() {
      if (running) return false;
      running = true;
      token += 1;
      if (opts.onStart) opts.onStart();
      arm(token);
      return true;
    }

    /** 停止散步：立即作废在途步骤 + 清定时器，不返回 false 之外的歧义 */
    function stop() {
      if (!running) return false;
      running = false;
      token += 1;
      if (timer !== null) { clearT(timer); timer = null; }
      if (opts.onStop) opts.onStop();
      return true;
    }

    return { start: start, stop: stop, isRunning: isRunning, isStale: isStale };
  }

  return {
    createWanderLoop: createWanderLoop,
    DEFAULT_MIN_DELAY: DEFAULT_MIN_DELAY,
    DEFAULT_MAX_DELAY: DEFAULT_MAX_DELAY,
  };
});
