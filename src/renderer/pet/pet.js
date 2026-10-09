/* ============================================================================
 * js-pet 宠物渲染引擎（渲染进程，L1 桌面层）
 * ----------------------------------------------------------------------------
 * 职责：
 *   1. 渲染宠物（4 面圆柱 3D 转身 + 招手/打盹整图姿势 + 待机呼吸）
 *   2. 空闲时随机表演 / 视线追踪鼠标
 *   3. 鼠标穿透管理：只有宠物本体接收事件，其余区域穿透到桌面
 *   4. 拖拽 → 移动操作系统窗口（不是移动 DOM）
 *   5. 向 M3/M5 暴露 window.jsPetRenderer 接口
 * 数据来源：window.jsPet（preload 桥）。渲染进程不碰任何 Node API。
 * ========================================================================== */
(function () {
  'use strict';

  const api = window.jsPet;
  const SLOTS = window.JsPetLookSlots;
  const Stats = window.JsPetStats;
  const DragCtl = window.JsPetDrag;
  const Wander = window.JsPetWander;
  const WanderLoop = window.JsPetWanderLoop;

  /* ---------------- 常量 ---------------- */
  const TURN_MS = 4200;                 // 转身总时长
  const EDGE = 60, FADE = 30;           // 贴图可见窗 ±60°，相邻窗重叠永不黑屏
  // ⚠️ 'walk' 是**位移动作**，只允许漫游（桌面散步）使用。
  //    曾经把它放进随机空闲表演里，导致"关了散步宠物还在原地踏步"——
  //    用户看到就是"停止散步没用"。不要再加回来。
  const ACTS = ['wave', 'excited', 'dance', 'jump', 'look', 'turn', 'wiggle', 'surprise', 'nod'];
  const FACE_FLIP = [false, false, false, true];   // 第 4 面用侧面镜像

  const SAY = {
    wave: ['嗨～', '你好呀！', '今天也要加油哦'],
    excited: ['哇！！', '太棒了吧！', '嘿嘿嘿——'],
    dance: ['动次打次～', '跟着节奏摇起来', '舞力全开！'],
    jump: ['跳！', '接住我！', '蹦蹦跳跳~'],
    walk: ['溜达溜达', '去哪看看呢', '散步有助于消化'],
    look: ['咦？那边有什么', '让我康康', '左右看看~'],
    turn: ['看你背后！', '变！', '其实我的背面也很圆'],
    wiggle: ['扭扭更健康', '圆滚滚的骄傲', '摇摆摇摆~'],
    surprise: ['哇！！吓我一跳', '什么情况！', '瞪大眼睛ing'],
    nod: ['嗯嗯，说得对', '收到收到', '没错没错！'],
    sleep: ['Zzz…（先眯一会）', '好困呀…'],
    poke: ['戳我干嘛！', '痒痒的~', '再戳就扁了！'],
    idle: ['在呢在呢', '陪着你呢'],
  };

  /* ---------------- 内置默认形象 ---------------- */
  const DEFAULT_LOOK = {
    front: 'looks/front.png',
    side: 'looks/side.png',
    back: 'looks/back.png',
    side2: null,            // 用侧面镜像
    wave: 'looks/wave.png',
    sleep: 'looks/sleep.png',
  };

  /* ---------------- 状态 ---------------- */
  let cur = '';             // 当前动作名，'' = 待机
  let views = SLOTS.resolveViews(DEFAULT_LOOK);
  let size = 150;
  let lastPos = null;
  let persistTimer = 0;

  /* ---------------- DOM ---------------- */
  const layer = document.getElementById('petLayer');
  const stage = document.createElement('div');
  stage.className = 'pet-stage';
  stage.innerHTML =
    '<div class="bubble"></div>' +
    '<div class="pet-3d">' +
      '<div class="pet-cyl">' +
        '<img class="face s1 cur" draggable="false" alt="">' +
        '<img class="face s2" draggable="false" alt="">' +
        '<img class="face s3" draggable="false" alt="">' +
        '<img class="face s4" draggable="false" alt="">' +
      '</div>' +
    '</div>' +
    '<img class="pose-flat pose-wave" draggable="false" alt="">' +
    '<img class="pose-flat pose-sleep" draggable="false" alt="">' +
    '<div class="zzz"><span>Z</span><span>z</span><span>z</span></div>' +
    '<div class="pet-shadow"></div>' +
    '<div class="pet-glow"></div>';
  layer.appendChild(stage);

  const cyl = stage.querySelector('.pet-cyl');
  const bubble = stage.querySelector('.bubble');
  const faces = Array.prototype.slice.call(stage.querySelectorAll('.face'));

  /* ---------------- 工具 ---------------- */
  const rand = (a) => a[Math.floor(Math.random() * a.length)];

  /* ---------------- 形象 ---------------- */
  function applyViews(nextViews) {
    views = SLOTS.resolveViews(nextViews || DEFAULT_LOOK);
    const put = (sel, src, flip) => {
      const im = stage.querySelector(sel);
      if (!im) return;
      if (src) {
        if (im.getAttribute('src') !== src) im.src = src;
        if (im.decode) im.decode().catch(function () {});
      }
      im.style.transform = flip ? 'scaleX(-1)' : '';
    };
    put('.face.s1', views.front, false);
    put('.face.s2', views.side, false);
    put('.face.s3', views.back, false);
    put('.face.s4', views.side2, views.side2 === views.side);
    put('.pose-wave', views.wave, false);
    put('.pose-sleep', views.sleep, false);
  }

  /* ---------------- 尺寸 ---------------- */
  function setSize(next) {
    size = Math.max(100, Math.min(260, Math.round(next || 150)));
    stage.style.setProperty('--pet-size', size + 'px');
  }

  /* ---------------- 气泡 ---------------- */
  let sayTimer = 0;
  function say(text) {
    bubble.textContent = text;
    bubble.classList.add('show');
    clearTimeout(sayTimer);
    sayTimer = setTimeout(function () { bubble.classList.remove('show'); }, 2200);
  }

  /* ---------------- 动作 ---------------- */
  function clearAct() {
    if (turnRaf) { cancelAnimationFrame(turnRaf); turnRaf = 0; }
    faces.forEach(function (f, i) {
      f.style.cssText = '';
      f.classList.toggle('cur', i === 0);
    });
    // 恢复 s4 的镜像
    if (views.side2 === views.side) faces[3].style.transform = 'scaleX(-1)';
    cyl.style.transition = '';
    cyl.style.transform = '';
    Array.prototype.forEach.call(stage.classList, function (c) {
      if (c.indexOf('acting-') === 0) stage.classList.remove(c);
    });
  }

  function setIdle() {
    clearAct();
    clearTimeout(actTimer);
    cur = '';
  }

  /* 连续 3D 转身：rAF 逐帧插值，贴图环绕 + 轻微起伏/侧倾，全程无跳变 */
  let turnRaf = 0;
  function startTurn(dur) {
    cyl.style.transition = 'none';
    const t0 = performance.now();
    const easeInOut = function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
    function frame(now) {
      const t = Math.min(1, (now - t0) / dur);
      const ang = easeInOut(t) * 360;
      for (let i = 0; i < 4; i++) {
        const d = ((i * 90 - ang) % 360 + 540) % 360 - 180;   // 最短角差
        const ad = Math.abs(d);
        const f = faces[i];
        if (ad > EDGE + 1) { f.style.visibility = 'hidden'; continue; }
        f.style.visibility = 'visible';
        f.style.transform = 'rotateY(' + d.toFixed(2) + 'deg)' + (FACE_FLIP[i] ? ' scaleX(-1)' : '');
        f.style.opacity = ad <= EDGE - FADE ? '1' : Math.max(0, (EDGE - ad) / FADE).toFixed(3);
      }
      cyl.style.transform =
        'translateY(' + (-10 * Math.sin(Math.PI * t)).toFixed(2) + 'px)' +
        ' rotateZ(' + (3 * Math.sin(2 * Math.PI * t)).toFixed(2) + 'deg)';
      if (t < 1) turnRaf = requestAnimationFrame(frame);
      else {
        faces.forEach(function (f, i) {
          f.style.cssText = '';
          f.classList.toggle('cur', i === 0);
        });
        if (views.side2 === views.side) faces[3].style.transform = 'scaleX(-1)';
        cyl.style.transition = '';
        cyl.style.transform = '';
        turnRaf = 0;
      }
    }
    turnRaf = requestAnimationFrame(frame);
  }

  let actTimer = 0;
  function play(name, silent) {
    if (name === 'idle') { setIdle(); if (!silent) say(rand(SAY.idle)); return; }
    clearAct();
    void stage.offsetWidth;   // 强制重排以重启动画
    cur = name;
    stage.classList.add('acting-' + name);
    if (!silent) say(rand(SAY[name] || ['嘿嘿']));
    clearTimeout(actTimer);
    if (name === 'turn') {
      startTurn(TURN_MS);
      actTimer = setTimeout(function () {
        if (cur === 'turn') { clearAct(); cur = ''; }
      }, TURN_MS + 150);
    } else {
      const dur = name === 'sleep' ? 6500
        : (name === 'dance' || name === 'wave') ? 4600 : 3200;
      actTimer = setTimeout(function () {
        if (cur === name) {
          clearAct(); cur = '';
          if (name === 'sleep') say('睡饱啦！');
        }
      }, dur);
    }
  }

  /* ---------------- 空闲随机表演 ---------------- */
  let schedTimer = 0;
  function schedule() {
    clearTimeout(schedTimer);
    schedTimer = setTimeout(function () {
      if (!cur && !wanderBusy) play(rand(Math.random() < 0.14 ? ['sleep'] : ACTS), Math.random() < 0.4);
      schedule();
    }, 3800 + Math.random() * 4600);
  }

  /* ---------------- 视线追踪 ---------------- */
  const pointer = { x: 0, y: 0, has: false, last: 0 };
  let trackRaf = 0;
  const tr = { x: 0, z: 0 };

  document.addEventListener('pointermove', function (e) {
    pointer.x = e.clientX; pointer.y = e.clientY;
    pointer.has = true; pointer.last = performance.now();
    if (!trackRaf) trackRaf = requestAnimationFrame(trackStep);
  }, { passive: true });

  function trackStep(now) {
    let active = false;
    const idlePointer = now - pointer.last >= 1600;
    const can = !cur && !dragging && !wanderBusy;
    let tx = 0;
    if (can && pointer.has && !idlePointer) {
      const rect = stage.getBoundingClientRect();
      const dx = (pointer.x - (rect.left + rect.width / 2)) / (window.innerWidth * 0.42);
      tx = Math.abs(dx) < 0.06 ? 0 : Math.max(-1, Math.min(1, dx));
    }
    const nx = tr.x + (tx - tr.x) * 0.09;
    const nz = tr.z + (tx * 20 - tr.z) * 0.09;
    if (Math.abs(nx - tr.x) > 0.0004 || Math.abs(nz - tr.z) > 0.004) active = true;
    tr.x = nx; tr.z = nz;
    if (can) {
      if (Math.abs(nz) > 0.3) {
        cyl.style.transition = 'none';
        cyl.style.transform =
          'rotateY(' + nz.toFixed(2) + 'deg) translateX(' + (nx * 7).toFixed(2) + 'px)' +
          ' rotateZ(' + (nx * 2.2).toFixed(2) + 'deg)';
      } else if (cyl.style.transform) {
        cyl.style.transition = '';
        cyl.style.transform = '';
      }
    }
    if (active) trackRaf = requestAnimationFrame(trackStep);
    else {
      trackRaf = 0;
      if (cyl.style.transform && Math.abs(tr.z) < 0.3) {
        cyl.style.transition = '';
        cyl.style.transform = '';
      }
    }
  }

  /* ---------------- 鼠标穿透 ---------------- */
  let ignoring = true;
  function setIgnore(next) {
    if (next === ignoring) return;
    ignoring = next;
    api.win.setIgnoreMouse(next);
  }

  // 拖拽状态机（可单测的纯逻辑，见 src/shared/dragController.js）
  const dragCtl = DragCtl.createDragController();

  document.addEventListener('mousemove', function (e) {
    // ⚠️ 拖拽期间绝不允许恢复穿透：指针只要有一瞬间落进窗口透明区，
    //    窗口就会变成点击穿透，后续事件全部掉到桌面，拖动立即冻结。
    if (dragCtl.dragging) { setIgnore(false); return; }
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const overPet = !!(hit && hit.closest && hit.closest('.pet-stage'));
    setIgnore(dragCtl.mustIgnoreMouse(overPet));
  }, { passive: true });

  // 指针离开窗口时必须立刻恢复穿透，否则透明区域会挡住桌面点击
  // （拖拽中除外，见上）
  window.addEventListener('mouseout', function (e) {
    if (!e.relatedTarget && !dragCtl.dragging) setIgnore(true);
  });
  window.addEventListener('blur', function () {
    if (!dragCtl.dragging) setIgnore(true);
  });

  /* ---------------- 拖拽 → 移动操作系统窗口 ---------------- */
  let moveRaf = 0;

  function flushMove() {
    moveRaf = 0;
    const d = dragCtl.takeDelta();
    if (!d.dx && !d.dy) return;
    api.win.moveBy(d.dx, d.dy).then(function (pos) {
      if (pos) { lastPos = pos; schedulePersist(); }
    }).catch(function () {});
  }

  stage.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    dragCtl.onDown(e.screenX, e.screenY);
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    stage.classList.add('pressing');
  });

  stage.addEventListener('pointermove', function (e) {
    const r = dragCtl.onMove(e.screenX, e.screenY);
    if (!r.moved) return;
    stage.classList.add('dragging');
    if (!moveRaf) moveRaf = requestAnimationFrame(flushMove);
  });

  function endDrag() {
    const wasDrag = dragCtl.onUp();
    stage.classList.remove('pressing', 'dragging');
    if (wasDrag) {
      // 落定回弹
      stage.classList.add('settle');
      setTimeout(function () { stage.classList.remove('settle'); }, 450);
    }
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  // 兜底：若指针捕获在窗口移动中丢失，窗口级 pointerup 也要能结束拖拽，
  // 否则 dragCtl.dragging 永远为 true，窗口会一直不穿透、挡住桌面。
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('blur', function () {
    if (dragCtl.dragging) endDrag();
  });

  stage.querySelectorAll('img').forEach(function (im) {
    im.addEventListener('dragstart', function (e) { e.preventDefault(); });
  });

  /* ---------------- 交互 ---------------- */
  let clickTimer = 0;
  stage.addEventListener('click', function () {
    clearTimeout(clickTimer);
    clickTimer = setTimeout(function () {
      if (renderer.onPoke) renderer.onPoke();
      else play('wiggle');
    }, 220);
  });
  stage.addEventListener('dblclick', function () {
    clearTimeout(clickTimer);
    play(rand(['excited', 'jump', 'dance']));
  });
  stage.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    if (renderer.onContextMenu) renderer.onContextMenu(e);
  });

  /* ---------------- 位置持久化（M2 接入真实存储） ---------------- */
  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      if (lastPos && api.state) api.state.patch({ position: lastPos }).catch(function () {});
    }, 2000);
  }

  /* ---------------- 漫游模式（M9：按真实屏幕边界规划，遇边掉头） ----------------
   * 「桌面散步」是**开/关**开关：点一下开始散步，再点一下**立刻停止**。
   * 强制停止由 WanderLoop 的 token 机制保证：在途的那一步一旦发现被作废就收手，
   * 既不移动宠物、也不重排定时器（详见 shared/wanderLoop.js 的注释）。
   * -------------------------------------------------------------------------- */
  let wanderDir = 0;              // 0 = 未定，1 = 向右，-1 = 向左
  let wanderBusy = false;         // 是否有漫游步骤正在异步执行中
  let displaysCache = null;
  let displaysAt = 0;

  /** 显示器工作区缓存 30s（漫游期间屏幕很少变化，避免每步都 IPC） */
  function refreshDisplays() {
    if (!api.win || !api.win.displays) return Promise.resolve(null);
    if (displaysCache && Date.now() - displaysAt < 30000) return Promise.resolve(displaysCache);
    return Promise.resolve(api.win.displays()).then(function (list) {
      if (list && list.length) { displaysCache = list; displaysAt = Date.now(); }
      return displaysCache;
    }).catch(function () { return displaysCache; });
  }

  /** 屏幕变化后让缓存立即失效（配合主进程 win:restored 事件） */
  function invalidateDisplays() { displaysCache = null; displaysAt = 0; }

  /** 停止散步时的姿态收尾：立刻退出走动姿态，不再"原地踏步" */
  function stopWalkPose() {
    if (cur === 'walk') setIdle();
  }

  const wanderLoop = WanderLoop ? WanderLoop.createWanderLoop({
    minDelay: 2600,
    maxDelay: 5200,
    onStop: stopWalkPose,
    step: function (isStale) {
      if (!api.win || !api.win.getBounds || !api.win.moveBy) return null;
      wanderBusy = true;
      let b0 = null;
      return Promise.resolve(api.win.getBounds())
        .then(function (b) {
          if (isStale()) return null;      // 途中被停止 → 连边界都不用读下去了
          b0 = b;
          return refreshDisplays();
        })
        .then(function (list) {
          if (isStale()) return null;
          if (!b0 || !Wander) return null;
          // 关键：用**窗口真实边界 + 真实工作区**算这一步，越界前主动掉头
          const plan = Wander.planStep({
            bounds: b0,
            displays: list || [],
            dir: wanderDir,
            rand: Math.random,
          });
          wanderDir = plan.dir;
          if (!plan.dx) { invalidateDisplays(); return null; }  // 拿不到屏幕信息：这一步不走
          if (Math.random() < 0.55) play('walk');
          if (isStale()) return null;      // 动宠物前的最后一道复查
          return api.win.moveBy(plan.dx, 0).then(function (pos) {
            if (pos) lastPos = pos;
            // 被主进程钳住（没能移动）→ 立刻反向，避免贴着边缘卡死
            if (pos && Math.abs(pos.x - b0.x) < 1) wanderDir = -plan.dir;
          });
        })
        .catch(function () {})
        .then(function () { wanderBusy = false; });
    },
  }) : null;

  /**
   * 桌面散步开关。
   * 关：立刻作废在途步骤 + 清定时器 + 收掉走动姿态 —— 点了就真的停。
   */
  function setWander(on) {
    if (!wanderLoop) return;
    if (on) { wanderLoop.start(); return; }
    wanderLoop.stop();
    stopWalkPose();   // 循环本就没在跑时也要收姿态（stop() 不会再回调 onStop）
  }

  /* ---------------- 养成状态 → 表现（M3-7） ---------------- */
  let prevLevel = 1;
  function applyMood(s) {
    if (!s || !Stats) return;
    renderer.setMoodClass(Stats.moodClass(s));
  }

  /** 抚摸：走主进程结算，是亲密度/心情的正式来源 */
  async function poke() {
    if (!api.stats) { play('wiggle'); return; }
    try {
      const r = await api.stats.interact('pet');
      if (!r) return;
      if (!r.ok) {
        if (r.reason === 'cooldown') say(rand(SAY.poke));
        else play('wiggle');
        if (r.stats) applyMood(r.stats);
        return;
      }
      applyMood(r.stats);
      if (r.leveledUp) {
        play('excited');
        say('升级啦！Lv.' + r.stats.level);
        prevLevel = r.stats.level;
        return;
      }
      if (r.bondGained === false) {
        say('今天的亲密度满啦，明天再来吧');
        play('nod');
        return;
      }
      const lines = Stats.linesFor(r.stats);
      if (lines) say(rand(lines));
      else play('wiggle');
    } catch (_) { play('wiggle'); }
  }

  /* ---------------- 对外接口 ---------------- */
  const renderer = {
    play: play,
    say: say,
    setSize: setSize,
    setViews: applyViews,
    setWander: setWander,
    /** M3 接入：根据养成状态切换外观 class */
    setMoodClass: function (cls) {
      ['mood-low', 'mood-critical', 'mood-happy'].forEach(function (c) { stage.classList.remove(c); });
      if (cls) stage.classList.add(cls);
    },
    /** 供主进程/面板查询 */
    isBusy: function () { return !!cur; },
    onPoke: poke,
    onContextMenu: function (e) {
      // M6：右键弹统一菜单（坐标用屏幕坐标系）
      if (api.menu && api.menu.petContext) {
        api.menu.petContext(e.screenX, e.screenY);
      }
    },
  };
  window.jsPetRenderer = renderer;

  /* ---------------- 启动 ---------------- */
  function boot() {
    setSize(150);
    applyViews(DEFAULT_LOOK);
    schedule();
    if (api.state && api.state.load) {
      Promise.resolve(api.state.load()).then(function (s) {
        if (!s) return;
        if (s.settings && Number.isFinite(s.settings.size)) setSize(s.settings.size);
        if (s.position) lastPos = s.position;
        if (s.stats) { prevLevel = s.stats.level; applyMood(s.stats); }
        if (s.settings && typeof s.settings.wanderEnabled === 'boolean') {
          setWander(s.settings.wanderEnabled);
        }
        if (s.currentLookId != null && api.looks && api.looks.getViews) {
          api.looks.getViews(s.currentLookId).then(function (r) {
            if (r && r.ok && r.views) applyViews(r.views);
          }).catch(function () {});
        }
      }).catch(function () {});
    }

    // M3-3：每 60s 拉一次最新状态，刷新外观（饿/蔫/开心）
    setInterval(function () {
      if (!api.state || !api.state.load) return;
      Promise.resolve(api.state.load()).then(function (s) {
        if (s && s.stats) applyMood(s.stats);
      }).catch(function () {});
    }, 60 * 1000);

    // M8-7：启动自愈/首次运行等主进程通知，用气泡转述
    if (api.state && api.state.notices) {
      Promise.resolve(api.state.notices()).then(function (list) {
        if (list && list.length) say(list[0]);
      }).catch(function () {});
    }
  }

  // M4b：形象被上传/切换/删除时主进程实时推送；null 表示需要按当前数据重取
  if (api.on) {
    api.on('look:changed', function (views) {
      if (views) { applyViews(views); return; }
      // 数据恢复/删除当前形象等场景：回到数据里的 currentLookId（或内置默认）
      if (api.state && api.state.load) {
        Promise.resolve(api.state.load()).then(function (s) {
          if (s && s.currentLookId && api.looks && api.looks.getViews) {
            return api.looks.getViews(s.currentLookId).then(function (r) {
              applyViews(r && r.ok && r.views ? r.views : DEFAULT_LOOK);
            });
          }
          applyViews(DEFAULT_LOOK);
        }).catch(function () { applyViews(DEFAULT_LOOK); });
      } else {
        applyViews(DEFAULT_LOOK);
      }
    });

    // M5：设置变化实时生效（大小 / 漫游）
    api.on('settings:changed', function (st) {
      if (!st) return;
      if (Number.isFinite(st.size)) setSize(st.size);
      if (typeof st.wanderEnabled === 'boolean') setWander(st.wanderEnabled);
    });

    // M9：主进程巡检发现窗口越界并纠正后，同步本地坐标并刷新屏幕信息
    api.on('win:restored', function (m) {
      if (m && m.position) lastPos = m.position;
      invalidateDisplays();
    });

    // M9 兜底自查：显示器变化（拔屏/改分辨率/改缩放）后屏幕信息作废并请求校正
    if (window.screen && window.screen.addEventListener) {
      try {
        window.screen.addEventListener('change', function () {
          invalidateDisplays();
          if (api.win && api.win.ensureVisible) {
            api.win.ensureVisible().catch(function () {});
          }
        });
      } catch (_) {}
    }

    // M6：托盘/右键菜单触发的互动，给宠物对应的动作与台词反馈
    api.on('pet:act', function (m) {
      if (!m || !m.ok) return;
      if (m.kind === 'feed') { play('excited'); say('开饭啦，谢谢主人！'); }
      else if (m.kind === 'pet') { play('wiggle'); say(rand(SAY.poke)); }
      else if (m.kind === 'play') { play(rand(['jump', 'dance'])); say('玩喽！'); }
      else if (m.kind === 'sleep') { play('sleep'); }
    });
  }

  boot();
})();
