'use strict';

/**
 * M6 系统托盘：图标 + 左键显隐 + 右键菜单。
 * 菜单模板与宠物右键菜单共用 menus.js。
 *
 * ⚠️ 事故教训（勿回退）：右键菜单必须**每次弹出时现建**。
 * ---------------------------------------------------------------------------
 * 曾经的写法是启动时 `tray.setContextMenu(...)` 建一次就完事，只有改设置时才
 * rebuild。而菜单模板里的「显示宠物 / 隐藏宠物」标签与点击动作，是在**构建
 * 那一刻**按当时的可见性定死的：
 *
 *     label: s.petVisible ? '隐藏宠物' : '显示宠物'
 *     click: () => (s.petVisible ? hidePet() : showPet())
 *
 * 结果：用户隐藏宠物之后，菜单仍是「隐藏宠物」/hidePet 的陈旧快照；再点它还是
 * 隐藏（视觉上"点了没反应"），而且永远等不到「显示宠物」。用户反馈的
 * "显示宠物点了没用" 里就有这一份。
 *
 * 现在改为监听 right-click，弹出瞬间用**最新状态**重建模板 → 标签与动作永远
 * 与实际可见性一致。左键显隐同理，读的是实时状态，不受快照影响。
 */

const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');
const { buildMenuTemplate } = require('./menus');

let tray = null;

function iconImage() {
  // 打包后 __dirname 在 asar 内，icon.png 随 files 白名单进包
  const p = path.join(__dirname, '..', 'assets', 'icon.png');
  const img = nativeImage.createFromPath(p);
  img.setTemplateImage(false);
  return img;
}

/** 用**当前**状态构建一份全新菜单（弹出时调用，绝不复用旧快照） */
function menuFor(ctx) {
  return Menu.buildFromTemplate(buildMenuTemplate({
    state: ctx.getState(),
    actions: ctx.actions,
  }));
}

/**
 * @param {object} ctx
 *   getState: () => ({petVisible, wanderEnabled, autoStart})
 *   actions:  菜单动作表（见 menus.js）
 */
function createTray(ctx) {
  if (tray) return tray;
  tray = new Tray(iconImage());
  tray.setToolTip('js-pet · 桌面电子宠物');

  // 左键：显示/隐藏宠物（Windows 上左键不弹菜单）。
  // 实时读状态，不用任何缓存 —— 否则会和一个陈旧的"是否可见"打架。
  tray.on('click', () => {
    const s = ctx.getState();
    if (s.petVisible) ctx.actions.hidePet();
    else ctx.actions.showPet();
  });

  // 右键：**弹出瞬间现建菜单**（见文件头注释的事故说明）
  tray.on('right-click', () => {
    if (!tray) return;
    tray.popUpContextMenu(menuFor(ctx));
  });

  // Linux 的托盘实现不支持 popUpContextMenu 的交互路径，只能靠 setContextMenu。
  // 该平台下退化为"状态变化时重建"（rebuildTray），行为与旧版一致。
  if (process.platform === 'linux') rebuildTray(ctx);

  return tray;
}

/** Linux 专用：把菜单挂到托盘上（Windows/macOS 在弹出时现建，不需要挂） */
function rebuildTray(ctx) {
  if (!tray) return;
  if (process.platform !== 'linux') return;
  tray.setContextMenu(menuFor(ctx));
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, rebuildTray, destroyTray, iconImage, menuFor };
