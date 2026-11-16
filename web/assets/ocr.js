/* ============================================================
   心动镜 · 截图识别模块（客户端 OCR，图片不上传）
   引擎：tesseract.js 5（自托管在 assets/vendor 与 assets/tessdata）
   输入：微信 / QQ 1 对 1 聊天截图（可多张）
   输出：标准「名字 + 时间 + 内容」文本，交给主解析器
   ============================================================ */
(function (root) {
  const BASE = new URL('assets/', location.href).href;
  const VENDOR = BASE + 'vendor/';
  const TESSDATA = BASE + 'tessdata/';
  const CDN_FALLBACK = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

  let worker = null;
  let loading = null;

  /* ---------- 加载引擎（仅本地自托管，不再回落任何 CDN） ----------
     早期版本失败会去 CDN 拉 tesseract.min.js，但那等于往一个
     「能读到全部聊天记录」的页面里动态注入未校验的远程脚本，
     与「完全本地」的承诺也矛盾，这里直接去掉。 */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => { s.remove(); reject(new Error('load:' + src)); };
      document.head.appendChild(s);
    });
  }

  async function loadLib(onStatus) {
    if (root.Tesseract) return;
    if (loading) return loading;
    loading = (async () => {
      if (onStatus) onStatus('正在加载识别引擎（首次约 15MB，浏览器会缓存）…');
      let err = null;
      for (let i = 0; i < 2; i++) {
        try { await loadScript(VENDOR + 'tesseract.min.js'); return; }
        catch (e) { err = e; await new Promise((r) => setTimeout(r, 1200)); }
      }
      throw new Error('识别引擎加载失败（assets/vendor 缺文件或被拦截），请刷新页面重试');
    })();
    return loading;
  }

  async function getWorker(onProgress) {
    if (worker) return worker;
    await loadLib((m) => onProgress && onProgress({ phase: 'lib', msg: m }));
    worker = await root.Tesseract.createWorker(['chi_sim'], 1, {
      workerPath: VENDOR + 'worker.min.js',
      corePath: VENDOR,
      langPath: TESSDATA,
      logger: (m) => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress({ phase: 'ocr', progress: m.progress });
        }
      }
    });
    return worker;
  }

  /* ---------- 预处理 ----------
     实测结论（同一张仿真截图对比 4 种方案）：
     - 原图直喂：Tesseract 把彩底气泡当图片区域，绿底消息整条丢失；
     - 全局阈值 175：识别准，但换背景/深色模式就崩；
     - 自适应减法(mean-C)：彩底被切碎，出现 "CCCmmme" 之类乱码；
     - 背景归一化 g/localMean + 阈值：彩底与白底表现一致 ✔ 采用此方案。 */
  function preprocess(img) {
    const MAX_SIDE = 2400;      // 长截图也不要把字压小（实测压小后识别率明显下降）
    const MAX_PIXELS = 4000000; // 但必须封顶：积分图是按像素分配的，2000×10000 会直接吃满内存
    let scale = Math.min(3, Math.max(1, MAX_SIDE / Math.max(img.width, img.height)));
    let w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    if (w * h > MAX_PIXELS) {
      const k = Math.sqrt(MAX_PIXELS / (w * h));
      w = Math.max(1, Math.round(w * k));
      h = Math.max(1, Math.round(h * k));
      scale = w / img.width;
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    const px = d.data;

    let sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
      px[i] = px[i + 1] = px[i + 2] = g;
      sum += g;
    }
    const globalMean = sum / (px.length / 4);
    const dark = globalMean < 110; // 深色模式 → 先反色，保证「文字更暗」
    if (dark) {
      for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = 255 - px[i];
    }

    // 积分图求局部均值（像素数已封顶 4e6，Float64 最多约 32MB，可以接受）
    const iw = w + 1;
    const integ = new Float64Array(iw * (h + 1));
    for (let y = 0; y < h; y++) {
      let rs = 0;
      for (let x = 0; x < w; x++) {
        rs += px[(y * w + x) * 4];
        integ[(y + 1) * iw + (x + 1)] = integ[y * iw + (x + 1)] + rs;
      }
    }
    const win = Math.max(15, (Math.min(w, h) / 20) | 0);
    const half = win >> 1;
    const T = 200; // 归一化亮度阈值
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - half), y1 = Math.min(h - 1, y + half);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - half), x1 = Math.min(w - 1, x + half);
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);
        const s = integ[(y1 + 1) * iw + (x1 + 1)] - integ[y0 * iw + (x1 + 1)] -
          integ[(y1 + 1) * iw + x0] + integ[y0 * iw + x0];
        const m = Math.max(1, s / area);
        const g = px[(y * w + x) * 4];
        const v = (g * 255 / m) < T ? 0 : 255;
        px[(y * w + x) * 4] = px[(y * w + x) * 4 + 1] = px[(y * w + x) * 4 + 2] = v;
      }
    }
    ctx.putImageData(d, 0, 0);
    return c;
  }

  /* ---------- 文本清洗 ---------- */
  const CJK = '[\\u4e00-\\u9fa5\\u3000-\\u303f\\uff01-\\uff5e]';
  const RE_CJK_GAP = new RegExp('(?<=' + CJK + ')\\s+(?=' + CJK + ')', 'g');

  function tidy(text) {
    return (text || '').replace(/\s+/g, ' ').trim()
      .replace(RE_CJK_GAP, '')      // 「在 吗」→「在吗」
      .replace(/^[\s|丨Il!，,。.、:：;；'"“”‘’()（）\[\]【】<>《》]+/, '') // 气泡边缘残留
      .replace(/[\s|丨Il!，,。.、:：;；'"“”‘’()（）\[\]【】<>《》]+$/, '')
      .trim();
  }

  /* ---------- 时间分隔行 ---------- */
  const RE_DIV_TIME = /^(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2}):(\d{2})$/;
  const REL_DAYS = { '今天': 0, '昨天': 1, '前天': 2 };

  const OCR_FIX = { '脱': '晚', '隗': '晚', '且': '月', '目': '日', '囗': '日', '號': '号', '晓': '晚', '魄': '晚' };

  function tryDivider(line, dayCtx) {
    let t = line.replace(/\s+/g, '');
    t = t.replace(/[脱隗且目囗號晓魄]/g, (ch) => OCR_FIX[ch] || ch);
    t = t.replace(/上\s*午|上午/g, '上午').replace(/(晚|早|午|晨|凌)\s*(上|晨)?/g, (m) => m.replace(/\s/g, ''));
    let m;
    if ((m = t.match(/^(?:\d{4}年)?(\d{1,2})月(\d{1,2})日(?:(凌晨|早上|上午|中午|下午|晚上)?(\d{1,2}):(\d{2}))?$/))) {
      const d = new Date(dayCtx.getFullYear(), +m[1] - 1, +m[2]);
      let ct = null;
      if (m[4] != null) {
        let hh = +m[4];
        const tag = m[3] || '';
        if ((tag === '下午' || tag === '晚上') && hh < 12) hh += 12;
        if (tag === '凌晨' && hh === 12) hh = 0;
        if (tag === '中午' && hh < 12) hh = 12;
        ct = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, +m[5]);
      }
      return { dayCtx: d, curTime: ct };
    }
    if (REL_DAYS[t] != null) {
      const d = new Date(dayCtx); d.setDate(d.getDate() - REL_DAYS[t]);
      return { dayCtx: d, curTime: null };
    }
    if ((m = t.match(RE_DIV_TIME))) {
      let hh = +m[2];
      const tag = m[1] || '';
      if ((tag === '下午' || tag === '晚上') && hh < 12) hh += 12;
      if (tag === '凌晨' && hh === 12) hh = 0;
      if (tag === '中午' && hh < 12) hh = 12;
      return { dayCtx, curTime: new Date(dayCtx.getFullYear(), dayCtx.getMonth(), dayCtx.getDate(), hh, +m[3]) };
    }
    if (/^星期[一二三四五六日天]$/.test(t)) {
      const map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
      const base = new Date(dayCtx);
      const diff = (base.getDay() - map[t[2]] + 7) % 7 || 7;
      base.setDate(base.getDate() - diff);
      return { dayCtx: base, curTime: null };
    }
    return null;
  }

  function skipLine(text) {
    const t = (text || '').trim();
    if (!t) return true;
    if (/^[\s\p{P}\p{S}]+$/u.test(t)) return true;
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return true;
    if (/撤回了一条消息|以上是打招呼的内容|对方开启了朋友验证|消息已发出/.test(t)) return true;
    if ([...t].length < 2 && !/\d/.test(t)) return true;
    return false;
  }

  /* ---------- 词块 → 行 → 左右分段 ----------
     Tesseract 会把同一水平线上的左右两个气泡并成「一行」，
     必须回到 word 级，用横向间隙把气泡切开，才能判断谁说的。 */
  function collectWords(data) {
    const out = [];
    (data.blocks || []).forEach((b) =>
      (b.paragraphs || []).forEach((p) =>
        (p.lines || []).forEach((l) =>
          (l.words || []).forEach((wd) => {
            const t = (wd.text || '').trim();
            if (!t) return;
            out.push({ t, x0: wd.bbox.x0, x1: wd.bbox.x1, y0: wd.bbox.y0, y1: wd.bbox.y1 });
          }))));
    if (out.length) return out;
    // 退化：没有 word 信息时用 line
    (data.blocks || []).forEach((b) =>
      (b.paragraphs || []).forEach((p) =>
        (p.lines || []).forEach((l) => {
          const t = (l.text || '').trim();
          if (t) out.push({ t, x0: l.bbox.x0, x1: l.bbox.x1, y0: l.bbox.y0, y1: l.bbox.y1 });
        })));
    return out;
  }

  function groupRows(words) {
    const ws = words.slice().sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
    const rows = [];
    let cur = null;
    ws.forEach((wd) => {
      const cy = (wd.y0 + wd.y1) / 2, hgt = wd.y1 - wd.y0;
      if (cur && Math.abs(cy - cur.cy) <= Math.max(cur.h, hgt) * 0.55) {
        cur.words.push(wd);
        cur.cy = (cur.cy * (cur.words.length - 1) + cy) / cur.words.length;
        cur.h = Math.max(cur.h, hgt);
      } else {
        cur = { cy, h: hgt, words: [wd] };
        rows.push(cur);
      }
    });
    return rows;
  }

  function joinWords(list) {
    let s = '';
    list.forEach((wd, i) => {
      if (i === 0) { s = wd.t; return; }
      const prev = list[i - 1].t;
      const needSpace = /[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(wd.t);
      s += (needSpace ? ' ' : '') + wd.t;
    });
    return s;
  }

  function splitSegments(row, cw) {
    const list = row.words.slice().sort((a, b) => a.x0 - b.x0);
    const segs = [];
    let cur = null;
    list.forEach((wd) => {
      if (!cur) { cur = { words: [wd] }; return; }
      const prev = cur.words[cur.words.length - 1];
      const gap = wd.x0 - prev.x1;
      if (gap > cw * 0.05) { segs.push(cur); cur = { words: [wd] }; }
      else cur.words.push(wd);
    });
    if (cur) segs.push(cur);
    return segs.map((s) => {
      const xs = s.words.map((w) => w.x0), xe = s.words.map((w) => w.x1);
      return {
        text: tidy(joinWords(s.words)),
        x0: Math.min(...xs), x1: Math.max(...xe),
        y0: Math.min(...s.words.map((w) => w.y0)),
        y1: Math.max(...s.words.map((w) => w.y1))
      };
    }).filter((s) => s.text);
  }

  /**
   * 处理一批截图，返回可直接粘贴的文本
   * files: File[]; opts: { mine, theirs, onProgress }
   */
  async function process(files, opts) {
    const { mine = '我', theirs = '对方', onProgress } = opts || {};
    const wk = await getWorker((p) => onProgress && onProgress({ phase: 'lib', msg: p.msg, progress: 0 }));

    const out = [];
    let dayCtx = new Date();
    let curTime = null;
    let lastSide = null, lastParts = [], lastY1 = -1, lastH = 0;

    const flushMsg = () => {
      const side = lastSide, parts = lastParts;
      lastSide = null; lastParts = []; lastY1 = -1;
      if (!side || !parts.length) return;
      const text = parts.join('\n').trim();
      if (!text) return;
      if (!curTime) curTime = new Date(dayCtx.getFullYear(), dayCtx.getMonth(), dayCtx.getDate(), 10, 0);
      else curTime = new Date(curTime.getTime() + 60000);
      const pad = (n) => String(n).padStart(2, '0');
      const ts = `${curTime.getFullYear()}年${curTime.getMonth() + 1}月${curTime.getDate()}日 ${pad(curTime.getHours())}:${pad(curTime.getMinutes())}`;
      out.push(`${side === 'me' ? mine : theirs}\n${ts}\n${text}\n`);
    };

    for (let fi = 0; fi < files.length; fi++) {
      if (onProgress) onProgress({ phase: 'file', msg: `识别第 ${fi + 1}/${files.length} 张…`, progress: fi / files.length });
      const img = await fileToImage(files[fi]);
      const canvas = preprocess(img);
      const { data } = await wk.recognize(canvas);
      const cw = canvas.width, ch = canvas.height;
      const rows = groupRows(collectWords(data));

      for (const row of rows) {
        for (const seg of splitSegments(row, cw)) {
          const cx = (seg.x0 + seg.x1) / 2 / cw;
          const x0 = seg.x0 / cw, x1 = seg.x1 / cw;
          const y0 = seg.y0 / ch, y1 = seg.y1 / ch;
          const hgt = y1 - y0;
          if (y0 > 0.95) continue; // 底部输入栏

          // 居中短行 → 时间分隔
          if (cx > 0.34 && cx < 0.66) {
            const dv = tryDivider(seg.text, dayCtx);
            if (dv) {
              flushMsg();
              dayCtx = dv.dayCtx;
              if (dv.curTime) curTime = dv.curTime;
              continue;
            }
            // 分隔行识别失败时的兜底：只有「像时间」的才丢（含数字 + 只由时间字符组成）
            const t2 = seg.text;
            const timeish = /\d/.test(t2) && t2.length <= 18 &&
              /^[\d\s:：.\/\-月日年号星期一二三四五六日天上午下午晚上早中凌晨今昨前分秒约左右小时个]*$/.test(t2);
            if (timeish) continue;
          }
          if (skipLine(seg.text)) continue;

          // 左右判断：右侧=自己，左侧=对方
          let side;
          if (x0 > 0.5 && cx > 0.6) side = 'me';
          else if (x1 < 0.5 && cx < 0.4) side = 'theirs';
          else side = cx > 0.5 ? 'me' : 'theirs';

          const newBubble = side === lastSide && lastY1 >= 0 && (y0 - lastY1) > Math.max(lastH, hgt) * 1.5;
          if (side === lastSide && !newBubble) lastParts.push(seg.text);
          else { flushMsg(); lastSide = side; lastParts = [seg.text]; }
          lastY1 = y1; lastH = hgt;
        }
      }
    }
    flushMsg();
    return out.join('\n');
  }

  function fileToImage(f) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败：' + f.name)); };
      img.src = url;
    });
  }

  root.CLShot = { process, _dbg: { preprocess, collectWords, groupRows, splitSegments } };
})(typeof window !== 'undefined' ? window : globalThis);
