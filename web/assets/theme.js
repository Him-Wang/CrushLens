/* ============================================================
   CrushLens Cloud · 主题系统
   - 5 套主题：玫瑰(默认)/雾蓝/抹茶/黄昏/夜间(深色)
   - 跟随系统：localStorage 没有手动选择时，prefers-color-scheme 说了算，
     系统切换时实时跟随（matchMedia change），手动选过以手动为准
   - 防闪烁：index.html / admin.html 的 <head> 里有内联脚本先挂 data-theme
   ============================================================ */
(function (root) {
  'use strict';

  const KEY = 'cl_theme';
  const THEMES = [
    { id: 'rose',   label: '玫瑰',   dark: false },
    { id: 'mist',   label: '雾蓝',   dark: false },
    { id: 'matcha', label: '抹茶',   dark: false },
    { id: 'dusk',   label: '黄昏',   dark: false },
    { id: 'night',  label: '夜间',   dark: true }
  ];
  const IDS = THEMES.map((t) => t.id);

  // 每个主题的头像配色板（[底, 字] × 8）。store.pickColor 只负责按名字散列出索引，
  // 真正显示什么颜色由当前主题决定，换主题时头像跟着变。
  const AVATAR_PALETTES = {
    rose: [
      ['#ffe4e6', '#be123c'], ['#fce7f3', '#be185d'], ['#ede9fe', '#6d28d9'], ['#dbeafe', '#1d4ed8'],
      ['#d1fae5', '#047857'], ['#fef3c7', '#b45309'], ['#cffafe', '#0e7490'], ['#e2e8f0', '#475569']
    ],
    mist: [
      ['#dbeafe', '#1d4ed8'], ['#e0f2fe', '#0369a1'], ['#ede9fe', '#6d28d9'], ['#cffafe', '#0e7490'],
      ['#d1fae5', '#047857'], ['#fef3c7', '#b45309'], ['#ffe4e6', '#be123c'], ['#e2e8f0', '#475569']
    ],
    matcha: [
      ['#d1fae5', '#047857'], ['#dcfce7', '#15803d'], ['#ecfccb', '#4d7c0f'], ['#cffafe', '#0e7490'],
      ['#dbeafe', '#1d4ed8'], ['#fef3c7', '#b45309'], ['#ffe4e6', '#be123c'], ['#e2e8f0', '#475569']
    ],
    dusk: [
      ['#ffedd5', '#c2410c'], ['#fef3c7', '#b45309'], ['#ffe4e6', '#be123c'], ['#fce7f3', '#be185d'],
      ['#ede9fe', '#6d28d9'], ['#d1fae5', '#047857'], ['#dbeafe', '#1d4ed8'], ['#e2e8f0', '#475569']
    ],
    night: [
      ['#3f2330', '#fda4af'], ['#3a2540', '#d8b4fe'], ['#232f4b', '#93c5fd'], ['#123a3f', '#67e8f9'],
      ['#15352a', '#6ee7b7'], ['#3d3018', '#fcd34d'], ['#3c2418', '#fdba74'], ['#2e2e38', '#cbd5e1']
    ]
  };

  // 环图等用的 8 色板（深色下整体提亮，保证对比度）
  const CHART_PALETTES = {
    rose:   ['#e11d48', '#7c3aed', '#2563eb', '#059669', '#f59e0b', '#0891b2', '#db2777', '#64748b'],
    mist:   ['#2563eb', '#0ea5e9', '#7c3aed', '#0891b2', '#059669', '#f59e0b', '#e11d48', '#64748b'],
    matcha: ['#059669', '#65a30d', '#0891b2', '#2563eb', '#f59e0b', '#e11d48', '#7c3aed', '#64748b'],
    dusk:   ['#ea580c', '#d97706', '#e11d48', '#db2777', '#7c3aed', '#059669', '#2563eb', '#64748b'],
    night:  ['#fb7185', '#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#22d3ee', '#f472b6', '#94a3b8']
  };

  const mqDark = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  const listeners = [];

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function systemTheme() { return mqDark.matches ? 'night' : 'rose'; }
  function current() {
    const s = stored();
    return (s && IDS.indexOf(s) >= 0) ? s : systemTheme();
  }

  function metaThemeColor(bg) {
    let m = document.querySelector('meta[name="theme-color"]');
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      document.head.appendChild(m);
    }
    m.setAttribute('content', bg);
  }

  function apply(id, opts) {
    const o = opts || {};
    // persist=false：系统深色切换等「非用户手动」的应用，不能写回 localStorage，
    // 否则第一次跟随系统后就被当成手动选择，之后再也不跟了
    const persist = o.persist !== false;
    // 'system' 表示清除手动选择，回到跟随系统
    if (id === 'system' || !id) {
      if (persist) { try { localStorage.removeItem(KEY); } catch (e) { } }
      id = systemTheme();
    } else if (IDS.indexOf(id) < 0) {
      id = systemTheme();
    } else if (persist) {
      try { localStorage.setItem(KEY, id); } catch (e) { }
    }
    document.documentElement.setAttribute('data-theme', id);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) metaThemeColor(bg);
    if (!o.silent) listeners.forEach((fn) => { try { fn(id); } catch (e) { } });
    return id;
  }

  let inited = false;
  function init() {
    // <head> 内联脚本已经挂过 data-theme；这里补齐 meta 并接上系统监听
    const id = current();
    apply(id, { silent: true, persist: false });
    if (inited) return id;
    inited = true;
    const onSys = () => { if (!stored()) apply(systemTheme(), { persist: false }); };
    if (mqDark.addEventListener) mqDark.addEventListener('change', onSys);
    else if (mqDark.addListener) mqDark.addListener(onSys);
    return id;
  }

  /* ---------------- 供渲染层取色 ---------------- */
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback || '';
  }
  function avatarPair(color) {
    // 兼容旧数据：partner.color 曾是 [bg,fg] 数组，继续原样用
    if (Array.isArray(color)) return color;
    const pal = AVATAR_PALETTES[current()] || AVATAR_PALETTES.rose;
    const idx = (typeof color === 'number' && isFinite(color)) ? color : 0;
    return pal[((idx % pal.length) + pal.length) % pal.length];
  }
  function chartPalette() {
    return (CHART_PALETTES[current()] || CHART_PALETTES.rose).slice();
  }

  root.CLTheme = {
    THEMES, init, apply, current,
    isManual: () => !!stored(),
    cssVar, avatarPair, chartPalette,
    onChange: (fn) => { if (typeof fn === 'function') listeners.push(fn); }
  };
})(window);
