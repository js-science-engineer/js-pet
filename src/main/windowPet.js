'use strict';

/**
 * L1 宠物窗口：透明、无边框、置顶、不占任务栏、默认鼠标穿透。
 * 对应 PRD 2.1 的"桌面层"与验收 A2 / A3 / A4 / A5。
 */

const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { PET_WINDOW, buildPetWindowOptions } = require('./petWindowOptions');
const { clampToDisplays, defaultPosition, clampRect, ensureVisible, cornerForShow } = require('./display');

let petWin = null;

/**
 * @param {{x:number,y:number}|null} savedPos 上次记忆的位置
 * @returns {BrowserWindow}
 */
function createPetWindow(savedPos) {
  const displays = screen.getAllDisplays();
  const pos = savedPos && Number.isFinite(savedPos.x)
    ? clampToDisplays(savedPos, displays, PET_WINDOW)
    : defaultPosition(displays, PET_WINDOW);

  petWin = new BrowserWindow(buildPetWindowOptions(pos));

  // 'screen-saver' 层级才能压住大部分全屏窗口；配合 visibleOnAllWorkspaces 覆盖多桌面
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // 默认整窗穿透，但把鼠标事件转发给渲染进程；
  // 渲染进程命中宠物本体时再 IPC 关掉穿透（见 renderer/pet/pet.js）
  petWin.setIgnoreMouseEvents(true, { forward: true });

  petWin.loadFile(path.join(__dirname, '..', 'renderer', 'pet', 'index.html'));

  let shown = false;
  const show = () => {
    if (shown || !petWin || petWin.isDestroyed()) return;
    shown = true;
    petWin.showInactive(); // 不抢焦点，避免打断用户正在做的事
  };
  petWin.once('ready-to-show', show);
  petWin.webContents.once('did-finish-load', show);
  setTimeout(show, 1500); // 透明窗口在个别环境下 ready-to-show 不触发，兜底

  petWin.on('closed', () => { petWin = null; });

  // 记录实测尺寸基线：之后尺寸看门狗据此判断"是否被 Windows 越改越大"
  captureBaselineSize();
  return petWin;
}

function getPetWindow() {
  return petWin && !petWin.isDestroyed() ? petWin : null;
}

/* ============================================================================
 * 窗口尺寸纪律（M9 事故修复，务必读懂再改）
 * ----------------------------------------------------------------------------
 * 事故：150% 缩放下反复调用 `win.setPosition(x, y)` 会让窗口**每次涨 2px**
 * （实测日志 326×406 → 328×408 → … → 805×823），并让可见性巡检永远无法收敛，
 * 宠物于是每 5 秒被挪一次、看着像"关了散步还在动"。
 *
 * 两条纪律：
 *  1) 放位置一律用 `setBounds` 并**显式带上逻辑尺寸** —— 目标是确定性的，
 *     不会因 Windows 的舍入而累积。传的尺寸必须是**创建时用的逻辑值**
 *     （PET_WINDOW），不是 getBounds 读回的值（那个已含 Windows 加的不可见边框）。
 *  2) 另设尺寸看门狗 `repinPetSize()`：真实尺寸偏离基线就复位并上报。
 * ========================================================================== */

/** 放位置：位移入口统一走这里（clamp 用真实尺寸，set 用逻辑尺寸） */
function placePet(x, y) {
  const win = getPetWindow();
  if (!win) return null;
  const nx = Math.round(x);
  const ny = Math.round(y);
  win.setBounds({ x: nx, y: ny, width: PET_WINDOW.width, height: PET_WINDOW.height });
  // 安全网：个别环境对 resizable:false 的窗口可能拒绝 setBounds 的尺寸部分，
  // 若位移没生效就退回纯 setPosition，**保证拖拽/漫游不会失灵**。
  // 容差 2px：DPI 舍入的 ±1px 抖动绝不能触发退回，否则又会退化成反复 setPosition。
  const after = win.getBounds();
  if (Math.abs(after.x - nx) > 2 || Math.abs(after.y - ny) > 2) {
    win.setPosition(nx, ny, false);
  }
  return { x: nx, y: ny };
}

/** 启动后的真实边界尺寸基线（含 Windows 给无边框窗口加的不可见边框） */
let baselineSize = null;

function captureBaselineSize() {
  const win = getPetWindow();
  if (!win) return null;
  const b = win.getBounds();
  baselineSize = { width: b.width, height: b.height };
  return baselineSize;
}

/**
 * 尺寸看门狗：真实尺寸偏离基线超过 tolerance 就用逻辑尺寸复位。
 * @returns {{from:object,to:object}|null} 发生复位时返回前后尺寸
 */
