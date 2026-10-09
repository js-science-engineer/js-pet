'use strict';

/* ============================================================================
 * M6 · 托盘菜单新鲜度（回归测试）
 * ----------------------------------------------------------------------------
 * 事故背景：
 *   菜单曾经只在 createTray 时 `setContextMenu()` 建一次（外加改设置时 rebuild）。
 *   但菜单模板里的「显示宠物 / 隐藏宠物」标签与点击动作是在**构建那一刻**按
 *   当时的可见性定死的。于是用户隐藏宠物后，菜单仍是「隐藏宠物」/hidePet 的
 *   陈旧快照：再点它还是隐藏（像"点了没反应"），也永远等不到「显示宠物」。
 *
 *   这类缺陷没法用纯函数测试覆盖（buildMenuTemplate 本身是对的），
 *   所以这里注入一个假 electron 模块，直接验证 tray.js 的**行为**：
 *   每次右键弹出都按最新状态重建菜单。
 * ========================================================================== */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

/** 注入假 electron，加载一份干净的 tray.js，执行 fn */
function withFakeTray(fn) {
  const built = [];   // Menu.buildFromTemplate 每次构建的菜单
  const st = { tooltip: '', contextMenu: null, handlers: {}, popped: [] };

  class FakeTray {
    setToolTip(t) { st.tooltip = t; }
    setContextMenu(m) { st.contextMenu = m; }
    popUpContextMenu(m) { st.popped.push(m); }
    on(ev, handler) { (st.handlers[ev] = st.handlers[ev] || []).push(handler); }
    destroy() {}
  }

  const fakeElectron = {
    Tray: FakeTray,
    Menu: { buildFromTemplate: (tpl) => { const m = { tpl }; built.push(m); return m; } },
    nativeImage: { createFromPath: () => ({ setTemplateImage() {} }) },
  };

  const trayPath = require.resolve('../src/main/tray');
  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === 'electron') return fakeElectron;
    return origLoad.apply(this, arguments);
  };
  delete require.cache[trayPath]; // 每个用例拿一份新鲜的模块（模块内有 tray 单例）
  try {
    return fn(require('../src/main/tray'), st, built);
  } finally {
    Module._load = origLoad;
  }
}

/** 只关心显隐所需的最少上下文 */
function makeCtx(stateRef, calls) {
  return {
    getState: () => stateRef.value,
    actions: {
      showPet: () => calls.push('showPet'),
      hidePet: () => calls.push('hidePet'),
    },
  };
}

const visible = () => ({ petVisible: true, wanderEnabled: false, autoStart: false });
const hidden = () => ({ petVisible: false, wanderEnabled: false, autoStart: false });

test('M6 · 托盘右键：每次弹出都按最新可见性重建菜单，不用陈旧快照', () => {
  withFakeTray((trayMod, st, built) => {
    const calls = [];
    const stateRef = { value: visible() };
    trayMod.createTray(makeCtx(stateRef, calls));

    // 宠物可见时弹出 → 「隐藏宠物」
    st.handlers['right-click'][0]();
    assert.equal(built.length, 1, '弹出一次构建一次');
    const hideItem = built[0].tpl.find((i) => i.label === '隐藏宠物');
    assert.ok(hideItem, '可见时菜单应显示「隐藏宠物」');
    hideItem.click();
    assert.deepEqual(calls, ['hidePet']);

    // 宠物被隐藏 → 再弹出必须重新构建，出现「显示宠物」（这就是修掉的 bug）
    stateRef.value = hidden();
    st.handlers['right-click'][0]();
    assert.equal(built.length, 2, '状态变了，弹出时必须重新构建菜单');
    const showItem = built[1].tpl.find((i) => i.label === '显示宠物');
    assert.ok(showItem, '隐藏后菜单应显示「显示宠物」');
    showItem.click();
    assert.deepEqual(calls, ['hidePet', 'showPet']);
    assert.notEqual(built[0], built[1], '两次弹出不能是同一个陈旧菜单对象');
  });
});

test('M6 · 托盘左键：实时读可见性，走 hide / show', () => {
  withFakeTray((trayMod, st) => {
    const calls = [];
    const stateRef = { value: visible() };
    trayMod.createTray(makeCtx(stateRef, calls));

    st.handlers['click'][0]();
    assert.deepEqual(calls, ['hidePet']);

    stateRef.value = hidden();
    st.handlers['click'][0]();
    assert.deepEqual(calls, ['hidePet', 'showPet']);
  });
});

test('M6 · 非 Linux 平台不得在启动时固化菜单（否则必然陈旧）', () => {
  if (process.platform === 'linux') return; // Linux 只能走 setContextMenu，另有分支
  withFakeTray((trayMod, st) => {
    trayMod.createTray(makeCtx({ value: visible() }, []));
    assert.equal(st.contextMenu, null, '不应在创建时把菜单固化到托盘上');
    assert.ok(st.handlers['right-click'], '应注册 right-click 在弹出时现建菜单');
    assert.equal(st.tooltip, 'js-pet · 桌面电子宠物');
  });
});
