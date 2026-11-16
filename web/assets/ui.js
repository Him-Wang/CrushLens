/* ============================================================
 * CrushLens Cloud · 共用 UI 组件与图表
 * ============================================================ */
(function (root) {
  'use strict';

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* ---------------- 图标 ---------------- */
  const ICONS = {
    dash: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z',
    import: 'M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    radio: 'M12 12h.01M7.05 16.95a7 7 0 0 1 0-9.9m9.9 0a7 7 0 0 1 0 9.9M4.22 19.78a11 11 0 0 1 0-15.56m15.56 0a11 11 0 0 1 0 15.56',
    report: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8M8 17h5',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
    plus: 'M12 5v14M5 12h14',
    up: 'M7 17 17 7M17 7H9m8 0v8',
    down: 'M7 7l10 10M17 17H9m8 0V9',
    flat: 'M4 12h16',
    trash: 'M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15',
    close: 'M18 6 6 18M6 6l12 12',
    search: 'M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z',
    lock: 'M5 11h14v10H5V11Zm3 0V7a4 4 0 1 1 8 0v4',
    key: 'M15 7a4 4 0 1 1-3.5 5.9L9 15.5l-2-.5-.5-2 2.5-2.5A4 4 0 0 1 15 7Z',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-14v5l3 2',
    check: 'M20 6 9 17l-5-5',
    x: 'M18 6 6 18M6 6l12 12',
    alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
    spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z',
    heart: 'M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21l8.8-8.3a5 5 0 0 0 0-7.1Z',
    refresh: 'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6',
    calendar: 'M8 2v4m8-4v4M3 10h18M5 6h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
    filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
    more: 'M12 6h.01M12 12h.01M12 18h.01',
    user: 'M20 21a8 8 0 1 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    wifi: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5.5 5.5 0 0 1 7 0M12 20h.01M2 9a15 15 0 0 1 20 0',
    phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm3 17h2'
  };

  function icon(name, size, cls) {
    const p = ICONS[name] || ICONS.dash;
    const filled = name === 'dash';
    return `<svg class="ico ${cls || ''}" width="${size || 18}" height="${size || 18}" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="${p}" ${filled ? 'fill="currentColor" stroke="none"' : ''}/></svg>`;
  }

  /* ---------------- 格式化 ---------------- */
  function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  function fmtDateFull(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function fmtDT(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return `${fmtDateFull(ts)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function relTime(ts) {
    if (!ts) return '—';
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 86400000 * 7) return Math.floor(diff / 86400000) + ' 天前';
    return fmtDateFull(ts);
  }
  function fmtNum(n) {
    if (n == null) return '—';
    if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
    return String(n);
  }

  /* ---------------- Toast ---------------- */
  let toastWrap = null;
  function toast(msg, type) {
    if (!toastWrap) {
      toastWrap = el('div', 'toast-wrap');
      document.body.appendChild(toastWrap);
    }
    const t = el('div', 'toast ' + (type || ''));
    t.innerHTML = `${icon(type === 'error' ? 'alert' : type === 'warn' ? 'alert' : 'check', 16)}<span>${esc(msg)}</span>`;
    toastWrap.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => {
      t.classList.remove('in');
      setTimeout(() => t.remove(), 300);
    }, 2800);
  }

  /* ---------------- 弹窗 ---------------- */
  function modal(opts) {
    const wrap = el('div', 'modal-mask');
    wrap.innerHTML = `
      <div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div>
            <h3>${esc(opts.title || '')}</h3>
            ${opts.sub ? `<p class="modal-sub">${esc(opts.sub)}</p>` : ''}
          </div>
          <button class="icon-btn" data-close aria-label="关闭">${icon('close', 18)}</button>
        </div>
        <div class="modal-body">${opts.html || ''}</div>
        ${opts.footer ? `<div class="modal-foot">${opts.footer}</div>` : ''}
      </div>`;
    document.body.appendChild(wrap);
    document.body.classList.add('no-scroll');
    const close = () => {
      wrap.classList.remove('in');
      setTimeout(() => { wrap.remove(); document.body.classList.remove('no-scroll'); }, 180);
    };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });
    requestAnimationFrame(() => wrap.classList.add('in'));
    if (opts.onMount) opts.onMount(wrap, close);
    return { el: wrap, close };
  }

  function confirmDlg(opts) {
    return new Promise((resolve) => {
      const m = modal({
        title: opts.title,
        sub: opts.sub,
        html: `<p class="confirm-text">${opts.text || ''}</p>`,
        footer: `<button class="btn ghost" data-close>取消</button>
                 <button class="btn ${opts.danger ? 'danger' : 'primary'}" data-ok>${esc(opts.okText || '确定')}</button>`
      });
      m.el.querySelector('[data-ok]').onclick = () => { m.close(); resolve(true); };
      m.el.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]') || e.target === m.el) resolve(false);
      });
    });
  }

  /* ---------------- 折线趋势图 ---------------- */
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function trendChart(opts) {
    const W = 920, H = opts.height || 300;
    const P = { l: 40, r: 16, t: 18, b: 30 };
    const daily = opts.daily || [];
    const forecast = opts.forecast || [];
    const ma = opts.ma || [];
    const points = opts.changePoints || [];

    const n = daily.length + forecast.length;
    if (!n) return el('div', 'chart-empty', '还没有足够的数据');

    const stepX = (W - P.l - P.r) / Math.max(1, n - 1);
    const yOf = (v) => P.t + (1 - v / 100) * (H - P.t - P.b);
    const xOf = (i) => P.l + i * stepX;

    // 分段路径（处理 null）
    function segPath(vals, idxOffset) {
      let d = '', pen = false;
      vals.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        const x = xOf(i + (idxOffset || 0)), y = yOf(v);
        d += (pen ? ' L' : ' M') + x.toFixed(1) + ' ' + y.toFixed(1);
        pen = true;
      });
      return d.trim();
    }

    const dailyScores = daily.map((d) => (d.score == null ? null : d.score));
    const areaD = (() => {
      let d = '', started = false, lastX = 0;
      dailyScores.forEach((v, i) => {
        if (v == null) return;
        const x = xOf(i), y = yOf(v);
        if (!started) { d += `M${x} ${H - P.b} L${x} ${y}`; started = true; }
        else d += ` L${x} ${y}`;
        lastX = x;
      });
      if (started) d += ` L${lastX} ${H - P.b} Z`;
      return d;
    })();

    // 置信带
    let bandD = '';
    if (forecast.length) {
      const off = daily.length - 1;
      const start = { x: xOf(off), y: yOf(dailyScores[off] == null ? 50 : dailyScores[off]) };
      const upPts = forecast.map((f, i) => ({ x: xOf(off + i + 1), y: yOf(f.hi) }));
      const dnPts = forecast.map((f, i) => ({ x: xOf(off + i + 1), y: yOf(f.lo) })).reverse();
      bandD = 'M' + start.x.toFixed(1) + ' ' + start.y.toFixed(1)
        + ' L' + upPts.map((p) => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' L')
        + ' L' + dnPts.map((p) => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' L') + ' Z';
    }

    // X 轴标签
    let xLabels = '';
    const tickEvery = Math.max(1, Math.ceil(n / 7));
    for (let i = 0; i < n; i += tickEvery) {
      const label = i < daily.length ? (daily[i].date || '').slice(5) : (forecast[i - daily.length] || {}).date?.slice(5) || '';
      xLabels += `<text x="${xOf(i).toFixed(1)}" y="${H - 10}" class="ax">${esc(label)}</text>`;
    }

    let yGrid = '';
    [0, 25, 50, 75, 100].forEach((v) => {
      yGrid += `<line x1="${P.l}" y1="${yOf(v)}" x2="${W - P.r}" y2="${yOf(v)}" class="grid"/>
                <text x="${P.l - 8}" y="${yOf(v) + 4}" class="ax ay">${v}</text>`;
    });

    let marks = '';
    points.forEach((p) => {
      const idx = daily.findIndex((d) => d.date === p.date);
      if (idx < 0) return;
      const x = xOf(idx), y = yOf(daily[idx].score || 50);
      marks += `<g class="cp ${p.up ? 'up' : 'down'}">
        <circle cx="${x}" cy="${y}" r="7" class="cp-halo"/>
        <circle cx="${x}" cy="${y}" r="3.5" class="cp-dot"/>
        <title>${p.date} ${p.up ? '回升' : '回落'} ${p.diff}</title>
      </g>`;
    });

    const lastIdx = daily.length - 1;
    const lastVal = dailyScores[lastIdx];
    const lastDot = lastVal != null
      ? `<circle cx="${xOf(lastIdx)}" cy="${yOf(lastVal)}" r="5" class="last-dot"/>
         <circle cx="${xOf(lastIdx)}" cy="${yOf(lastVal)}" r="10" class="last-halo"/>` : '';

    const svg = `
    <svg viewBox="0 0 ${W} ${H}" class="trend-svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--rose)" stop-opacity=".26"/>
          <stop offset="70%" stop-color="var(--rose)" stop-opacity=".05"/>
          <stop offset="100%" stop-color="var(--rose)" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="lineG" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#fb7185"/>
          <stop offset="55%" stop-color="#e11d48"/>
          <stop offset="100%" stop-color="#9f1239"/>
        </linearGradient>
      </defs>
      ${yGrid}
      <path d="${areaD}" fill="url(#areaG)"/>
      <path d="${bandD}" class="band"/>
      <path d="${segPath(dailyScores)}" class="line-main"/>
      <path d="${segPath(ma)}" class="line-ma"/>
      <path d="${segPath([dailyScores[lastIdx]].concat(forecast.map((f) => f.score)), lastIdx)}" class="line-fc"/>
      ${marks}
      ${lastDot}
      ${xLabels}
      <g class="hover-layer"></g>
    </svg>`;

    const box = el('div', 'trend-box');
    box.innerHTML = svg;
    const svgEl = box.querySelector('svg');

    // 悬停提示
    const tip = el('div', 'chart-tip');
    box.appendChild(tip);
    svgEl.addEventListener('pointermove', (ev) => {
      const rect = svgEl.getBoundingClientRect();
      const relX = (ev.clientX - rect.left) / rect.width * W;
      let idx = Math.round((relX - P.l) / stepX);
      idx = Math.max(0, Math.min(n - 1, idx));
      const isFc = idx >= daily.length;
      const item = isFc ? forecast[idx - daily.length] : daily[idx];
      if (!item) return;
      const val = isFc ? item.score : item.score;
      if (val == null) return;
      tip.innerHTML = `
        <div class="tip-date">${esc(item.date)}${isFc ? ' · 预测' : ''}</div>
        <div class="tip-val">${Math.round(val)}<span>分</span></div>
        ${!isFc ? `<div class="tip-meta">${item.count || 0} 条消息</div>` : `<div class="tip-meta">区间 ${Math.round(item.lo)}–${Math.round(item.hi)}</div>`}`;
      const px = (xOf(idx) / W) * rect.width;
      const py = (yOf(val) / H) * rect.height;
      tip.style.left = Math.max(8, Math.min(rect.width - 120, px - 52)) + 'px';
      tip.style.top = Math.max(4, py - 74) + 'px';
      tip.classList.add('in');
    });
    svgEl.addEventListener('pointerleave', () => tip.classList.remove('in'));

    return box;
  }

  /* ---------------- 迷你走势 ---------------- */
  function sparkline(values, color, w, h) {
    const W = w || 88, H = h || 28;
    const vals = (values || []).filter((v) => v != null);
    if (vals.length < 2) return `<svg width="${W}" height="${H}"></svg>`;
    const min = Math.min(...vals), max = Math.max(...vals);
    const rng = max - min || 1;
    const step = W / (vals.length - 1);
    const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(H - 3 - ((v - min) / rng) * (H - 6)).toFixed(1)}`);
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="spark" preserveAspectRatio="none">
      <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  /* ---------------- 仪表盘（半环） ---------------- */
  function gauge(score, opts) {
    const o = opts || {};
    const size = o.size || 190;
    const r = 74, cx = 100, cy = 100;
    const circ = Math.PI * r;
    const pct = Math.max(0, Math.min(100, score)) / 100;
    const col = score >= 70 ? '#e11d48' : score >= 50 ? '#f59e0b' : '#64748b';
    return `<svg viewBox="0 0 200 118" class="gauge" style="width:${size}px">
      <defs><linearGradient id="gG" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#fda4af"/><stop offset="100%" stop-color="${col}"/>
      </linearGradient></defs>
      <path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="var(--line)" stroke-width="14" stroke-linecap="round"/>
      <path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="url(#gG)" stroke-width="14"
        stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - pct)}" class="gauge-fill"/>
      <text x="100" y="88" text-anchor="middle" class="gauge-num">${Math.round(score)}</text>
      <text x="100" y="106" text-anchor="middle" class="gauge-lab">${esc(o.label || '情感浓度')}</text>
      <text x="14" y="112" class="gauge-mini">0</text>
      <text x="176" y="112" text-anchor="end" class="gauge-mini">100</text>
    </svg>`;
  }

  /* ---------------- 六维雷达 ---------------- */
  function radar(dims) {
    const keys = Object.keys(dims || {});
    if (!keys.length) return '';
    const cx = 150, cy = 132, R = 96;
    const N = keys.length;
    const pt = (i, ratio) => {
      const a = (Math.PI * 2 * i) / N - Math.PI / 2;
      return [cx + Math.cos(a) * R * ratio, cy + Math.sin(a) * R * ratio];
    };
    let rings = '';
    [0.25, 0.5, 0.75, 1].forEach((k) => {
      const p = keys.map((_, i) => pt(i, k).map((v) => v.toFixed(1)).join(',')).join(' ');
      rings += `<polygon points="${p}" fill="none" stroke="var(--line)" stroke-width="1"/>`;
    });
    let spokes = '', labels = '', dots = '';
    keys.forEach((k, i) => {
      const [x, y] = pt(i, 1);
      spokes += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--line)"/>`;
      const [lx, ly] = pt(i, 1.19);
      labels += `<text x="${lx}" y="${ly + 4}" text-anchor="middle" class="rd-lab">${esc(k)}</text>`;
      const [dx, dy] = pt(i, Math.max(0.06, (dims[k] || 0) / 100));
      dots += `<circle cx="${dx}" cy="${dy}" r="3.4" fill="var(--rose)"/>`;
    });
    const poly = keys.map((k, i) => pt(i, Math.max(0.03, (dims[k] || 0) / 100)).map((v) => v.toFixed(1)).join(',')).join(' ');
    return `<svg viewBox="0 0 300 270" class="radar">
      ${rings}${spokes}
      <polygon points="${poly}" fill="rgba(225,29,72,.16)" stroke="var(--rose)" stroke-width="2"/>
      ${dots}${labels}
    </svg>`;
  }

  /* ---------------- 环图 ---------------- */
  function donut(data, opts) {
    const items = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
    const total = items.reduce((s, x) => s + x[1], 0);
    const COLORS = ['#e11d48', '#7c3aed', '#2563eb', '#059669', '#f59e0b', '#0891b2', '#db2777', '#64748b'];
    if (!total) return '<div class="chart-empty">暂无数据</div>';
    const size = 168, r = 62, c = size / 2, circ = 2 * Math.PI * r;
    let acc = 0, arcs = '';
    items.forEach(([k, v], i) => {
      const frac = v / total;
      const len = frac * circ;
      arcs += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${COLORS[i % COLORS.length]}"
        stroke-width="20" stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-acc}"
        transform="rotate(-90 ${c} ${c})" class="donut-arc"><title>${esc(k)} ${v}</title></circle>`;
      acc += len;
    });
    const legend = items.map(([k, v], i) =>
      `<div class="lg-row"><i style="background:${COLORS[i % COLORS.length]}"></i>
        <span>${esc(k)}</span><b>${v}</b></div>`).join('');
    return `<div class="donut-wrap">
      <svg viewBox="0 0 ${size} ${size}" class="donut" style="width:${size}px">
        ${arcs}
        <text x="${c}" y="${c - 2}" text-anchor="middle" class="dn-num">${total}</text>
        <text x="${c}" y="${c + 16}" text-anchor="middle" class="dn-lab">${esc((opts && opts.label) || '总计')}</text>
      </svg>
      <div class="legend">${legend}</div>
    </div>`;
  }

  /* ---------------- 柱状图 ---------------- */
  function bars(data, opts) {
    const o = opts || {};
    const W = 560, H = o.height || 150, P = { l: 8, r: 8, t: 10, b: 22 };
    const items = data || [];
    if (!items.length) return '<div class="chart-empty">暂无数据</div>';
    const max = Math.max(1, ...items.map((d) => d.value));
    const bw = (W - P.l - P.r) / items.length;
    let out = '';
    items.forEach((d, i) => {
      const h = Math.max(2, ((H - P.t - P.b) * d.value) / max);
      const x = P.l + i * bw + bw * 0.18;
      const w = bw * 0.64;
      out += `<rect x="${x.toFixed(1)}" y="${(H - P.b - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"
        rx="${Math.min(4, w / 2)}" fill="${d.color || 'var(--rose)'}" opacity="${d.dim ? .35 : .9}"/>
        <title>${esc(d.label)}: ${d.value}</title>`;
      if (o.showLabels !== false && i % Math.ceil(items.length / 7) === 0) {
        out += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="ax">${esc(d.label)}</text>`;
      }
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="bars">${out}</svg>`;
  }

  /* ---------------- 头像 ---------------- */
  function avatar(name, color, size) {
    const s = size || 42;
    const [bg, fg] = color || ['#fecdd3', '#e11d48'];
    const ch = String(name || '?').slice(0, 1);
    return `<span class="avatar" style="width:${s}px;height:${s}px;background:${bg};color:${fg};font-size:${Math.round(s * 0.42)}px">${esc(ch)}</span>`;
  }

  /* ---------------- 空状态 ---------------- */
  function empty(iconName, title, text, actionHtml) {
    return `<div class="empty">
      <div class="empty-ico">${icon(iconName || 'spark', 26)}</div>
      <h4>${esc(title)}</h4>
      <p>${esc(text || '')}</p>
      ${actionHtml || ''}
    </div>`;
  }

  function chipTrend(momentum) {
    if (momentum > 1.5) return `<span class="chip up">${icon('up', 12)} 升温 ${momentum.toFixed(1)}</span>`;
    if (momentum < -1.5) return `<span class="chip down">${icon('down', 12)} 降温 ${Math.abs(momentum).toFixed(1)}</span>`;
    return `<span class="chip flat">${icon('flat', 12)} 平稳</span>`;
  }

  function scoreClass(s) {
    if (s >= 70) return 'hot';
    if (s >= 50) return 'warm';
    return 'cool';
  }

  /* ---------------- 窄屏侧栏抽屉 ----------------
     980px 以下侧栏是 fixed 抽屉：必须有遮罩挡住正文的误触，
     并且支持 × / 遮罩 / Esc 三种收起方式，打开时锁滚动、关掉后焦点还给汉堡按钮。 */
  function sideDrawer(opts) {
    const side = document.querySelector(opts.side);
    const toggle = document.querySelector(opts.toggle);
    if (!side || !toggle) return { open() { }, close() { }, isOpen: () => false };

    const bd = document.createElement('div');
    bd.className = 'side-backdrop';
    bd.hidden = true;
    document.body.appendChild(bd);

    const mq = window.matchMedia('(max-width: 980px)');
    let lastFocus = null;
    let hideTimer = null;

    const isOpen = () => side.classList.contains('open');

    function open() {
      if (!mq.matches || isOpen()) return;
      lastFocus = document.activeElement;
      side.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      bd.hidden = false;
      // 下一帧再加 show，保证 opacity 过渡生效
      requestAnimationFrame(() => bd.classList.add('show'));
      document.body.classList.add('side-locked');
      const first = side.querySelector('[data-side-close], button, a, [tabindex]');
      if (first) { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }
    }

    function close() {
      if (!isOpen()) return;
      side.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      bd.classList.remove('show');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { if (!isOpen()) bd.hidden = true; }, 260);
      document.body.classList.remove('side-locked');
      if (lastFocus && document.contains(lastFocus) && lastFocus.focus) {
        try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* 元素已不在，忽略 */ }
      }
    }

    toggle.setAttribute('aria-controls', side.id || 'side');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.onclick = () => { if (isOpen()) close(); else open(); };

    // 点遮罩收起
    bd.onclick = close;
    // × 收起；在抽屉里点了导航/对象也收起（和移动端习惯一致）
    side.addEventListener('click', (e) => {
      if (e.target.closest('[data-side-close]') || e.target.closest('[data-nav]') || e.target.closest('[data-pid]')) close();
    });
    // Esc 收起
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Escape' || e.key === 'Esc') && isOpen()) { e.stopPropagation(); close(); }
    });
    // 焦点陷阱：抽屉开着时 Tab 只在抽屉内循环，不会跑到背后的正文里
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !isOpen()) return;
      const items = [...side.querySelectorAll('button, a[href], select, input, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((x) => !x.disabled && x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !side.contains(active))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (active === last || !side.contains(active))) {
        e.preventDefault(); first.focus();
      }
    });
    // 拉宽回桌面尺寸时把状态清干净
    const onChange = (ev) => {
      if (ev.matches) return;
      side.classList.remove('open');
      bd.classList.remove('show');
      bd.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('side-locked');
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);

    return { open, close, isOpen };
  }

  root.UI = {
    $, $$, esc, el, icon, toast, modal, confirmDlg, sideDrawer,
    trendChart, sparkline, gauge, radar, donut, bars, avatar, empty,
    fmtDate, fmtDateFull, fmtDT, relTime, fmtNum, chipTrend, scoreClass
  };
})(window);
