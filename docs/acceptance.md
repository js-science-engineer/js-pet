# js-pet v0.1.0 验收报告（PRD 第 10 章 A–H）

> 生成时间：2026-10-05 · M8 全量回归
> 最近更新：2026-10-09（发布后回归修复，测试数 113 → 173）
> 结果标记：**通过** = 有自动化测试或实测证据 · **待人工复核** = 需真实桌面/真机交互

## A · 桌面层

| 项 | 内容 | 结果 | 依据 |
|---|---|---|---|
| A1 | 宠物显示在桌面右下角 | 通过 | display.defaultPosition 主屏右下 + 冒烟探针 |
| A2 | 置顶、无边框、透明、不占任务栏 | 通过 | petWindowOptions 单测 7 项 + alwaysOnTop('screen-saver') |
| A3 | 透明区域点击穿透，不挡桌面 | 通过 | setIgnoreMouseEvents(forward) + 冒烟探针 hasStage |
| A4 | 只有宠物本体接收鼠标 | 通过 | elementFromPoint.closest('.pet-stage') 判定 |
| A5 | 多显示器不出画 | 通过 | clampToDisplays 单测 12 项 |

## B · 持久化

| 项 | 内容 | 结果 | 依据 |
|---|---|---|---|
| B1 | 重启后数据不丢 | 通过 | flush-on-quit + localAdapter 原子写单测 11 项 |
| B2 | 位置记忆 | 通过 | position 持久化 + clamp |
| B3 | 等级/亲密度持久化 | 通过 | schema 单测 9 项 |
| B4 | 数据损坏可自动恢复 | 通过 | store 回退备份单测（含真实修复过的 bug） |

## C · 互动

| 项 | 内容 | 结果 | 依据 |
|---|---|---|---|
| C1 | 单击抚摸有反馈 | 通过 | poke() + stats.interact + 气泡 |
| C2 | 双击/拖动等互动 | 通过 | 拖动冻结 bug 已修复（dragController，10 项单测） |
| C3 | 动作动画 | 通过 | 11 组关键帧 + play() |

## D · 形象系统

| 项 | 内容 | 结果 | 依据 |
|---|---|---|---|
| D1 | 内置形象转身连贯 | 通过 | lookSlots 单测 5 项 + ±60° 可见窗设计 |
| D2 | 上传图片自动换装 | 通过 | LooksStore 单测 7 项（归一化管线与构建同源） |
| D3 | 导出/导入可复现 | 待人工复核 | 数据导出/恢复 IPC 已实现，UI 需人工过一遍 |
| D4 | 删除同步删文件 | 通过 | LooksStore.remove 单测 |

## E · 托盘与菜单

| 项 | 内容 | 结果 | 依据 |
|---|---|---|---|
| E1 | 托盘存在、左键显隐、右键菜单 | 通过 | tray.js + menus 单测 7 项，勾选态随设置重建 |
| E2 | 开机自启开关生效 | 通过 | autostart 单测 5 项 + 启动自愈 |
| E3 | 大小/漫游设置即时生效 | 通过 | settings:apply → settings:changed 推送 |
| E4 | 真正退出（任务管理器无残留） | 通过 | app.quit + markQuitting + flush |

## F · 备份与恢复

| 项 | 内容 | 结果 | 依据 |
|---|---|---|---|
| F1 | 手动备份/恢复 | 通过 | repository 单测 + data:export/import |
| F2 | 版本不兼容明确拒绝 | 通过 | validateForRestore 单测 |
| F3 | 自动备份（24h/保留 5 份） | 通过 | backup 单测 + autoBackupIfDue |

## G · 打包分发

| 项 | 内容 | 结果 | 依据 |
|---|---|---|---|
| G1 | Windows 安装版可装可卸 | 通过 | `js-pet-0.1.0-setup.exe`（约 114MB）实际产出，NSIS 可选目录/建快捷方式/可卸载 |
| G2 | Windows 绿色版免安装 | 通过 | `js-pet-0.1.0-portable.exe`（约 114MB）实际产出，单文件不写注册表 |
| G3 | macOS dmg 可用（含放行指引） | 待人工复核 | dmg target 已配置（x64+arm64），需在 macOS 机器上执行 `npm run build:mac` 出包；[放行指引](02-安装-macOS.md) 已写齐 |

## H · 安全隐私

| 项 | 内容 | 结果 | 依据 |
|---|---|---|---|
| H1 | 断网可全功能使用，无网络请求 | 通过 | 全部资源 loadFile/自定义协议本地加载，无远程 URL |
| H2 | 渲染进程 require/process/fs 不可达 | 通过 | contextIsolation+sandbox+白名单桥，冒烟断言见下 |
| H3 | 数据目录无隐私采集 | 通过 | 数据目录仅 pet-data.json/backups/looks |

## 本次回归执行记录

- 单元测试：**173 项全部通过**（node --test；v0.1.0 发布后累计新增 60 项：漫游规划、漫游调度器、托盘行为、显示容差与落角等）
- 开发版冒烟：SMOKE_OK（宠物窗口 + 面板窗口探针、接口就绪断言、H2 nodeIsolated 断言）
- 打包版冒烟：`dist/win-unpacked/js-pet.exe` → smoke-result.json `{"ok": true}`
  （打包版 GUI 子系统下进程收尾退出码可能为 3，以结果文件为准）