function repinPetSize(tolerance) {
  const win = getPetWindow();
  if (!win) return null;
  const tol = Number.isFinite(tolerance) ? Math.max(0, tolerance) : 4;
  const b = win.getBounds();
  if (!baselineSize) { baselineSize = { width: b.width, height: b.height }; return null; }
  if (Math.abs(b.width - baselineSize.width) <= tol && Math.abs(b.height - baselineSize.height) <= tol) {
    return null;
  }
  const from = { x: b.x, y: b.y, width: b.width, height: b.height };
  win.setBounds({ x: b.x, y: b.y, width: PET_WINDOW.width, height: PET_WINDOW.height });
  return { from, to: { width: PET_WINDOW.width, height: PET_WINDOW.height } };
}

/**
 * 相对移动宠物窗口（真实边界钳制）。
 * ⚠️ 钳制尺寸取自窗口真实 bounds，不用常量——常量与实际尺寸不符时会把
 * 宠物送到屏幕外（详见 display.js 的实测教训）。
 * @param {number} dx
 * @param {number} dy
 * @returns {{x:number,y:number}|null} 最终坐标
 */
function movePetBy(dx, dy) {
  const win = getPetWindow();
  if (!win) return null;
  const b = win.getBounds();
  const next = clampRect(
    { x: b.x + (Number(dx) || 0), y: b.y + (Number(dy) || 0), width: b.width, height: b.height },
    screen.getAllDisplays()
  );
  placePet(next.x, next.y);
  return next;
}

/** 把窗口移动到指定坐标（按真实尺寸钳制）并返回最终坐标 */
function movePetTo(x, y) {
  const win = getPetWindow();
  if (!win) return null;
  const b = win.getBounds();
  const next = clampRect(
    { x: Number(x) || 0, y: Number(y) || 0, width: b.width, height: b.height },
    screen.getAllDisplays()
  );
  placePet(next.x, next.y);
  return next;
}

/** 当前窗口位置 */
function getPetPosition() {
  const win = getPetWindow();
  if (!win) return null;
  const b = win.getBounds();
  return { x: b.x, y: b.y };
}

/**
 * 可见性巡检：窗口只要不是完整落在某块显示器工作区内，就拉回可见位置。
 * 覆盖场景：改分辨率 / 改缩放 / 拔掉外接屏 / 位移越界。
 * @param {{tolerance?:number}} [opts] tolerance 由 index.js 传入的舍入容差
 *        （1~2px 的 DPI 舍入溢出必须忽略，否则巡检会永不收敛，见 display.js）
 * @returns {{fixed:boolean, from?:object, to?:object}} fixed=true 表示发生了纠正
 */
function ensurePetVisible(opts) {
  const win = getPetWindow();
  if (!win) return { fixed: false };
  const b = win.getBounds();
  const next = ensureVisible(b, screen.getAllDisplays(), opts);
  if (!next) return { fixed: false };
  placePet(next.x, next.y);
  return {
    fixed: true,
    from: { x: b.x, y: b.y, width: b.width, height: b.height },
    to: next,
  };
}

/**
 * 「显示宠物」统一入口（M9 增强）：**强制**把宠物放到屏幕右下角再显示。
 * -------------------------------------------------------------------------
 * 为什么不再用 ensurePetVisible + showInactive 的老做法：
 *   老逻辑只在"窗口确实越界"时才纠正。若窗口位置"合法可见"（落在副屏、
 *   被全屏窗口盖住、改 DPI 后错位），点击"显示宠物"后依旧看不见——用户
 *   反馈的正是这个。改成每次点击都强制落位，行为确定、可预期。
 * @param {{nearPoint?:{x:number,y:number}}} [opts] nearPoint 传鼠标位置→按鼠标所在屏落位
 * @returns {{x:number,y:number}|null} 最终坐标；无窗口时返回 null
 */
function showPetAtCorner(opts) {
  const win = getPetWindow();
  if (!win) return null;
  const b = win.getBounds();
  const o = opts || {};
  // 默认按"鼠标所在那块屏"落位：多屏时用户点的是眼前这块屏，宠物就该出现在这里
  let nearPoint = o.nearPoint;
  if (nearPoint === undefined) {
    try { nearPoint = screen.getCursorScreenPoint(); } catch (_) { nearPoint = null; }
  }
  // 尺寸取真实 bounds，不用常量（见 display.js 实测教训）
  const pos = cornerForShow(
    screen.getAllDisplays(),
    { width: b.width, height: b.height },
    { margin: o.margin, nearPoint }
  );
  placePet(pos.x, pos.y);
  // 长时间隐藏后置顶层级可能被系统回收，显示前重新声明一次
  win.setAlwaysOnTop(true, 'screen-saver');
  win.showInactive(); // 不抢焦点，避免打断用户正在做的事
  try { win.moveTop(); } catch (_) {}
  return pos;
}

module.exports = {
  createPetWindow, getPetWindow, movePetTo, movePetBy, getPetPosition,
  ensurePetVisible, showPetAtCorner,
  placePet, repinPetSize, captureBaselineSize,
};
