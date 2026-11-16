/* ============================================================
 * CrushLens Cloud · 解析与情感计算引擎
 * 纯前端、确定性算法，不依赖任何外部 API
 * ============================================================ */
(function (root) {
  'use strict';

  /* ---------------- 词库 ---------------- */
  const LEX = {
    pos: ['喜欢', '想你', '想见', '想你啦', '开心', '高兴', '幸福', '哈哈', '嘿嘿', '嘻嘻', '抱抱',
      '亲亲', '爱你', '晚安', '早安', '宝贝', '宝', '乖', '可爱', '好看', '厉害', '棒', '牛啊',
      '谢谢', '辛苦', '注意身体', '早点睡', '陪你', '等你', '好呀', '好哒', '期待', '惦记',
      '想你啦', '抱一下', '么么', '害羞', '心跳', '心动', '甜', '暖暖', '安心', '踏实'],
    neg: ['烦', '算了', '随便你', '无语', '生气', '滚', '别烦', '不想说', '没什么', '失望', '难过',
      '冷战', '不回', '累了', '分手', '冷静一下', '呵呵', '够了', '没意思', '不想聊', '别问了',
      '你自己玩', '忙死了', '别闹', '烦不烦', '有病', '随便吧', '没必要', '算了算了'],
    cold: ['嗯', '嗯嗯', '哦', '哦哦', '好', '好的', '行', '行吧', '知道了', '随便', '没事', '算了',
      '呵呵', '在忙', '稍等', '再说吧', '看情况', '不知道', '不清楚'],
    care: ['吃饭', '吃了吗', '注意', '休息', '睡', '身体', '感冒', '吃药', '多喝', '保暖', '安全',
      '到家', '路上', '小心', '别熬夜', '照顾好'],
    open: ['我觉得', '其实', '说实话', '最近', '我一直', '我以前', '我担心', '我希望', '我喜欢',
      '我害怕', '我想', '我的想法', '我心里', '坦白说'],
    action: ['见面', '一起', '约', '明天', '周末', '出来', '带你', '请你', '安排', '计划', '一起去',
      '什么时候', '有空吗', '要不要'],
    intimate: ['宝', '宝贝', '亲爱的', '老公', '老婆', '亲亲', '抱抱', '想你', '乖', '媳妇', '小可爱']
  };

  const MEDIA_RE = /\[(图片|表情|语音|视频|文件|动画表情|链接|位置|红包|转账|名片|聊天记录|小程序|视频号|音乐|拍一拍)\]/g;
  const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2764}]/gu;
  const SYSTEM_RE = /(撤回了一条消息|加入了群聊|邀请.*加入了群聊|修改群名为|以上是打招呼的内容|你已添加了|消息已发出，但被对方拒收|开启了朋友验证|领取了.*红包|拍了拍)/;

  /* ---------------- 基础工具 ---------------- */
  function hash(str) {
    let h1 = 0x811c9dc5, h2 = 0x1000193;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 ^= c; h1 = (h1 * 16777619) >>> 0;
      h2 = ((h2 << 5) - h2 + c) >>> 0;
    }
    return ('0000000' + h1.toString(16)).slice(-8) + ('0000000' + h2.toString(16)).slice(-8);
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function dayKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / 86400000); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function tanh(x) { return Math.tanh(x); }

  function median(arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* ---------------- 时间解析 ---------------- */
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function parseTime(raw, fallbackYear) {
    if (!raw) return null;
    let s = String(raw).trim()
      .replace(/年|月/g, '-').replace(/日/g, ' ')
      .replace(/\s+/g, ' ');
    let m;

    // 2026-09-17 19:26:53 / 2026-09-17 19:26
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));

    // 09-17 19:26:53 / 9/17 19:26
    m = s.match(/^(\d{1,2})[-\/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
      const now = new Date();
      let y = fallbackYear || now.getFullYear();
      const d = new Date(y, +m[1] - 1, +m[2], +m[3], +m[4], +(m[5] || 0));
      if (!fallbackYear && d > addDays(now, 1)) d.setFullYear(y - 1);
      return d;
    }

    // 9/17/26, 7:26:53 PM  |  17/09/2026, 19:26
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (m) {
      let y = +m[3]; if (y < 100) y += 2000;
      let hh = +m[4];
      if (m[7]) { const pm = /PM/i.test(m[7]); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
      let mo = +m[1], dd = +m[2];
      if (mo > 12) { const t = mo; mo = dd; dd = t; }
      return new Date(y, mo - 1, dd, hh, +m[5], +(m[6] || 0));
    }

    // 2026/09/17 19:26
    m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));

    // Sep 17, 2026 7:26 PM
    m = s.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (m && MONTHS[m[1].toLowerCase()]) {
      let hh = +m[4];
      if (m[7]) { const pm = /PM/i.test(m[7]); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
      return new Date(+m[3], MONTHS[m[1].toLowerCase()], +m[2], hh, +m[5], +(m[6] || 0));
    }
    return null;
  }

  const RE_DATE_ONLY = /^\d{2,4}\s*[-\/年.]\s*\d{1,2}\s*[-\/月.]\s*\d{1,2}\s*日?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/;
  const RE_DATE_MD = /^\d{1,2}[-\/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?$/;
  const RE_TIME_ONLY = /^\d{1,2}:\d{2}(?::\d{2})?$/;
  const RE_TIME_TAIL = /(\d{4}[-\/年.]\d{1,2}[-\/月.]\d{1,2}日?\s+\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}[-\/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?|\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)$/;

  /* ---------------- 表头识别 ---------------- */
  function looksLikeName(line) {
    if (!line) return false;
    if (line.length > 26) return false;
    if (/^[\d\s\-:\/.]+$/.test(line)) return false;
    if (/[，。！？；]/.test(line)) return false;
    return true;
  }

  /**
   * 返回 { name, timeStr, inline, multi } 或 null
   * multi=true 表示正文在后续行
   */
  function matchHeader(line, next, allowTimeOnly) {
    const t = line.trim();
    if (!t) return null;
    let m;

    // [9/17/26, 7:26:53 PM] Alex: hi
    m = t.match(/^\[([^\]]+)\]\s*([^:：]{1,26})[:：]\s*(.*)$/);
    if (m && parseTime(m[1])) return { name: m[2].trim(), timeStr: m[1], inline: m[3], multi: false };

    // 17/09/2026, 19:26 - Alex: hi
    m = t.match(/^([\d\/]+,\s*[\d:]+\s*(?:[APap][Mm])?)\s+-\s+([^:：]{1,26})[:：]\s*(.*)$/);
    if (m && parseTime(m[1])) return { name: m[2].trim(), timeStr: m[1], inline: m[3], multi: false };

    // Alex: 2026-09-17 19:26:53 hello  /  Alex: 09-17 19:26:53
    m = t.match(/^([^:：]{1,26})[:：]\s*(\d{4}[-\/年.]\d{1,2}[-\/月.]\d{1,2}日?\s+\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}[-\/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?|\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\s*(.*)$/);
    if (m) return { name: m[1].trim(), timeStr: m[2], inline: m[3] || '', multi: true };

    // 2026-09-17 19:26:53 Alex  (QQ / 钉钉 导出，正文在下一行)
    m = t.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\s+(.{1,26})$/);
    if (m && looksLikeName(m[2])) return { name: cleanName(m[2]), timeStr: m[1], inline: '', multi: true };

    // Alex 2026-09-17 19:26  (钉钉)
    m = t.match(/^(.{1,26})\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)$/);
    if (m && looksLikeName(m[1])) return { name: cleanName(m[1]), timeStr: m[2], inline: '', multi: true };

    // 2026-09-17 19:26:53 Alex: hello
    m = t.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\s+([^:：]{1,26})[:：]\s*(.*)$/);
    if (m) return { name: m[2].trim(), timeStr: m[1], inline: m[3], multi: false };

    // 微信电脑版 / 手机合并转发：名字一行 + 时间一行
    // （合并转发复制出来只有 HH:MM，没有日期；日期由上下文行补充）
    if (looksLikeName(t) && next) {
      const nt = next.trim();
      if (RE_DATE_ONLY.test(nt) || RE_DATE_MD.test(nt)) {
        return { name: cleanName(t), timeStr: nt, inline: '', multi: true, threeLine: true };
      }
      if (RE_TIME_ONLY.test(nt) && allowTimeOnly) {
        return { name: cleanName(t), timeStr: nt, inline: '', multi: true, threeLine: true, timeOnly: true };
      }
    }
    return null;
  }

  function cleanName(s) {
    return s.replace(/[（(]\d{4,}[)）]\s*$/, '').replace(/^@/, '').trim();
  }

  function detectPlatform(text) {
    const t = String(text || '');
    const head = t.trimStart().slice(0, 40);
    if (/^[\[{]\s*["{[]/.test(head)) return 'json';
    if (/^\[\d{1,2}\/\d{1,2}\/\d{2,4},\s*\d{1,2}:\d{2}:\d{2}\s*[APap][Mm]\]/m.test(t)) return 'whatsapp';
    if (/^\s*\d{1,2}\/\d{1,2}\/\d{2,4},\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[APap][Mm])?\s*-/m.test(t)) return 'whatsapp';
    if (/^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/m.test(t)) return 'dingtalk';
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+\S+\(\d+\)/m.test(t)) return 'qq';
    if (/\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}/.test(t)) return 'wechat';
    // 手机合并转发：名字行 + 纯时分，出现 3 次以上
    if ((t.match(/(^|\n)[^\n:：\d][^\n:：]{0,19}\n\d{1,2}:\d{2}(?::\d{2})?(?=\n|$)/g) || []).length >= 3) return 'wechat';
    if (/^\S{1,20}:\s*\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2}/m.test(t)) return 'qq';
    if (/^\S{1,20}\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/m.test(t)) return 'dingtalk';
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/m.test(t)) return 'qq';
    if (/\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2}/.test(t)) return 'qq';
    if (/\S{1,20}:\s*\S/.test(t)) return 'paste';
    return 'unknown';
  }

  const PLATFORM_META = {
    wechat: { label: '微信', short: '微', color: '#07c160' },
    qq: { label: 'QQ', short: 'Q', color: '#12b7f5' },
    dingtalk: { label: '钉钉', short: '钉', color: '#3f7dff' },
    whatsapp: { label: 'WhatsApp', short: 'W', color: '#25d366' },
    json: { label: 'JSON', short: '{}', color: '#8b5cf6' },
    paste: { label: '粘贴', short: '文', color: '#f59e0b' },
    file: { label: '文件', short: '档', color: '#64748b' },
    unknown: { label: '未知格式', short: '?', color: '#94a3b8' }
  };

  /* ---------------- 主解析器 ---------------- */
  function parseChat(rawText, fileName) {
    const text = String(rawText || '').replace(/\r\n?/g, '\n');
    // JSON 分支
    const trimmed = text.trim();
    if (/^[\[{]/.test(trimmed)) {
      const fromJson = parseJsonChat(trimmed);
      if (fromJson) return fromJson;
    }
    const platform = detectPlatform(text, null);
    // 手机「合并转发」检测：名字行 + 纯 HH:MM 时间行的组合出现 >= 3 次才启用
    const forwardHits = (text.match(/(^|\n)[^\n:：\d][^\n:：]{0,19}\n\d{1,2}:\d{2}(?::\d{2})?(?=\n|$)/g) || []).length;
    const allowTimeOnly = forwardHits >= 3;
    const lines = text.split('\n');
    const messages = [];
    const speakers = new Map();
    let cur = null;
    let dayCtx = new Date(); // 合并转发（只有时分）的日期上下文
    const fallbackYear = new Date().getFullYear();

    function flush() {
      if (!cur) return;
      const body = cur.parts.join('\n').trim();
      if (body && !SYSTEM_RE.test(body)) {
        messages.push({
          speaker: cur.name,
          time: cur.time,
          text: body,
          media: (body.match(MEDIA_RE) || []).length
        });
        speakers.set(cur.name, (speakers.get(cur.name) || 0) + 1);
      }
      cur = null;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      if (!t) { if (cur) cur.parts.push(''); continue; }

      const h = matchHeader(line, lines[i + 1], allowTimeOnly);
      if (h) {
        flush();
        if (h.threeLine) { i++; } // 跳过时间行
        let tm = parseTime(h.timeStr, fallbackYear);
        if (h.timeOnly && !tm) {
          // 纯 HH:MM：挂到当前日期上下文上
          const mt = h.timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
          if (mt) tm = new Date(dayCtx.getFullYear(), dayCtx.getMonth(), dayCtx.getDate(), +mt[1], +mt[2], +(mt[3] || 0));
        }
        cur = { name: h.name, time: tm, parts: h.inline ? [h.inline] : [] };
        if (h.inline === '' && !h.multi) cur.parts = [''];
        continue;
      }

      // 单独日期行 -> 更新当天上下文，不作为消息
      if (RE_DATE_ONLY.test(t) || RE_DATE_MD.test(t)) {
        const dctx = parseTime(t, fallbackYear);
        if (dctx) dayCtx = dctx;
        continue;
      }

      if (cur) cur.parts.push(t);
    }
    flush();

    // 时间补全：没有时间的消息沿用上一条时间
    let last = null;
    messages.forEach((m) => {
      if (!m.time && last) m.time = new Date(last.getTime() + 60000);
      if (m.time) last = m.time;
    });

    const withTime = messages.filter((m) => m.time);
    const ordered = withTime.length > messages.length * 0.5;

    const distinct = [...speakers.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);

    return {
      platform: platform === 'unknown' ? (fileName ? 'file' : 'paste') : platform,
      detected: platform,
      messages: messages.filter((m) => m.text),
      speakers: distinct,
      firstAt: ordered && messages.length ? messages[0].time : null,
      lastAt: ordered && messages.length ? messages[messages.length - 1].time : null,
      hasTime: withTime.length > 0,
      fileName: fileName || null
    };
  }

  function parseJsonChat(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return null; }
    let arr = null;
    if (Array.isArray(data)) arr = data;
    else if (data && typeof data === 'object') {
      for (const key of ['messages', 'chat', 'data', 'list', 'records']) {
        if (Array.isArray(data[key])) { arr = data[key]; break; }
      }
    }
    if (!arr || !arr.length) return null;

    const pick = (o, keys) => { for (const k of keys) if (o[k] != null) return o[k]; return null; };
    const out = [];
    const speakers = new Map();
    for (const item of arr) {
      if (Array.isArray(item)) {
        const [a, b, c] = item;
        out.push({ speaker: String(a), text: String(b), time: parseTime(String(c)) });
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const sender = pick(item, ['sender', 'senderName', 'from', 'name', 'author', 'nickname', 'speaker', 'user']);
      const content = pick(item, ['content', 'text', 'message', 'body', 'msg', 'msgContent']);
      const time = pick(item, ['timestamp', 'time', 'date', 'createdAt', 'createTime', 'sendTime', 'ts', 'msgTime']);
      if (sender == null || content == null) continue;
      const s = String(sender).trim();
      let t = null;
      if (typeof time === 'number') t = new Date(time < 1e12 ? time * 1000 : time);
      else t = parseTime(String(time || ''));
      out.push({ speaker: s, text: String(content), time: t });
      speakers.set(s, (speakers.get(s) || 0) + 1);
    }
    if (!out.length) return null;
    return {
      platform: 'json', detected: 'json', messages: out,
      speakers: [...speakers.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]),
      firstAt: out[0].time, lastAt: out[out.length - 1].time,
      hasTime: out.some((m) => m.time), fileName: null
    };
  }

  /* ---------------- 文本特征 ---------------- */
  function countLex(text, list) {
    let c = 0;
    for (const w of list) {
      let idx = 0;
      while ((idx = text.indexOf(w, idx)) !== -1) { c++; idx += w.length; }
    }
    return c;
  }

  function features(msgs) {
    let pos = 0, neg = 0, cold = 0, care = 0, open = 0, action = 0, intimate = 0;
    let q = 0, emoji = 0, media = 0, chars = 0, late = 0;
    for (const m of msgs) {
      const t = m.text || '';
      pos += countLex(t, LEX.pos);
      neg += countLex(t, LEX.neg);
      care += countLex(t, LEX.care);
      open += countLex(t, LEX.open);
      action += countLex(t, LEX.action);
      intimate += countLex(t, LEX.intimate);
      if (/[?？]/.test(t)) q++;
      emoji += (t.match(EMOJI_RE) || []).length;
      media += m.media || 0;
      chars += t.replace(MEDIA_RE, '').length;
      if (/^(嗯+|哦+|好|好的|行|行吧|知道了|随便|没事|算了|呵呵)$/.test(t.trim())) cold++;
      const h = m.time ? m.time.getHours() : 12;
      if (h >= 23 || h < 3) late++;
    }
    const n = Math.max(1, msgs.length);
    return {
      n, pos, neg, cold, care, open, action, intimate, q, emoji, media,
      avgLen: chars / n,
      qRate: q / n,
      emojiRate: emoji / n,
      coldRate: cold / n,
      lateRate: late / n
    };
  }

  function speedScore(msgs) {
    const gaps = [];
    for (let i = 1; i < msgs.length; i++) {
      if (!msgs[i].time || !msgs[i - 1].time) continue;
      const g = (msgs[i].time - msgs[i - 1].time) / 60000;
      if (g > 0 && g < 360) gaps.push(g);
    }
    if (!gaps.length) return 0.55;
    const med = median(gaps);
    if (med <= 1.5) return 1;
    if (med <= 5) return 0.88;
    if (med <= 15) return 0.74;
    if (med <= 40) return 0.58;
    if (med <= 90) return 0.42;
    if (med <= 180) return 0.3;
    return 0.18;
  }

  function groupByDay(messages) {
    const map = new Map();
    for (const m of messages) {
      if (!m.time) continue;
      const k = dayKey(m.time);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(m);
    }
    return map;
  }

  /* ---------------- 核心分析 ---------------- */
  function analyze(messages, opts) {
    const options = opts || {};
    const me = options.me || null;
    const all = messages.filter((m) => m.text && m.time).sort((a, b) => a.time - b.time);
    if (!all.length) {
      return { empty: true, total: 0, daily: [], score: 0, dims: {}, forecast: [], review: [], narrative: null };
    }

    const byDay = groupByDay(all);
    const keys = [...byDay.keys()].sort();
    const firstDay = new Date(keys[0] + 'T00:00:00');
    const lastDay = new Date(keys[keys.length - 1] + 'T00:00:00');
    const spanDays = daysBetween(firstDay, lastDay) + 1;

    // 逐日打分
    let prevScore = null;
    const raw = [];
    for (let i = 0; i < spanDays; i++) {
      const d = addDays(firstDay, i);
      const k = dayKey(d);
      const dayMsgs = byDay.get(k) || [];
      if (!dayMsgs.length) { raw.push({ date: k, count: 0, active: false }); continue; }

      const f = features(dayMsgs);
      const meCount = me ? dayMsgs.filter((m) => m.speaker === me).length : 0;
      const meShare = me ? meCount / dayMsgs.length : 0.5;
      const recip = 1 - Math.abs(meShare - 0.5) * 2;
      const spd = speedScore(dayMsgs);

      // 主动开启：与上一条间隔 > 3 小时 视为新开启
      let init = 0;
      for (let j = 1; j < dayMsgs.length; j++) {
        const g = (dayMsgs[j].time - dayMsgs[j - 1].time) / 60000;
        if (g > 180) init++;
      }
      init = init / Math.max(1, Math.min(dayMsgs.length, 6));

      const lenNorm = clamp(f.avgLen / 22, 0, 1.3);

      let s = 50
        + 7.0 * tanh((f.pos - f.neg) / Math.max(5, f.n * 0.35))
        + 4.5 * tanh(f.intimate / 3)
        + 9.0 * (recip - 0.5) * 2
        + 7.0 * (spd - 0.5) * 2
        + 5.0 * tanh(f.qRate * f.n / Math.max(3, f.n * 0.28))
        + 4.0 * tanh(f.emojiRate * 12)
        + 3.5 * (clamp(lenNorm, 0, 1) - 0.45) * 2
        + 2.0 * tanh((f.lateRate - 0.12) * 8)
        - 8.0 * tanh(f.coldRate * 4)
        + 2.0 * tanh(init * 2);

      s = clamp(s, 4, 98);
      // EMA 平滑，避免单字消息造成尖刺
      if (prevScore != null) s = prevScore * 0.35 + s * 0.65;
      prevScore = s;

      raw.push({
        date: k, count: dayMsgs.length, active: true,
        score: Math.round(s * 10) / 10,
        pos: f.pos, neg: f.neg, cold: f.cold, q: f.q, emoji: f.emoji,
        avgLen: Math.round(f.avgLen * 10) / 10,
        meShare: Math.round(meShare * 100),
        speed: Math.round(spd * 100),
        late: Math.round(f.lateRate * 100),
        init: Math.round(init * 100),
        raw: Math.round(s)
      });
    }

    // 缺失日插值（只在缺口 <= 5 天时），超出则视为断联。
    // 注意：必须单遍构建，缺口日先以 score=null 入列，遇到下一个活跃日再回填，
    // 否则同一天会被 push 两次（曾出现 daily 55 条 / 实际 38 天的重复与日期非单调）。
    const daily = [];
    let lastActiveIdx = -1;
    raw.forEach((p, idx) => {
      if (!p.active) {
        daily.push({ date: p.date, count: 0, active: false, score: null, interp: false });
        return;
      }
      const gap = lastActiveIdx >= 0 ? idx - lastActiveIdx - 1 : 0;
      if (gap > 0 && gap <= 5) {
        const a = raw[lastActiveIdx].score, b = p.score;
        for (let j = 1; j <= gap; j++) {
          const node = daily[daily.length - gap + j - 1];
          if (!node || node.active) continue;
          const t = j / (gap + 1);
          node.score = Math.round((a + (b - a) * t) * 10) / 10;
          node.interp = true;
        }
      }
      daily.push({ ...p, interp: false });
      lastActiveIdx = idx;
    });

    const activePoints = daily.filter((d) => d.active || d.interp);
    const scores = activePoints.map((d) => d.score);
    const realDays = daily.filter((d) => d.active).length;

    // 内部叙事 / 转折点只看最近 90 天窗口；对外仍返回完整序列，
    // 保证 daily.length === spanDays、日期严格单调递增，图表再按区间切片。
    const viewDaily = daily.slice(-90);

    // 7 日均线（与 daily 等长、逐下标对齐）
    const ma = daily.map((d, i) => {
      const win = daily.slice(Math.max(0, i - 6), i + 1).filter((x) => x.score != null);
      if (!win.length) return null;
      return Math.round(win.reduce((a, b) => a + b.score, 0) / win.length * 10) / 10;
    });

    // 趋势斜率（最近 14 个有效点，按真实天数做横轴）
    const recent = activePoints.slice(-14);
    const slope = linSlope(
      recent.map((d) => daysBetween(firstDay, new Date(d.date + 'T00:00:00'))),
      recent.map((d) => d.score)
    );

    const lastScore = scores.length ? scores[scores.length - 1] : 0;
    const winLen = Math.min(7, Math.max(2, Math.floor(scores.length / 2)));
    const avg7 = mean(scores.slice(-winLen));
    const prior = scores.slice(0, Math.max(1, scores.length - winLen));
    const avgPrev7 = prior.length ? mean(prior.slice(-winLen)) : avg7;
    let momentum = avg7 - avgPrev7;
    if (scores.length < 4) momentum = slope * 3;

    // 预测未来 7 天：真实对话日少于 3 天时不给预测。
    // 单条消息也算出「未来 7 天 + 置信区间」是假精确，比不给结论更糟。
    const forecast = [];
    const canForecast = realDays >= 3;
    if (canForecast) {
      for (let k = 1; k <= 7; k++) {
        const damp = Math.pow(0.78, k - 1 < 0 ? 0 : k - 1);
        const drift = slope * k * damp;
        const revert = (54 - lastScore) * 0.09 * k;
        const v = clamp(lastScore + drift + revert, 6, 97);
        const band = 4.5 + 2.4 * k;
        forecast.push({
          date: dayKey(addDays(new Date(viewDaily[viewDaily.length - 1].date + 'T00:00:00'), k)),
          score: Math.round(v * 10) / 10,
          lo: Math.round(clamp(v - band, 3, 99) * 10) / 10,
          hi: Math.round(clamp(v + band, 3, 99) * 10) / 10
        });
      }
    }

    // 转折点：只认真实观测日，两侧各至少 2 个活跃日；
    // 缺口日（score=null）与插值日都不参与，避免把「没聊天」误读成「降温」。
    const points = [];
    for (let i = 2; i < viewDaily.length; i++) {
      if (!viewDaily[i].active) continue;
      const left = viewDaily.slice(Math.max(0, i - 3), i).filter((x) => x.active);
      const right = viewDaily.slice(i, i + 3).filter((x) => x.active);
      if (left.length < 2 || right.length < 2) continue;
      const before = mean(left.map((x) => x.score));
      const after = mean(right.map((x) => x.score));
      if (before == null || after == null) continue;
      const diff = after - before;
      if (Math.abs(diff) >= 9 && (points.length === 0 || i - points[points.length - 1].i >= 4)) {
        points.push({ i, date: viewDaily[i].date, diff: Math.round(diff * 10) / 10, up: diff > 0 });
      }
    }

    // 六维
    const lastWindow = all.filter((m) => m.time >= addDays(lastDay, -6));
    const fw = features(lastWindow);
    const dims = {
      主动: clamp(42 + (activePoints.length ? mean(activePoints.slice(-7).map((d) => d.init || 0)) : 0) * 0.55, 8, 98),
      回应: clamp(activePoints.length ? mean(activePoints.slice(-7).map((d) => d.speed || 0)) : 50, 8, 98),
      关心: clamp(44 + tanh(fw.care / Math.max(3, fw.n * 0.2)) * 34, 8, 98),
      开放: clamp(40 + tanh(fw.avgLen / 26) * 26 + tanh(fw.open / 5) * 18, 8, 98),
      亲密: clamp(38 + tanh(fw.intimate / 4) * 30 + tanh(fw.emojiRate * 10) * 18, 8, 98),
      行动: clamp(40 + tanh(fw.action / 6) * 36, 8, 98)
    };
    Object.keys(dims).forEach((k) => { dims[k] = Math.round(dims[k]); });

    const total = Math.round(Object.values(dims).reduce((a, b) => a + b, 0) / 6);

    const review = buildReview({
      scores, viewDaily, avg7, avgPrev7, winLen, momentum, slope, dims, fw,
      points, spanDays, total, firstDay, lastDay, all
    });

    const narrative = buildNarrative({
      total, avg7, avgPrev7, winLen, momentum, slope, dims, fw, points,
      firstDay, lastDay, count: all.length, forecast, viewDaily
    });

    return {
      empty: false,
      total,
      count: all.length,
      firstDay: dayKey(firstDay),
      lastDay: dayKey(lastDay),
      spanDays,
      realDays,
      canForecast,
      daily,
      ma,
      score: lastScore,
      avg7: Math.round(avg7 * 10) / 10,
      momentum: Math.round(momentum * 10) / 10,
      slope,
      dims,
      forecast,
      changePoints: points,
      review,
      narrative,
      features: fw,
      meShare: activePoints.length ? Math.round(mean(activePoints.map((d) => d.meShare || 0))) : 50
    };
  }

  function linSlope(xs, ys) {
    const n = xs.length;
    if (n < 2) return 0;
    const mx = mean(xs), my = mean(ys);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    return den === 0 ? 0 : num / den;
  }
  // 空数组必须返回 null（而不是 0）：否则「缺口日」会被当成 0 分参与均值，
  // 制造出 −58 分这类并不存在的断崖转折。
  function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
  function sum(a) { return a.reduce((x, y) => x + y, 0); }

  function buildReview(ctx) {
    const { avg7, avgPrev7, winLen, momentum, dims, fw, points, total, viewDaily } = ctx;
    const cards = [];
    const diff = avg7 - avgPrev7;

    let tone = 'flat', head = '基本持平';
    if (diff >= 6) { tone = 'up'; head = '明显升温'; }
    else if (diff >= 2) { tone = 'up-soft'; head = '温和升温'; }
    else if (diff <= -6) { tone = 'down'; head = '明显降温'; }
    else if (diff <= -2) { tone = 'down-soft'; head = '略微降温'; }

    cards.push({
      icon: 'trend', tone,
      title: '近 ' + winLen + ' 天 vs 前 ' + winLen + ' 天',
      value: (diff >= 0 ? '+' : '') + diff.toFixed(1),
      text: head + '。最近 ' + winLen + ' 天均值 ' + avg7.toFixed(1) + '，前一段 ' + (avgPrev7 || avg7).toFixed(1) + '。'
    });

    const active = viewDaily.filter((d) => d.active);
    if (active.length) {
      const peak = active.reduce((a, b) => (b.score > a.score ? b : a));
      const low = active.reduce((a, b) => (b.score < a.score ? b : a));
      cards.push({
        icon: 'peak', tone: 'up',
        title: '浓度峰值日',
        value: peak.date.slice(5),
        text: '当天 ' + peak.count + ' 条消息，浓度 ' + peak.score + '，是这段时间互动最密集的一天。'
      });
      cards.push({
        icon: 'low', tone: 'down',
        title: '浓度低谷日',
        value: low.date.slice(5),
        text: '当天 ' + low.count + ' 条消息，浓度 ' + low.score + '。可以回看那天的开头几条，找找断点在哪。'
      });
    }

    if (points.length) {
      const p = points[points.length - 1];
      cards.push({
        icon: 'turn', tone: p.up ? 'up' : 'down',
        title: '最近一个转折点',
        value: p.date.slice(5),
        text: (p.up ? '从这天开始回升 ' : '从这天开始回落 ') + Math.abs(p.diff).toFixed(1) + ' 分，是曲线里最明显的一次结构变化。'
      });
    }

    const sorted = Object.entries(dims).sort((a, b) => b[1] - a[1]);
    cards.push({
      icon: 'dim', tone: 'up',
      title: '最强维度 / 最弱维度',
      value: sorted[0][0] + ' · ' + sorted[0][1],
      text: '最强是「' + sorted[0][0] + '」(' + sorted[0][1] + ')，最弱是「' + sorted[sorted.length - 1][0] + '」(' + sorted[sorted.length - 1][1] + ')。想提分优先补短板。'
    });

    if (fw.coldRate > 0.18) {
      cards.push({
        icon: 'risk', tone: 'warn',
        title: '短句冷回应偏多',
        value: Math.round(fw.coldRate * 100) + '%',
        text: '最近窗口内有 ' + Math.round(fw.coldRate * 100) + '% 的消息是「嗯 / 哦 / 好的 / 随便」这类短回应，属于投入下降的典型信号。'
      });
    }
    if (fw.neg > fw.pos * 0.6 && fw.neg >= 3) {
      cards.push({
        icon: 'risk', tone: 'warn',
        title: '负向词占比偏高',
        value: fw.neg + ' 次',
        text: '最近窗口出现 ' + fw.neg + ' 次负向表达（烦 / 算了 / 随便等），建议先处理具体那件事，而不是继续追问情绪。'
      });
    }
    if (ctx.all && ctx.all.length) {
      cards.push({
        icon: 'balance', tone: 'flat',
        title: '数据覆盖',
        value: ctx.all.length + ' 条',
        text: '平均 ' + Math.round(ctx.all.length / Math.max(1, ctx.spanDays)) + ' 条/天，共 ' + ctx.spanDays + ' 天。数据越连续，趋势判断越准。'
      });
    }
    return cards;
  }

  function buildNarrative(c) {
    const { total, avg7, avgPrev7, winLen, momentum, slope, dims, fw, points, count, forecast } = c;
    const diff = avg7 - avgPrev7;
    let mood, level;
    if (total >= 75) { level = '高位稳定'; mood = '互动浓度处在高位'; }
    else if (total >= 62) { level = '温热'; mood = '互动浓度偏暖'; }
    else if (total >= 48) { level = '中性'; mood = '互动浓度中性'; }
    else if (total >= 35) { level = '偏冷'; mood = '互动浓度偏低'; }
    else { level = '冷淡'; mood = '互动浓度处于低位'; }

    const dir = momentum > 1.5 ? '上行' : momentum < -1.5 ? '下行' : '横盘';
    const sorted = Object.entries(dims).sort((a, b) => b[1] - a[1]);
    const lastF = forecast.length ? forecast[forecast.length - 1] : null;

    const paras = [];
    paras.push(
      '这段对话共 ' + count + ' 条有效消息，综合情感浓度 **' + total + '**，判定为「' + level + '」。' +
      '最近 ' + winLen + ' 天均值 ' + avg7.toFixed(1) + '，相比前一段' + (diff >= 0 ? '上升 ' : '下降 ') + Math.abs(diff).toFixed(1) +
      '，整体处于' + dir + '区间（斜率 ' + slope.toFixed(2) + '/天）。'
    );

    paras.push(
      '结构上看，「' + sorted[0][0] + '」是这段关系最扎实的一块（' + sorted[0][1] + ' 分），' +
      '「' + sorted[sorted.length - 1][0] + '」相对薄弱（' + sorted[sorted.length - 1][1] + ' 分）。' +
      '消息平均长度 ' + fw.avgLen.toFixed(1) + ' 字，提问率 ' + Math.round(fw.qRate * 100) + '%，' +
      '表情/图片密度 ' + (fw.emoji + fw.media) + ' 个。'
    );

    if (points.length) {
      const last = points[points.length - 1];
      paras.push(
        '曲线在 ' + last.date + ' 出现一次' + (last.up ? '向上' : '向下') + '转折（' +
        (last.diff > 0 ? '+' : '') + last.diff + ' 分）。转折点往往对应一次具体的对话事件，' +
        '建议回到那天的前 20 条消息看看发生了什么——这比看总分有用得多。'
      );
    }

    if (lastF) {
      paras.push(
        '按当前斜率外推，7 天后浓度大致落在 **' + Math.round(lastF.score) + '** 附近（区间 ' +
        Math.round(lastF.lo) + '–' + Math.round(lastF.hi) + '）。这是趋势外推，不是预言；' +
        '如果中间出现一次长对话或一次冷处理，曲线会明显偏离。'
      );
    } else {
      paras.push('当前真实对话日不足 3 天，暂不做 7 天外推——样本这么薄时给出的「预测区间」没有参考价值，多聊几天再看趋势。');
    }

    const advice = [];
    if (dims['行动'] < 50) advice.push('「行动」偏低：把聊天里出现过的具体提议（见面/一起做什么）落地一次，比继续加话题更能提浓度。');
    if (dims['回应'] < 50) advice.push('「回应」偏低：拉长回复间隔不等于有分寸，试着在对方发消息后的活跃时段内回，质量比速度重要。');
    if (dims['关心'] < 50) advice.push('「关心」偏低：少问「在干嘛」，多针对具体的事（吃饭/加班/身体）给一句具体的关心。');
    if (fw.coldRate > 0.18) advice.push('短句冷回应占比 ' + Math.round(fw.coldRate * 100) + '%，先减少追问频率，给对方留出主动的空间。');
    if (fw.neg >= 3) advice.push('负向表达出现 ' + fw.neg + ' 次，优先处理具体矛盾，不要在情绪高点继续讲道理。');
    if (momentum > 3) advice.push('当前在升温，别急着加码；维持现在的节奏 3–5 天，让温度沉淀下来。');
    if (momentum < -3) advice.push('当前在降温，避免连发消息试探；隔一天用一个具体话题重新开场，成功率更高。');
    if (!advice.length) advice.push('整体节奏健康，保持现有的互动频率即可，不需要刻意制造话题。');

    return { level, mood, dir, paras, advice };
  }

  /* ---------------- 聚合工具（给开发端用） ---------------- */
  function summarizePartners(list) {
    return list.map((p) => ({
      ...p,
      trend: p.momentum > 1.5 ? 'up' : p.momentum < -1.5 ? 'down' : 'flat'
    }));
  }

  root.CLEngine = {
    parseChat, analyze, hash, dayKey, addDays, clamp, mean, median,
    PLATFORM_META, LEX, features, detectPlatform
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CLEngine;
})(typeof window !== 'undefined' ? window : globalThis);