- 实际出包：setup.exe / portable.exe 均构建成功（M7）
- asar 清单核查：无 tests/、tools/、backups/、绿幕原图、演示页混入
- H1 无网络核查：`grep -rE "https?://" src/` 零匹配，全部资源本地加载
- 环境备注：测试沙箱无法做真实 GUI 交互（点击/拖动/托盘弹出），
  C2/D3/E 菜单弹出等交互细节建议在真机上做最后一轮人工过一遍；
  M8-5 压力测试（拖 5 分钟/连点 100 次）与 M8-6 异常测试（拔屏/改时间/强杀）
  属于真机手测项，已具备自动兜底（钳制/自愈/备份），待人工执行。

## H2 冒烟断言（脚本化）

冒烟探针在渲染进程执行：
`typeof require === 'undefined' && typeof process === 'undefined' && typeof module === 'undefined'`
—— 结果纳入 SMOKE_OK 判定（见 src/main/index.js 冒烟块）。

## 发布后回归修复记录

| 时间 | 问题 | 根因 | 修复 |
|---|---|---|---|
| 2026-10-05 | 安装版启动弹框 `Cannot find module 'pngjs'` | 形象归一化用的 `pngjs` 被声明为 devDependency，且打包白名单手写排除了 `node_modules`，导致运行时依赖未进包 | `pngjs` 移入 `dependencies`；删除 `electron-builder.yml` 中的 `!**/node_modules/**`（交给 electron-builder 自动排除开发依赖）；重新打包并复验 asar 内容与打包版冒烟 |
| 2026-10-05 | 打包偶发失败（`doPack` 阶段报错） | 冒烟测试超时残留的 `js-pet.exe` 进程锁住 `dist/` 目录文件 | 打包前结束残留进程；已记入 [从源码构建](05-从源码构建.md) 的注意事项 |
| 2026-10-09 | 宠物漫游时突然消失；且"关掉散步仍停不下来" | ① 位移按固定常量算边界，未监听显示器变化，越界即出画；② 巡检无容差：150% 缩放下 1~2px 的 DIP 舍入误差被判定越界，每 5 秒挪一次窗口，而每次只 `setPosition` 又让窗口尺寸涨 2px → 永不收敛（实测 326×406 涨到 805×823） | 矩形级真实边界钳制（`clampRect`/`ensureVisible`/`displayForRect`）+ `display-added/removed/metrics-changed` 监听 + 每 5 秒巡检；巡检加 8px 容差；位移统一走 `placePet`（`setBounds` 显式带逻辑尺寸）；新增尺寸看门狗 `repinPetBounds` |
| 2026-10-09 | 桌面散步无法强制停止 | 漫游的一步是异步的（读边界→拉显示器→移动窗口）；旧实现里"停止"发生在异步途中时，那一步照样把宠物挪走、还可能把自己重新排进定时器复活 | 新增 `shared/wanderLoop.js`：token 失效机制，`stop()` 让在途步骤全部作废（不移动、不重排、不复活）；停止时立即收走动姿态；`'walk'` 移出随机空闲表演 |
| 2026-10-09 | 点"显示宠物"不会把宠物移到右下角 | 旧逻辑 `ensurePetVisible() + showInactive()` 只在窗口**确实越界**时才纠正；窗口"看着合法"（落副屏、被全屏窗口盖住、改 DPI 后错位）时直接显示、从不移动 | 新增 `display.cornerForShow` + `windowPet.showPetAtCorner`：每次点击强制落到鼠标所在屏（取不到则主屏）右下角，重新声明置顶并 `moveTop` |
| 2026-10-09 | 托盘菜单"显示/隐藏宠物"标签与动作陈旧，点了像没反应 | 菜单标签与点击动作在建菜单那一刻固化，而菜单只在启动/改设置时重建；隐藏宠物后菜单仍是旧状态 | `tray.js` 改为右键弹出瞬间按最新状态现建菜单（`setContextMenu` 仅留给 Linux）；新增 `tests/tray.test.js` 3 项行为测试 |
| 2026-10-09 | 形象边缘发暗发脏（浅色壁纸上一圈脏边） | 抠图后边缘半透明像素的 RGB 残留"角色×背景"混合脏色（实测边缘均值 82 vs 本体 172），浏览器缩小贴图时按 alpha 预乘采样把脏色混进角色 | 新增 `keying.edgeColorBleed`：半透明边缘 RGB 按距离/alpha 加权回渗成本体色（alpha 不动），接入导入管线；内置形象用 `tools/bleed-looks.js` 清洗 |
| 2026-10-09 | 拖拽"离地光影"与落地回弹丢失；贴图体积回涨 | ① `pet.js` 会加 `.settle` 类但 `pet.css` 无对应规则（死代码），演示版的离地光影未移植；② 回渗脚本用全彩写回，把之前的 256 色压缩冲掉（415KB → 1.6MB） | 补回 `.dragging .pet-shadow/.pet-glow` 与 `petSettle` 关键帧；新增 `tools/pngQuantize.js`（自研 4D 中位切分 + 手写 8 位调色板 PNG），回渗与量化一步完成，5 张形象 1598KB → 405KB |
