'use strict';

/* ============================================================================
 * M9 · 桌面散步的强制停止（回归测试）
 * ----------------------------------------------------------------------------
 * 用户诉求：点一下开始散步，再点一下**立刻停止**。
 * 事故形态：漫游的一步是异步的（读边界 → 拉显示器 → 移动窗口），朴素实现里
 * 停止之后在途的那一步照样把宠物挪走，甚至把自己重新排进定时器复活 ——
 * 用户看到的就是"关了散步宠物还在动"。
 *
 * 这里用假定时器 + 手动放行的 Promise，精确复现"停止发生在异步途中"的时序。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWanderLoop } = require('../src/shared/wanderLoop');

/** 可控假定时器：只有显式 fire() 才算"时间到" */
function makeClock() {
  let seq = 0;
  const pending = new Map();
  return {
    setTimer(fn, ms) { const id = ++seq; pending.set(id, { fn, ms }); return id; },
    clearTimer(id) { pending.delete(id); },
    get size() { return pending.size; },
    delays() { return Array.from(pending.values()).map((t) => t.ms); },
    /** 触发并移除最早排入的定时器 */
    fire() {
      const k = pending.keys().next();
      if (k.done) return false;
      const t = pending.get(k.value);
      pending.delete(k.value);
      t.fn();
      return true;
    },
  };
}

/** 跑完所有已排队的微任务 */
const flush = () => new Promise((r) => setImmediate(r));

function makeLoop(clock, over) {
  return createWanderLoop(Object.assign({
    setTimeout: (fn, ms) => clock.setTimer(fn, ms),
    clearTimeout: (id) => clock.clearTimer(id),
    minDelay: 50,
    maxDelay: 50,
    random: () => 0,
  }, over || {}));
}

test('M9 · wanderLoop：start 后按间隔走一步，并自动排下一步', async () => {
  const clock = makeClock();
  let started = 0, stepped = 0, staleSeen = null;
  const loop = makeLoop(clock, {
    onStart: () => { started += 1; },
    step: (isStale) => { stepped += 1; staleSeen = isStale(); },
  });

  assert.equal(loop.isRunning(), false);
  assert.equal(loop.start(), true);
  assert.equal(loop.isRunning(), true);
  assert.equal(started, 1);
  assert.equal(stepped, 0, 'start 只排定时器，不立刻走');
  assert.equal(clock.size, 1);
  assert.deepEqual(clock.delays(), [50]);

  clock.fire();
  await flush();
  assert.equal(stepped, 1);
  assert.equal(staleSeen, false, '运行中 isStale 必须是 false，否则走不动');
  assert.equal(clock.size, 1, '一步走完要继续排下一步');

  clock.fire();
  await flush();
  assert.equal(stepped, 2);
});

test('M9 · wanderLoop：重复 start 幂等，不会叠加出两个循环', () => {
  const clock = makeClock();
  const loop = makeLoop(clock, { step: () => {} });
  assert.equal(loop.start(), true);
  assert.equal(loop.start(), false);
  assert.equal(clock.size, 1);
});

test('M9 · wanderLoop：stop 立刻清定时器且不再执行 step，onStop 必须回调', async () => {
  const clock = makeClock();
  let stepped = 0, stopped = 0;
  const loop = makeLoop(clock, {
    step: () => { stepped += 1; },
    onStop: () => { stopped += 1; },
  });

  loop.start();
  assert.equal(clock.size, 1);
  assert.equal(loop.stop(), true);
  assert.equal(stopped, 1, 'onStop 用于立刻收掉"原地踏步"姿态');
  assert.equal(clock.size, 0, '定时器必须被清掉');
  assert.equal(clock.fire(), false, '已无定时器可触发');
  await flush();
  assert.equal(stepped, 0);
  assert.equal(loop.isRunning(), false);

  assert.equal(loop.stop(), false, '没在跑时 stop 返回 false');
  assert.equal(stopped, 1, '没在跑时不该再回调 onStop');
});

test('M9 · wanderLoop：停止发生在异步途中 → 在途那一步必须放弃移动且不重排（核心）', async () => {
  const clock = makeClock();
  let release;
  const gate = new Promise((r) => { release = r; });
  const events = [];

  const loop = makeLoop(clock, {
    step: async (isStale) => {
      events.push('begin');
      await gate;                                  // 模拟读边界 / 拉显示器
      if (isStale()) { events.push('aborted'); return; }
      events.push('moved');                        // 这里才是真正移动宠物
    },
  });

  loop.start();
  clock.fire();                                    // 这一步开始
  await flush();
  assert.deepEqual(events, ['begin'], 'step 已进入异步等待');

  loop.stop();                                     // 用户此刻点了「停止散步」
  release();                                       // 等待这时才结束
  await flush();

  assert.deepEqual(events, ['begin', 'aborted'], '在途步骤必须放弃移动宠物');
  assert.equal(clock.size, 0, '被作废的步骤绝不能把自己重排进来（不会复活）');
});

test('M9 · wanderLoop：停止后再开始，旧的在途步骤不得干扰新一轮', async () => {
  const clock = makeClock();
  let release;
  const gate = new Promise((r) => { release = r; });
  let moved = 0;

  const loop = makeLoop(clock, {
    step: async (isStale) => {
      await gate;
      if (isStale()) return;
      moved += 1;
    },
  });

  loop.start();
  clock.fire();                 // 第一轮进入异步等待
  await flush();
  loop.stop();                  // 停
  loop.start();                 // 立刻重新开始（token 自增，旧步骤作废）
  assert.equal(clock.size, 1, '新一轮已排好定时器');

  release();                    // 第一轮的等待结束，它必须发现自己已作废
  await flush();
  assert.equal(moved, 0, '旧步骤绝不能动宠物');
  assert.equal(clock.size, 1, '旧步骤也绝不能额外插一个定时器');
  assert.equal(loop.isRunning(), true);
});

test('M9 · wanderLoop：step 抛错不应终止循环', async () => {
  const clock = makeClock();
  let stepped = 0;
  const loop = makeLoop(clock, {
    step: () => { stepped += 1; throw new Error('boom'); },
  });

  loop.start();
  clock.fire();
  await flush();
  assert.equal(stepped, 1);
  assert.equal(loop.isRunning(), true, '抛错后仍应继续散步');
  assert.equal(clock.size, 1, '抛错后仍要排下一步');
});

test('M9 · wanderLoop：缺少 step 回调直接报错（防止接线漏接）', () => {
  assert.throws(() => createWanderLoop({}), /step/);
});
